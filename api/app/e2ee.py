"""End-to-end encryption key directory and ciphertext-relay support for GRAM secret chats.

The server's role in E2EE is deliberately minimal and blind:

* it stores each device's PUBLIC prekey bundle so others can start a session while the device is
  offline (X3DH);
* it hands out one-time prekeys one initiator at a time, consuming each atomically so the same
  prekey is never handed to two people;
* it relays opaque ciphertext as ordinary chat message content.

No private key and no plaintext ever passes through here. Everything is base64 public-key material
or ciphertext. This module owns the data contracts and the database logic; the thin HTTP endpoints
live in ``main.py`` next to the other chat routes and reuse the existing auth dependency.
"""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime
from typing import Annotated

from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import DeviceIdentity, OneTimePreKey

# Base64 (standard or URL-safe, padded or not) of a 32-byte key is 43-44 chars; a 64-byte
# signature is 86-88. Bound the fields so a client cannot smuggle a large blob into the directory.
_B64 = re.compile(r"^[A-Za-z0-9_+/=-]+$")
MAX_KEY_B64 = 64
MAX_SIG_B64 = 128
MAX_ONE_TIME_PREKEYS_PER_DEVICE = 200
MAX_PREKEYS_PER_PUBLISH = 100


class PublishedPreKey(BaseModel):
    id: Annotated[int, Field(ge=0, le=2_147_483_647)]
    public_key: Annotated[str, Field(min_length=1, max_length=MAX_KEY_B64)]


class DeviceBundleUpload(BaseModel):
    """Everything a device publishes so others can begin an encrypted session with it."""

    device_public_id: Annotated[str, Field(min_length=1, max_length=64)]
    identity_dh_public: Annotated[str, Field(min_length=1, max_length=MAX_KEY_B64)]
    identity_signing_public: Annotated[str, Field(min_length=1, max_length=MAX_KEY_B64)]
    signed_prekey_id: Annotated[int, Field(ge=0, le=2_147_483_647)]
    signed_prekey_public: Annotated[str, Field(min_length=1, max_length=MAX_KEY_B64)]
    signed_prekey_signature: Annotated[str, Field(min_length=1, max_length=MAX_SIG_B64)]
    one_time_prekeys: Annotated[
        list[PublishedPreKey], Field(max_length=MAX_PREKEYS_PER_PUBLISH)
    ] = []


class PreKeyReplenish(BaseModel):
    one_time_prekeys: Annotated[
        list[PublishedPreKey], Field(min_length=1, max_length=MAX_PREKEYS_PER_PUBLISH)
    ]


class FetchedPreKeyBundle(BaseModel):
    """A single device's bundle as handed to an initiator, with one one-time prekey consumed."""

    user_id: uuid.UUID
    device_public_id: str
    identity_dh_public: str
    identity_signing_public: str
    signed_prekey_id: int
    signed_prekey_public: str
    signed_prekey_signature: str
    one_time_prekey_id: int | None = None
    one_time_prekey_public: str | None = None


class DeviceBundleList(BaseModel):
    devices: list[FetchedPreKeyBundle]


class PreKeyCount(BaseModel):
    device_public_id: str
    available_one_time_prekeys: int


def _valid_b64(value: str) -> bool:
    return bool(_B64.match(value))


def _validate_key_shapes(bundle: DeviceBundleUpload) -> None:
    fields = (
        bundle.identity_dh_public,
        bundle.identity_signing_public,
        bundle.signed_prekey_public,
        bundle.signed_prekey_signature,
    )
    if not all(_valid_b64(field) for field in fields):
        raise ValueError("key material must be base64")
    for prekey in bundle.one_time_prekeys:
        if not _valid_b64(prekey.public_key):
            raise ValueError("one-time prekey must be base64")


async def publish_device_bundle(
    session: AsyncSession, user_id: uuid.UUID, bundle: DeviceBundleUpload
) -> DeviceIdentity:
    """Create or update a device's public bundle and merge in any new one-time prekeys.

    Idempotent per ``device_public_id``: re-publishing rotates the signed prekey and tops up the
    one-time pool without creating a duplicate device.
    """

    _validate_key_shapes(bundle)
    device = await session.scalar(
        select(DeviceIdentity).where(
            DeviceIdentity.user_id == user_id,
            DeviceIdentity.device_public_id == bundle.device_public_id,
        )
    )
    if device is None:
        device = DeviceIdentity(
            user_id=user_id,
            device_public_id=bundle.device_public_id,
            identity_dh_public=bundle.identity_dh_public,
            identity_signing_public=bundle.identity_signing_public,
            signed_prekey_id=bundle.signed_prekey_id,
            signed_prekey_public=bundle.signed_prekey_public,
            signed_prekey_signature=bundle.signed_prekey_signature,
        )
        session.add(device)
        await session.flush()
    else:
        # The identity keys are long-lived; only the signed prekey rotates. Refusing to change the
        # identity key here means a compromised session cannot silently swap a victim's identity.
        if (
            device.identity_dh_public != bundle.identity_dh_public
            or device.identity_signing_public != bundle.identity_signing_public
        ):
            raise ValueError("identity key cannot be changed for an existing device")
        device.signed_prekey_id = bundle.signed_prekey_id
        device.signed_prekey_public = bundle.signed_prekey_public
        device.signed_prekey_signature = bundle.signed_prekey_signature
        device.updated_at = datetime.now(UTC)

    if bundle.one_time_prekeys:
        await _add_one_time_prekeys(session, device.id, bundle.one_time_prekeys)
    await session.commit()
    await session.refresh(device)
    return device


async def replenish_one_time_prekeys(
    session: AsyncSession,
    user_id: uuid.UUID,
    device_public_id: str,
    prekeys: list[PublishedPreKey],
) -> int:
    """Add new one-time prekeys to a device the caller owns. Returns available count afterwards."""

    device = await session.scalar(
        select(DeviceIdentity).where(
            DeviceIdentity.user_id == user_id,
            DeviceIdentity.device_public_id == device_public_id,
        )
    )
    if device is None:
        raise LookupError("device not found")
    for prekey in prekeys:
        if not _valid_b64(prekey.public_key):
            raise ValueError("one-time prekey must be base64")
    await _add_one_time_prekeys(session, device.id, prekeys)
    await session.commit()
    return await _available_prekey_count(session, device.id)


async def _add_one_time_prekeys(
    session: AsyncSession, device_id: uuid.UUID, prekeys: list[PublishedPreKey]
) -> None:
    available = await _available_prekey_count(session, device_id)
    if available + len(prekeys) > MAX_ONE_TIME_PREKEYS_PER_DEVICE:
        raise ValueError("one-time prekey pool is full")
    existing_ids = set(
        (
            await session.scalars(
                select(OneTimePreKey.prekey_id).where(OneTimePreKey.device_id == device_id)
            )
        ).all()
    )
    for prekey in prekeys:
        if prekey.id in existing_ids:
            continue  # idempotent: re-uploading the same id is a no-op, never a duplicate row
        existing_ids.add(prekey.id)
        session.add(
            OneTimePreKey(
                device_id=device_id,
                prekey_id=prekey.id,
                prekey_public=prekey.public_key,
            )
        )


async def _available_prekey_count(session: AsyncSession, device_id: uuid.UUID) -> int:
    rows = await session.scalars(
        select(OneTimePreKey.id).where(
            OneTimePreKey.device_id == device_id,
            OneTimePreKey.claimed_by.is_(None),
        )
    )
    return len(rows.all())


async def _claim_one_time_prekey(
    session: AsyncSession, device_id: uuid.UUID, claimer_id: uuid.UUID
) -> OneTimePreKey | None:
    """Atomically hand out one unclaimed prekey, or None if the pool is empty.

    On PostgreSQL this uses ``FOR UPDATE SKIP LOCKED`` so two concurrent initiators never receive
    the same prekey. On SQLite (tests) locking is a no-op but the same transactional read-then-mark
    keeps single-writer correctness.
    """

    dialect = session.bind.dialect.name if session.bind is not None else ""
    query = (
        select(OneTimePreKey)
        .where(
            OneTimePreKey.device_id == device_id,
            OneTimePreKey.claimed_by.is_(None),
        )
        .order_by(OneTimePreKey.prekey_id)
        .limit(1)
    )
    if dialect == "postgresql":
        query = query.with_for_update(skip_locked=True)
    candidate = await session.scalar(query)
    if candidate is None:
        return None
    # Conditional UPDATE: only claim if still unclaimed, so a lost race marks nothing twice.
    result = await session.execute(
        update(OneTimePreKey)
        .where(OneTimePreKey.id == candidate.id, OneTimePreKey.claimed_by.is_(None))
        .values(claimed_by=claimer_id, claimed_at=datetime.now(UTC))
    )
    if result.rowcount == 0:
        return None
    await session.refresh(candidate)
    return candidate


async def fetch_and_consume_bundles(
    session: AsyncSession, target_user_id: uuid.UUID, claimer_id: uuid.UUID
) -> list[FetchedPreKeyBundle]:
    """Return every device bundle for a user, consuming one one-time prekey per device.

    Called by an initiator opening a secret chat. The consumption is what makes each one-time
    prekey single-use; when a device's pool is exhausted its bundle is still returned without a
    one-time prekey (weaker but still forward-secret via the signed prekey).
    """

    devices = (
        await session.scalars(
            select(DeviceIdentity).where(DeviceIdentity.user_id == target_user_id)
        )
    ).all()
    bundles: list[FetchedPreKeyBundle] = []
    for device in devices:
        claimed = await _claim_one_time_prekey(session, device.id, claimer_id)
        bundles.append(
            FetchedPreKeyBundle(
                user_id=target_user_id,
                device_public_id=device.device_public_id,
                identity_dh_public=device.identity_dh_public,
                identity_signing_public=device.identity_signing_public,
                signed_prekey_id=device.signed_prekey_id,
                signed_prekey_public=device.signed_prekey_public,
                signed_prekey_signature=device.signed_prekey_signature,
                one_time_prekey_id=claimed.prekey_id if claimed else None,
                one_time_prekey_public=claimed.prekey_public if claimed else None,
            )
        )
    await session.commit()
    return bundles


async def prekey_counts(
    session: AsyncSession, user_id: uuid.UUID
) -> list[PreKeyCount]:
    """How many unclaimed one-time prekeys each of the caller's devices still has."""

    devices = (
        await session.scalars(select(DeviceIdentity).where(DeviceIdentity.user_id == user_id))
    ).all()
    counts: list[PreKeyCount] = [
        PreKeyCount(
            device_public_id=device.device_public_id,
            available_one_time_prekeys=await _available_prekey_count(session, device.id),
        )
        for device in devices
    ]
    return counts
