"""End-to-end encryption key directory and secret-chat blindness tests.

These prove the server behaves as a blind relay: it stores only public key material, hands each
one-time prekey to exactly one initiator, and never keeps a readable copy of a secret-chat body.
"""

from __future__ import annotations

import asyncio
import base64
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import DEMO_PASSWORD
from app.e2ee import (
    DeviceBundleUpload,
    PublishedPreKey,
    fetch_and_consume_bundles,
    publish_device_bundle,
)
from app.models import Message, Notification, NotificationKind, OneTimePreKey, User


def _b64(seed: int, length: int = 32) -> str:
    return base64.b64encode(bytes((seed + i) % 256 for i in range(length))).decode()


def _bundle(device_id: str, prekey_ids: list[int]) -> DeviceBundleUpload:
    return DeviceBundleUpload(
        device_public_id=device_id,
        identity_dh_public=_b64(1),
        identity_signing_public=_b64(2),
        signed_prekey_id=1,
        signed_prekey_public=_b64(3),
        signed_prekey_signature=_b64(4, 64),
        one_time_prekeys=[PublishedPreKey(id=i, public_key=_b64(10 + i)) for i in prekey_ids],
    )


async def _login(client: AsyncClient, identifier: str) -> None:
    response = await client.post(
        "/api/auth/login", json={"identifier": identifier, "password": DEMO_PASSWORD}
    )
    assert response.status_code == 200, response.text


async def _user_id(session: AsyncSession, username: str) -> uuid.UUID:
    found = await session.scalar(select(User).where(User.username == username))
    assert found is not None
    return found.id


@pytest.mark.asyncio
async def test_publish_bundle_stores_only_public_material(
    client: AsyncClient, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    await _login(client, "leon")
    response = await client.put(
        "/api/e2ee/devices", json=_bundle("device-a", [1, 2, 3]).model_dump()
    )
    assert response.status_code == 200, response.text
    async with session_factory() as session:
        keys = (await session.scalars(select(OneTimePreKey.prekey_public))).all()
        assert len(keys) == 3
        # Every stored value is base64 public key material — no private key column exists at all.
        for value in keys:
            base64.b64decode(value)


@pytest.mark.asyncio
async def test_fetch_consumes_one_time_prekey_exactly_once(
    client: AsyncClient, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    # Bob (artem) publishes a bundle with two one-time prekeys.
    async with session_factory() as session:
        bob = await _user_id(session, "artem")
        await publish_device_bundle(session, bob, _bundle("bob-device", [1, 2]))

    await _login(client, "leon")
    first = await client.post("/api/e2ee/sessions/artem")
    assert first.status_code == 200, first.text
    otk1 = first.json()["devices"][0]["one_time_prekey_id"]
    assert otk1 in (1, 2)

    second = await client.post("/api/e2ee/sessions/artem")
    assert second.status_code == 200, second.text
    otk2 = second.json()["devices"][0]["one_time_prekey_id"]
    assert otk2 in (1, 2)
    assert otk1 != otk2  # a distinct prekey handed out each time

    # Third fetch: pool exhausted, bundle still returned but without a one-time prekey.
    third = await client.post("/api/e2ee/sessions/artem")
    assert third.status_code == 200, third.text
    assert third.json()["devices"][0]["one_time_prekey_id"] is None


@pytest.mark.asyncio
async def test_concurrent_fetches_never_hand_out_the_same_prekey(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with session_factory() as session:
        bob = await _user_id(session, "artem")
        alice = await _user_id(session, "leon")
        await publish_device_bundle(session, bob, _bundle("bob-device", [1, 2, 3, 4, 5, 6]))

    async def claim() -> int | None:
        async with session_factory() as session:
            bundles = await fetch_and_consume_bundles(session, bob, alice)
            return bundles[0].one_time_prekey_id

    results = await asyncio.gather(*(claim() for _ in range(6)))
    claimed = [value for value in results if value is not None]
    # No prekey id is handed out twice even under concurrent claims.
    assert len(claimed) == len(set(claimed))


@pytest.mark.asyncio
async def test_secret_chat_stores_ciphertext_verbatim_and_no_plaintext_preview(
    client: AsyncClient, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    await _login(client, "leon")
    chat = await client.post("/api/chats/secret/artem")
    assert chat.status_code == 200, chat.text
    chat_id = chat.json()["id"]

    # The client sends a base64-ish ciphertext blob as the message content. The server must store
    # it byte-for-byte and must NOT put it into any notification preview.
    ciphertext = base64.b64encode(b"this-would-be-encrypted-bytes").decode()
    sent = await client.post(f"/api/chats/{chat_id}/messages", json={"content": ciphertext})
    assert sent.status_code == 201, sent.text
    assert sent.json()["content"] == ciphertext  # relayed verbatim

    async with session_factory() as session:
        stored = await session.scalar(
            select(Message).where(
                Message.chat_id == uuid.UUID(chat_id),
                Message.is_service.is_(False),
            )
        )
        assert stored is not None
        assert stored.content == ciphertext  # server keeps only the ciphertext

        # The recipient's notification preview must say "encrypted", never the ciphertext.
        note = await session.scalar(
            select(Notification).where(Notification.kind == NotificationKind.MESSAGE)
        )
        assert note is not None
        assert ciphertext not in note.text
        assert "Зашифрованное сообщение" in note.text


@pytest.mark.asyncio
async def test_secret_group_hides_plaintext_preview_and_sets_flag(
    client: AsyncClient, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    await _login(client, "leon")
    created = await client.post(
        "/api/chats/groups",
        json={"title": "Тайный круг", "members": ["artem"], "is_secret": True},
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["is_secret"] is True
    assert body["is_group"] is True
    chat_id = body["id"]

    ciphertext = base64.b64encode(b"group-ciphertext-blob").decode()
    sent = await client.post(f"/api/chats/{chat_id}/messages", json={"content": ciphertext})
    assert sent.status_code == 201, sent.text
    assert sent.json()["content"] == ciphertext  # relayed verbatim

    async with session_factory() as session:
        note = await session.scalar(
            select(Notification).where(Notification.kind == NotificationKind.MESSAGE)
        )
        assert note is not None
        assert ciphertext not in note.text
        assert "Зашифрованное сообщение" in note.text


@pytest.mark.asyncio
async def test_secret_group_cannot_be_public(client: AsyncClient) -> None:
    await _login(client, "leon")
    response = await client.post(
        "/api/chats/groups",
        json={"title": "x", "members": ["artem"], "is_secret": True, "is_public": True},
    )
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_bundle_rejects_non_base64_key_material(
    client: AsyncClient,
) -> None:
    await _login(client, "leon")
    bad = _bundle("device-x", [1]).model_dump()
    bad["identity_dh_public"] = "not base64 !!!"
    response = await client.put("/api/e2ee/devices", json=bad)
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_identity_key_cannot_be_swapped_on_existing_device(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with session_factory() as session:
        bob = await _user_id(session, "artem")
        await publish_device_bundle(session, bob, _bundle("bob-device", [1]))
        swapped = _bundle("bob-device", [2])
        swapped_dict = swapped.model_dump()
        swapped_dict["identity_dh_public"] = _b64(99)
        with pytest.raises(ValueError, match="identity key"):
            await publish_device_bundle(session, bob, DeviceBundleUpload(**swapped_dict))
