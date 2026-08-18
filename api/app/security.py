"""Password, JWT, and opaque refresh-token primitives."""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from pwdlib import PasswordHash

from app.config import ACCESS_TOKEN_MINUTES, JWT_ISSUER, JWT_SECRET, REFRESH_TOKEN_DAYS

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
