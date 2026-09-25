from __future__ import annotations

import asyncio
import uuid
from datetime import timedelta
from typing import Any, cast

import pytest
from httpx import AsyncClient
from redis.exceptions import ConnectionError as RedisConnectionError
from sqlalchemy import delete, func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app import main as main_module
from app import wire_outbox as wire_outbox_module
from app.config import DEMO_PASSWORD
from app.models import Follow, RealtimeOutbox, RefreshSession, User, UserBlock, UserSettings
from app.wire_outbox import WireOutboxPublisher, prune_published_outbox, publish_outbox_batch


class RecordingRedis:
    def __init__(self, result: int = 7) -> None:
        self.result = result
        self.calls: list[tuple[Any, ...]] = []

    async def eval(self, script: str, numkeys: int, *keys_and_args: Any) -> int:
        self.calls.append((script, numkeys, *keys_and_args))
        return self.result


class FailingPublisher:
    async def publish(self, row: RealtimeOutbox) -> int:
        del row
        raise RedisConnectionError("secret-bearing connection details must not be persisted")


@pytest.mark.asyncio
async def test_message_and_per_member_outbox_commit_together(
    client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(main_module, "WIRE_OUTBOX_ENABLED", True)
    login = await client.post(
        "/api/auth/login", json={"identifier": "leon", "password": DEMO_PASSWORD}
    )
    assert login.status_code == 200
    chat = await client.post("/api/chats/direct/artem")
    assert chat.status_code == 200
    sent = await client.post(
        f"/api/chats/{chat.json()['id']}/messages", json={"content": "wire atomicity"}
    )
    assert sent.status_code == 201, sent.text

    async with session_factory() as session:
        candidates = (
            await session.scalars(
                select(RealtimeOutbox).where(
                    RealtimeOutbox.event_type == "chat.message_created"
                )
            )
        ).all()
    rows = [row for row in candidates if row.payload.get("message_id") == sent.json()["id"]]
    assert len(rows) == 2
    assert {row.event_type for row in rows} == {"chat.message_created"}
    assert all(row.payload["chat_id"] == chat.json()["id"] for row in rows)
    assert len({row.user_id for row in rows}) == 2
    assert len({row.idempotency_key for row in rows}) == 2


@pytest.mark.asyncio
async def test_chat_mutations_enqueue_per_member_wire_invalidations(
    client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(main_module, "WIRE_OUTBOX_ENABLED", True)
    login = await client.post(
        "/api/auth/login", json={"identifier": "leon", "password": DEMO_PASSWORD}
    )
    assert login.status_code == 200
    chat = await client.post("/api/chats/direct/artem")
    assert chat.status_code == 200
    chat_id = chat.json()["id"]

    async with session_factory() as session:
        before = set(await session.scalars(select(RealtimeOutbox.id)))

    sent = await client.post(f"/api/chats/{chat_id}/messages", json={"content": "parity"})
    assert sent.status_code == 201, sent.text
    message_id = sent.json()["id"]
    edited = await client.patch(
        f"/api/chats/{chat_id}/messages/{message_id}", json={"content": "parity edited"}
    )
    assert edited.status_code == 200, edited.text
    reacted = await client.post(
        f"/api/chats/{chat_id}/messages/{message_id}/reactions", json={"emoji": "🔥"}
    )
    assert reacted.status_code == 200, reacted.text
    pinned = await client.post(f"/api/chats/{chat_id}/messages/{message_id}/pin")
    assert pinned.status_code == 200, pinned.text
    read = await client.post(f"/api/chats/{chat_id}/read")
    assert read.status_code == 200, read.text
    deleted = await client.delete(f"/api/chats/{chat_id}/messages/{message_id}?scope=all")
    assert deleted.status_code == 200, deleted.text

    async with session_factory() as session:
        all_rows = (await session.scalars(select(RealtimeOutbox))).all()
    rows = [row for row in all_rows if row.id not in before]
    by_type: dict[str, list[RealtimeOutbox]] = {}
    for row in rows:
        by_type.setdefault(row.event_type, []).append(row)

    expected = {
        "chat.message_created",
        "chat.message_edited",
        "chat.message_reacted",
        "chat.message_pinned",
        "chat.read",
        "chat.message_deleted",
    }
    assert set(by_type) == expected
    assert all(len(by_type[event_type]) == 2 for event_type in expected)
    assert all(row.payload["chat_id"] == chat_id for row in rows)
    for event_type in expected - {"chat.read"}:
        assert all(row.payload["message_id"] == message_id for row in by_type[event_type])
    assert len({row.idempotency_key for row in rows}) == len(rows)


@pytest.mark.asyncio
async def test_social_mutations_enqueue_for_distinct_active_accounts(
    client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(main_module, "WIRE_OUTBOX_ENABLED", True)
    login = await client.post(
        "/api/auth/login",
        json={"identifier": "leon", "password": DEMO_PASSWORD},
    )
    assert login.status_code == 200
    async with session_factory() as session, session.begin():
        artem_id = await session.scalar(select(User.id).where(User.username == "artem"))
        assert artem_id is not None
        session.add(
            RefreshSession(
                user_id=artem_id,
                token_hash=uuid.uuid4().hex * 2,
                expires_at=main_module.utcnow() + timedelta(days=1),
            )
        )

    async with session_factory() as session:
        before = set(await session.scalars(select(RealtimeOutbox.id)))
        active_users = set(
            await session.scalars(
                select(RefreshSession.user_id)
                .where(
                    RefreshSession.revoked_at.is_(None),
                    RefreshSession.expires_at > func.now(),
                )
                .distinct()
            )
        )
    assert len(active_users) == 2

    created = await client.post("/api/feed", json={"content": "wire social parity"})
    assert created.status_code == 201, created.text
    post_id = created.json()["id"]
    edited = await client.patch(
        f"/api/feed/{post_id}", json={"content": "wire social parity edited"}
    )
    assert edited.status_code == 200, edited.text
    reacted = await client.post(f"/api/feed/{post_id}/like")
    assert reacted.status_code == 200, reacted.text
    comment = await client.post(
        f"/api/feed/{post_id}/comments", json={"content": "wire comment parity"}
    )
    assert comment.status_code == 201, comment.text
    comment_id = comment.json()["id"]
    comment_edited = await client.patch(
        f"/api/feed/{post_id}/comments/{comment_id}",
        json={"content": "wire comment parity edited"},
    )
    assert comment_edited.status_code == 200, comment_edited.text
    comment_reacted = await client.post(
        f"/api/feed/{post_id}/comments/{comment_id}/like"
    )
    assert comment_reacted.status_code == 200, comment_reacted.text
    comment_deleted = await client.delete(f"/api/feed/{post_id}/comments/{comment_id}")
    assert comment_deleted.status_code == 200, comment_deleted.text
    post_deleted = await client.delete(f"/api/feed/{post_id}")
    assert post_deleted.status_code == 200, post_deleted.text

    async with session_factory() as session:
        all_rows = (await session.scalars(select(RealtimeOutbox))).all()
    rows = [row for row in all_rows if row.id not in before]
    expected = set(main_module.WIRE_SOCIAL_EVENT_TYPES)
    by_type: dict[str, list[RealtimeOutbox]] = {}
    for row in rows:
        by_type.setdefault(row.event_type, []).append(row)

    assert set(by_type) == expected
    assert all(len(by_type[event_type]) == len(active_users) for event_type in expected)
    assert all(
        {row.user_id for row in by_type[event_type]} == active_users for event_type in expected
    )
    assert all(row.payload["post_id"] == post_id for row in rows)
    for event_type in expected:
        if event_type.startswith("comment_"):
            assert all(row.payload["comment_id"] == comment_id for row in by_type[event_type])
    assert len({row.idempotency_key for row in rows}) == len(rows)


@pytest.mark.asyncio
async def test_social_outbox_honours_private_follow_and_block_visibility(
    client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(main_module, "WIRE_OUTBOX_ENABLED", True)
    login = await client.post(
        "/api/auth/login",
        json={"identifier": "leon", "password": DEMO_PASSWORD},
    )
    assert login.status_code == 200
    post_private = uuid.uuid4()
    post_followed = uuid.uuid4()
    post_blocked = uuid.uuid4()

    async with session_factory() as session, session.begin():
        users = {
            user.username: user
            for user in (
                await session.scalars(select(User).where(User.username.in_(("leon", "artem"))))
            ).all()
        }
        leon = users["leon"]
        artem = users["artem"]
        # The seed may already relate these two; start from a known-empty visibility state.
        await session.execute(
            delete(Follow).where(
                Follow.follower_id.in_((leon.id, artem.id)),
                Follow.following_id.in_((leon.id, artem.id)),
            )
        )
        await session.execute(
            delete(UserBlock).where(
                UserBlock.blocker_id.in_((leon.id, artem.id)),
                UserBlock.blocked_id.in_((leon.id, artem.id)),
            )
        )
        session.add(
            RefreshSession(
                user_id=artem.id,
                token_hash=uuid.uuid4().hex * 2,
                expires_at=main_module.utcnow() + timedelta(days=1),
            )
        )
        settings = await session.get(UserSettings, leon.id)
        if settings is None:
            settings = UserSettings(user_id=leon.id)
            session.add(settings)
        settings.private_account = True
        await session.flush()
        await main_module.enqueue_wire_social_event(
            session,
            "post_created",
            post_private,
            author_id=leon.id,
            actor_id=leon.id,
        )
        session.add(Follow(follower_id=artem.id, following_id=leon.id))
        await session.flush()
        await main_module.enqueue_wire_social_event(
            session,
            "post_updated",
            post_followed,
            author_id=leon.id,
            actor_id=leon.id,
        )
        session.add(UserBlock(blocker_id=leon.id, blocked_id=artem.id))
        await session.flush()
        await main_module.enqueue_wire_social_event(
            session,
            "post_deleted",
            post_blocked,
            author_id=leon.id,
            actor_id=leon.id,
        )

    async with session_factory() as session:
        candidates = (
            await session.scalars(
                select(RealtimeOutbox).where(
                    RealtimeOutbox.payload["post_id"].as_string().in_(
                        (str(post_private), str(post_followed), str(post_blocked))
                    )
                )
            )
        ).all()
    by_post: dict[str, set[uuid.UUID]] = {}
    for row in candidates:
        by_post.setdefault(row.payload["post_id"], set()).add(row.user_id)
    assert by_post[str(post_private)] == {leon.id}
    assert by_post[str(post_followed)] == {leon.id, artem.id}
    assert by_post[str(post_blocked)] == {leon.id}


@pytest.mark.asyncio
async def test_publisher_uses_bounded_binary_event_and_four_redis_keys(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with session_factory() as session:
        user_id = await session.scalar(select(User.id).where(User.username == "leon"))
    assert user_id is not None
    row = RealtimeOutbox(
        id=uuid.uuid4(),
        user_id=user_id,
        event_type="chat.changed",
        payload={"chat_id": "c1"},
        idempotency_key="outbox-test",
    )
    client = RecordingRedis()
    cursor = await WireOutboxPublisher(client).publish(row)
    assert cursor == 7
    assert len(client.calls) == 1
    call = client.calls[0]
    assert call[1] == 4
    assert call[2].endswith(str(user_id))
    assert call[5].endswith("outbox-test")
    assert isinstance(call[6], bytes)


@pytest.mark.asyncio
async def test_outbox_loop_recovers_after_transient_database_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = 0

    async def transient_batch(*_: Any) -> int:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise SQLAlchemyError("database temporarily unavailable")
        return 0

    monkeypatch.setattr(wire_outbox_module, "publish_outbox_batch", transient_batch)
    task = asyncio.create_task(
        wire_outbox_module.run_wire_outbox(
            cast("async_sessionmaker[AsyncSession]", None), RecordingRedis()
        )
    )
    try:
        await asyncio.sleep(1.1)
        assert not task.done()
        assert calls >= 2
    finally:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task


@pytest.mark.asyncio
async def test_outbox_failure_is_classified_without_storing_exception(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with session_factory() as session, session.begin():
        user_id = await session.scalar(select(User.id).where(User.username == "leon"))
        row = RealtimeOutbox(
            user_id=user_id,
            event_type="chat.changed",
            payload={},
            idempotency_key="failure-test",
        )
        session.add(row)
    processed = await publish_outbox_batch(
        session_factory,
        FailingPublisher(),
    )
    assert processed == 0
    async with session_factory() as session:
        stored = await session.scalar(
            select(RealtimeOutbox).where(RealtimeOutbox.idempotency_key == "failure-test")
        )
    assert stored is not None
    assert stored.attempts == 1
    assert stored.last_error_class == "redis_unavailable"
    assert "secret" not in stored.last_error_class


@pytest.mark.asyncio
async def test_pruner_only_removes_delivered_rows_past_the_replay_window(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with session_factory() as session, session.begin():
        user_id = await session.scalar(select(User.id).where(User.username == "leon"))
        old_delivered = RealtimeOutbox(
            user_id=user_id,
            event_type="post_created",
            payload={"post_id": str(uuid.uuid4())},
            idempotency_key=f"prune-old-{uuid.uuid4().hex}",
            published_at=main_module.utcnow() - timedelta(days=30),
            published_cursor=1,
        )
        fresh_delivered = RealtimeOutbox(
            user_id=user_id,
            event_type="post_created",
            payload={"post_id": str(uuid.uuid4())},
            idempotency_key=f"prune-fresh-{uuid.uuid4().hex}",
            published_at=main_module.utcnow(),
            published_cursor=2,
        )
        never_delivered = RealtimeOutbox(
            user_id=user_id,
            event_type="post_created",
            payload={"post_id": str(uuid.uuid4())},
            idempotency_key=f"prune-pending-{uuid.uuid4().hex}",
        )
        session.add_all((old_delivered, fresh_delivered, never_delivered))
        await session.flush()
        old_id, fresh_id, pending_id = old_delivered.id, fresh_delivered.id, never_delivered.id

    removed = await prune_published_outbox(session_factory)
    assert removed >= 1
    async with session_factory() as session:
        surviving = set(
            await session.scalars(
                select(RealtimeOutbox.id).where(
                    RealtimeOutbox.id.in_((old_id, fresh_id, pending_id))
                )
            )
        )
    # An undelivered row is still owed to a client, and a recent receipt is still inside the
    # window a resuming client can ask to replay.
    assert surviving == {fresh_id, pending_id}
