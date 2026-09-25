"""Read-only production probe: how many recipients one social event would stage.

Staging happens inside a transaction that is rolled back, so the outbox is left untouched.
Run inside the API container:

    docker exec gram-api-1 /app/.venv/bin/python /app/app/../tools/social_outbox_probe.py
"""

from __future__ import annotations

import asyncio
import uuid

from sqlalchemy import func, select

from app import main as m
from app.db import SessionFactory
from app.models import RealtimeOutbox, RefreshSession, User


async def main() -> None:
    async with SessionFactory() as session:
        active_query = (
            select(RefreshSession.user_id)
            .join(User, User.id == RefreshSession.user_id)
            .where(
                RefreshSession.revoked_at.is_(None),
                RefreshSession.expires_at > func.now(),
                User.banned_at.is_(None),
            )
            .distinct()
        )
        active = len((await session.scalars(active_query)).all())
        author = await session.scalar(active_query.limit(1))
        before = await session.scalar(select(func.count()).select_from(RealtimeOutbox))
        print(f"outbox_enabled={m.WIRE_OUTBOX_ENABLED}")
        print(f"active_accounts={active}")
        if author is None:
            print("staged_recipients=0 reason=no_active_account")
            return
        post_id = uuid.uuid4()
        await m.enqueue_wire_social_event(
            session, "post_created", post_id, author_id=author, actor_id=author
        )
        await session.flush()
        staged = await session.scalar(
            select(func.count())
            .select_from(RealtimeOutbox)
            .where(RealtimeOutbox.payload["post_id"].as_string() == str(post_id))
        )
        print(f"staged_recipients={staged}")
        await session.rollback()
        after = await session.scalar(select(func.count()).select_from(RealtimeOutbox))
        print(f"outbox_rows_before={before} outbox_rows_after_rollback={after}")


if __name__ == "__main__":
    asyncio.run(main())
