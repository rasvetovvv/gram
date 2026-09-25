"""Provision or remove an isolated synthetic canary account for GRAM Wire probes.

Usage inside the API container (PYTHONPATH=/app):

    python tools/wire_canary_account.py create
    python tools/wire_canary_account.py enqueue <user_id> <event_type>
    python tools/wire_canary_account.py drop <user_id>

`create` prints `user_id` and a short-lived access token so an external probe can mint a
real Wire ticket through the public API. Nothing else in production is touched: the account
is fresh, has no posts, no follows and no chats.
"""

from __future__ import annotations

import asyncio
import secrets
import sys
import uuid

from sqlalchemy import delete, func, select

from app.db import SessionFactory
from app.models import AuthIdentity, RealtimeOutbox, RefreshSession, User
from app.security import (
    create_access_token,
    hash_password,
    new_refresh_token,
    refresh_expiry,
    refresh_token_hash,
)

CANARY_PREFIX = "wirecanary"
MIN_ARGV = 2


async def create() -> None:
    suffix = secrets.token_hex(4)
    username = f"{CANARY_PREFIX}{suffix}"
    async with SessionFactory() as session, session.begin():
        user = User(
            username=username,
            display_name="Wire Canary",
        )
        session.add(user)
        await session.flush()
        session.add(
            AuthIdentity(
                user_id=user.id,
                email=f"{username}@canary.invalid",
                password_hash=hash_password(secrets.token_urlsafe(32)),
                email_verified=True,
            )
        )
        refresh = RefreshSession(
            user_id=user.id,
            token_hash=refresh_token_hash(new_refresh_token()),
            expires_at=refresh_expiry(),
        )
        session.add(refresh)
        await session.flush()
        token, _ = create_access_token(user.id, refresh.id)
        print(f"user_id={user.id}")
        print(f"username={username}")
        print(f"access_token={token}")


async def token(user_id: str) -> None:
    """Mint a fresh access token for an existing canary session.

    Access tokens are deliberately short-lived, so a probe run more than a few minutes after
    the account was created needs a new one rather than a longer-lived credential.
    """
    async with SessionFactory() as session:
        target = uuid.UUID(user_id)
        user = await session.scalar(select(User).where(User.id == target))
        if user is None or not user.username.startswith(CANARY_PREFIX):
            raise SystemExit("not a canary account")
        refresh = await session.scalar(
            select(RefreshSession)
            .where(
                RefreshSession.user_id == target,
                RefreshSession.revoked_at.is_(None),
                RefreshSession.expires_at > func.now(),
            )
            .limit(1)
        )
        if refresh is None:
            raise SystemExit("no active canary session")
        fresh, _ = create_access_token(target, refresh.id)
        print(f"access_token={fresh}")


async def cookies(user_id: str) -> None:
    """Mint a fresh access/refresh pair so a real browser can be signed in as the canary.

    A new refresh session is created rather than reusing an existing one: the stored hash cannot
    be reversed into the raw cookie value, and minting a separate session leaves any session the
    probe already holds untouched.
    """
    async with SessionFactory() as session, session.begin():
        target = uuid.UUID(user_id)
        user = await session.scalar(select(User).where(User.id == target))
        if user is None or not user.username.startswith(CANARY_PREFIX):
            raise SystemExit("not a canary account")
        raw_refresh = new_refresh_token()
        refresh = RefreshSession(
            user_id=target,
            token_hash=refresh_token_hash(raw_refresh),
            expires_at=refresh_expiry(),
        )
        session.add(refresh)
        await session.flush()
        access, _ = create_access_token(target, refresh.id)
        print(f"access_token={access}")
        print(f"refresh_token={raw_refresh}")


async def enqueue(user_id: str, event_type: str) -> None:
    async with SessionFactory() as session, session.begin():
        session.add(
            RealtimeOutbox(
                user_id=uuid.UUID(user_id),
                event_type=event_type,
                payload={"post_id": str(uuid.uuid4()), "actor_id": user_id},
                idempotency_key=f"canary:{event_type}:{secrets.token_hex(8)}",
            )
        )
    print(f"enqueued={event_type}")


async def drop(user_id: str) -> None:
    async with SessionFactory() as session, session.begin():
        target = uuid.UUID(user_id)
        user = await session.scalar(select(User).where(User.id == target))
        if user is None or not user.username.startswith(CANARY_PREFIX):
            print("dropped=0 reason=not_a_canary_account")
            return
        await session.execute(delete(RealtimeOutbox).where(RealtimeOutbox.user_id == target))
        await session.execute(delete(AuthIdentity).where(AuthIdentity.user_id == target))
        await session.delete(user)
    print("dropped=1")


def main() -> None:
    if len(sys.argv) < MIN_ARGV:
        raise SystemExit("usage: create | enqueue <user_id> <event_type> | drop <user_id>")
    action = sys.argv[1]
    if action == "create":
        asyncio.run(create())
    elif action == "token":
        asyncio.run(token(sys.argv[2]))
    elif action == "cookies":
        asyncio.run(cookies(sys.argv[2]))
    elif action == "enqueue":
        asyncio.run(enqueue(sys.argv[2], sys.argv[3]))
    elif action == "drop":
        asyncio.run(drop(sys.argv[2]))
    else:
        raise SystemExit("unknown action")


if __name__ == "__main__":
    main()
