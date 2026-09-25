"""Transactional outbox publisher for GRAM Wire durable events."""

from __future__ import annotations

import asyncio
import inspect
from collections.abc import Awaitable
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol, cast

import msgpack
import redis.asyncio as redis
from redis.exceptions import RedisError
from sqlalchemy import CursorResult, delete, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import RealtimeOutbox

PUBLISH_EVENT_LUA = """
local existing = redis.call('GET', KEYS[4])
if existing then
  return tonumber(existing)
end
local id = redis.call('INCR', KEYS[1])
local stream_id = tostring(id) .. '-0'
local payload = tostring(id) .. '|' .. ARGV[1]
redis.call('XADD', KEYS[2], stream_id, 'payload', payload)
redis.call('XTRIM', KEYS[2], 'MAXLEN', '=', ARGV[2])
redis.call('EXPIRE', KEYS[2], ARGV[3])
redis.call('SET', KEYS[4], tostring(id), 'EX', ARGV[3])
redis.call('PUBLISH', KEYS[3], payload)
return id
"""

MAX_STREAM_LENGTH = 10_000
STREAM_RETENTION_SECONDS = 7 * 24 * 60 * 60
OUTBOX_BATCH_SIZE = 100
# Published rows are only a delivery receipt. Redis already holds the replay window, so keeping
# them past it grows the table without adding recoverable state — one social event writes one row
# per active account, so the fan-out is what makes this unbounded rather than merely large.
OUTBOX_RETENTION_SECONDS = STREAM_RETENTION_SECONDS
OUTBOX_PRUNE_BATCH_SIZE = 1_000
OUTBOX_PRUNE_INTERVAL_SECONDS = 3600


class RedisScriptClient(Protocol):
    def eval(
        self, script: str, numkeys: int, *keys_and_args: Any
    ) -> Awaitable[Any] | Any: ...


class OutboxPublisher(Protocol):
    async def publish(self, row: RealtimeOutbox) -> int: ...


class WireOutboxPublisher:
    """Publish committed outbox rows into the same Redis contract used by the Gateway."""

    def __init__(self, client: RedisScriptClient) -> None:
        self.client = client

    async def publish(self, row: RealtimeOutbox) -> int:
        user_id = str(row.user_id)
        packed = msgpack.packb(
            {"type": row.event_type, "body": row.payload},
            use_bin_type=True,
        )
        if len(packed) > 256 * 1024:
            raise ValueError("wire event exceeds payload limit")
        result = self.client.eval(
            PUBLISH_EVENT_LUA,
            4,
            f"gram:wire:event-seq:{user_id}",
            f"gram:wire:events:{user_id}",
            f"gram:wire:live:{user_id}",
            f"gram:wire:outbox:{row.idempotency_key}",
            packed,
            MAX_STREAM_LENGTH,
            STREAM_RETENTION_SECONDS,
        )
        cursor = await result if inspect.isawaitable(result) else result
        if not isinstance(cursor, int) or cursor < 1:
            raise RedisError("invalid cursor returned by event script")
        return cursor


async def publish_outbox_batch(
    session_factory: async_sessionmaker[AsyncSession], publisher: OutboxPublisher
) -> int:
    """Claim one batch with SKIP LOCKED and acknowledge each Redis publication transactionally."""
    now = datetime.now(UTC)
    processed = 0
    async with session_factory() as session, session.begin():
        rows = (
            await session.scalars(
                select(RealtimeOutbox)
                .where(
                    RealtimeOutbox.published_at.is_(None),
                    RealtimeOutbox.next_attempt_at <= now,
                )
                .order_by(RealtimeOutbox.created_at, RealtimeOutbox.id)
                .limit(OUTBOX_BATCH_SIZE)
                .with_for_update(skip_locked=True)
            )
        ).all()
        for row in rows:
            try:
                cursor = await publisher.publish(row)
            except (RedisError, TimeoutError, OSError):
                row.attempts += 1
                row.last_error_class = "redis_unavailable"
                row.next_attempt_at = now + timedelta(seconds=min(60, 2 ** min(row.attempts, 6)))
                break
            except ValueError:
                # A malformed server-produced event must not retry forever or leak its payload.
                row.attempts += 1
                row.last_error_class = "invalid_payload"
                row.next_attempt_at = now + timedelta(days=30)
                break
            row.published_cursor = cursor
            row.published_at = now
            row.last_error_class = None
            processed += 1
    return processed


async def prune_published_outbox(
    session_factory: async_sessionmaker[AsyncSession], *, now: datetime | None = None
) -> int:
    """Delete delivered rows older than the Redis replay window, in one bounded batch.

    Only rows that were actually published are eligible: an unpublished row is still owed to a
    client, and a row that failed with `invalid_payload` is deliberately parked for inspection
    rather than deleted, so a bug cannot quietly erase its own evidence.
    """
    moment = now or datetime.now(UTC)
    cutoff = moment - timedelta(seconds=OUTBOX_RETENTION_SECONDS)
    async with session_factory() as session, session.begin():
        doomed = (
            select(RealtimeOutbox.id)
            .where(
                RealtimeOutbox.published_at.is_not(None),
                RealtimeOutbox.published_at < cutoff,
            )
            .order_by(RealtimeOutbox.published_at)
            .limit(OUTBOX_PRUNE_BATCH_SIZE)
        )
        result = await session.execute(
            delete(RealtimeOutbox).where(RealtimeOutbox.id.in_(doomed.scalar_subquery()))
        )
    return int(cast("CursorResult[Any]", result).rowcount or 0)


async def run_wire_outbox_pruner(session_factory: async_sessionmaker[AsyncSession]) -> None:
    """Continuously trim delivered rows; cancellation is the only normal exit."""
    while True:
        try:
            removed = await prune_published_outbox(session_factory)
        except SQLAlchemyError:
            await asyncio.sleep(OUTBOX_PRUNE_INTERVAL_SECONDS)
            continue
        if removed < OUTBOX_PRUNE_BATCH_SIZE:
            await asyncio.sleep(OUTBOX_PRUNE_INTERVAL_SECONDS)


async def run_wire_outbox(
    session_factory: async_sessionmaker[AsyncSession], client: RedisScriptClient
) -> None:
    """Continuously drain the outbox; cancellation is the only normal exit."""
    publisher = WireOutboxPublisher(client)
    while True:
        try:
            processed = await publish_outbox_batch(session_factory, publisher)
        except SQLAlchemyError:
            # A transient database failure must not permanently kill the publisher task. Payloads,
            # SQL text and connection details are intentionally not logged here.
            await asyncio.sleep(1)
            continue
        await asyncio.sleep(0 if processed == OUTBOX_BATCH_SIZE else 0.5)


def create_wire_redis(url: str) -> redis.Redis:
    """Create a bounded client without logging or returning connection details."""
    return redis.from_url(
        url,
        decode_responses=False,
        socket_connect_timeout=2,
        socket_timeout=2,
        health_check_interval=30,
    )
