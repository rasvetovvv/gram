"""Password, JWT, and opaque refresh-token primitives."""

from __future__ import annotations

import hashlib
import re
import secrets
import uuid
from base64 import urlsafe_b64encode
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from pwdlib import PasswordHash

from app.config import (
    ACCESS_TOKEN_MINUTES,
    JWT_ISSUER,
    JWT_SECRET,
    REFRESH_TOKEN_DAYS,
    WIRE_TICKET_SECRET,
    WIRE_TICKET_TTL_SECONDS,
)

password_hash = PasswordHash.recommended()


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(password: str, encoded: str) -> bool:
    return password_hash.verify(password, encoded)


def refresh_token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def new_refresh_token() -> str:
    return secrets.token_urlsafe(48)


def refresh_expiry() -> datetime:
    return datetime.now(UTC) + timedelta(days=REFRESH_TOKEN_DAYS)


def create_access_token(user_id: uuid.UUID, session_id: uuid.UUID) -> tuple[str, datetime]:
    now = datetime.now(UTC)
    expires = now + timedelta(minutes=ACCESS_TOKEN_MINUTES)
    payload = {
        "sub": str(user_id),
        "sid": str(session_id),
        "type": "access",
        "iss": JWT_ISSUER,
        "iat": now,
        "exp": expires,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256"), expires


def decode_access_token(token: str) -> dict[str, Any]:
    payload = jwt.decode(
        token,
        JWT_SECRET,
        algorithms=["HS256"],
        issuer=JWT_ISSUER,
        options={"require": ["sub", "sid", "type", "exp", "iat", "iss"]},
    )
    if payload.get("type") != "access":
        raise jwt.InvalidTokenError
    return payload


def create_wire_ticket(
    user_id: uuid.UUID, session_id: uuid.UUID, channel_binding: str | None = None
) -> tuple[str, datetime]:
    """Mint a short-lived credential usable only as the first GRAM Wire encrypted frame.

    When ``channel_binding`` is supplied (the browser's base64url SHA-256 of the handshake's
    channel binding), it is embedded as the ``cnf`` claim so the gateway can require that this
    exact ticket was minted for this exact encrypted session. A ticket without ``cnf`` still
    works while the gateway keeps channel binding optional.
    """
    if not WIRE_TICKET_SECRET:
        raise RuntimeError("GRAM Wire ticket signing is not configured")
    now = datetime.now(UTC)
    expires = now + timedelta(seconds=WIRE_TICKET_TTL_SECONDS)
    payload = {
        "sub": str(user_id),
        "sid": str(session_id),
        "jti": secrets.token_urlsafe(24),
        "type": "wire_ticket",
        "aud": "gram-wire",
        "iss": JWT_ISSUER,
        "iat": now,
        "nbf": now,
        "exp": expires,
    }
    if channel_binding is not None:
        payload["cnf"] = normalize_channel_binding(channel_binding)
    return jwt.encode(payload, WIRE_TICKET_SECRET, algorithm="HS256"), expires


# The gateway sends the client a 32-byte channel binding derived from the handshake; the browser
# forwards SHA-256(binding) as unpadded URL-safe base64. That is exactly 43 base64url characters,
# so anything else is rejected before it can reach the ticket.
_CHANNEL_BINDING_RE = re.compile(r"^[A-Za-z0-9_-]{43}$")


def normalize_channel_binding(value: str) -> str:
    candidate = value.strip()
    if not _CHANNEL_BINDING_RE.fullmatch(candidate):
        raise ValueError("invalid GRAM Wire channel binding")
    return candidate


def channel_binding_confirmation(binding: bytes) -> str:
    """base64url(SHA-256(binding)) — the exact string the gateway recomputes and compares."""
    digest = hashlib.sha256(binding).digest()
    return urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
