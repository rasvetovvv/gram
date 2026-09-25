"""Async SQLAlchemy database primitives."""

from __future__ import annotations

from collections.abc import AsyncIterator

from sqlalchemy import inspect, select, text, update
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.config import DATABASE_URL


class Base(DeclarativeBase):
    """Declarative model base."""


def build_engine(url: str = DATABASE_URL) -> AsyncEngine:
    """Create an engine suitable for PostgreSQL and test SQLite alike."""
    return create_async_engine(url, pool_pre_ping=not url.startswith("sqlite"))


engine = build_engine()
SessionFactory = async_sessionmaker(engine, expire_on_commit=False)


async def get_session() -> AsyncIterator[AsyncSession]:
    """Yield a request-scoped database session."""
    async with SessionFactory() as session:
        yield session


async def create_schema(target_engine: AsyncEngine = engine) -> None:
    """Create any missing tables without dropping or rewriting existing data."""
    from app import models  # noqa: F401

    async with target_engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
        await connection.run_sync(_add_missing_columns)
        await connection.run_sync(_repair_orphans)


# Statements that fix rows nothing else will, run on every start because they are cheap and
# idempotent. Columns added by `_add_missing_columns` carry no foreign key — `ALTER TABLE ... ADD
# COLUMN` cannot add one — so a row deleted elsewhere leaves whatever pointed at it dangling.
REPAIRS: tuple[str, ...] = (
    # A handle whose channel was deleted goes back to being a plain collectible. Left pointing at
    # a channel that no longer exists, it opened neither the channel nor its owner's profile.
    (
        "UPDATE username_assets SET community_id = NULL "
        "WHERE community_id IS NOT NULL "
        "AND community_id NOT IN (SELECT id FROM communities)"
    ),
)


def _repair_orphans(connection: Connection) -> None:
    """Run the repairs, skipping any whose tables are not there yet."""
    existing = set(inspect(connection).get_table_names())
    if not {"username_assets", "communities"} <= existing:
        return
    for statement in REPAIRS:
        connection.execute(text(statement))
    if "user_profile_details" in existing:
        _repair_featured_communities(connection)


def _repair_featured_communities(connection: Connection) -> None:
    """
    Drop a profile's reference to a channel that no longer exists.

    Deleting a channel left every profile advertising it asking for it on each view — two 404s per
    profile — and drawing nothing, so the reference was both invisible and permanent: the edit sheet
    only offers channels the account owns, and a deleted one is not among them.

    In Python rather than in `REPAIRS` because the list column is JSON, and picking elements out of
    JSON is not portable between PostgreSQL and the SQLite the tests run on. SQLAlchemy's own column
    type does the encoding for whichever one is in front of us.
    """
    from app.models import Community, UserProfileDetails

    live = set(connection.scalars(select(Community.slug)).all())
    rows = connection.execute(
        select(
            UserProfileDetails.user_id,
            UserProfileDetails.featured_community_slug,
            UserProfileDetails.featured_community_slugs,
        )
    ).all()
    for user_id, single, many in rows:
        kept = [slug for slug in (many or []) if slug in live]
        wanted_single = single if single in live else (kept[0] if kept else None)
        if wanted_single == single and kept == list(many or []):
            continue
        connection.execute(
            update(UserProfileDetails)
            .where(UserProfileDetails.user_id == user_id)
            .values(featured_community_slug=wanted_single, featured_community_slugs=kept)
        )


def _default_clause(column: object) -> str:
    """`DEFAULT <literal>` for a scalar column default, or empty when there is none."""
    default = getattr(column, "default", None)
    if default is None or not getattr(default, "is_scalar", False):
        return ""
    literal = default.arg
    if isinstance(literal, str):
        return f" DEFAULT '{literal}'"
    if isinstance(literal, bool):
        return f" DEFAULT {'TRUE' if literal else 'FALSE'}"
    if isinstance(literal, int | float):
        return f" DEFAULT {literal}"
    return ""


def _add_missing_columns(connection: Connection) -> None:
    """Additively reconcile columns added to existing tables (no Alembic in this project)."""
    inspector = inspect(connection)
    existing_tables = set(inspector.get_table_names())
    dialect = connection.dialect.name
    for table in Base.metadata.sorted_tables:
        if table.name not in existing_tables:
            continue
        present = {column["name"] for column in inspector.get_columns(table.name)}
        for column in table.columns:
            if column.name in present or column.primary_key:
                continue
            column_type = column.type.compile(connection.dialect)
            statement = (
                f'ALTER TABLE "{table.name}" ADD COLUMN "{column.name}" {column_type}'
                f"{_default_clause(column)}"
            )
            if dialect == "postgresql":
                statement = statement.replace("ADD COLUMN", "ADD COLUMN IF NOT EXISTS", 1)
            connection.execute(text(statement))
            backfill = BACKFILLS.get((table.name, column.name))
            if backfill is None:
                continue
            # A one-off fix can need more than one statement, and a driver may refuse two of
            # them in a single round trip, so each is sent on its own.
            for step in (backfill,) if isinstance(backfill, str) else backfill:
                connection.execute(text(step))


# Run once, at the moment a column first appears, for columns whose NULL is not the truth
# about existing rows. `gifts.upgraded_at` is the case that matters: every item minted before
# the plain/upgraded split already carried a rolled model, backdrop and symbol, so leaving it
# NULL would demote whole collections back to plain artwork and lose the rolls.
BACKFILLS: dict[tuple[str, str], str | tuple[str, ...]] = {
    # Community posts used to live in their own table with no likes, comments or views. They are
    # `posts` now; this copies the old rows across the first time the column appears, keeping
    # their ids so links to them still resolve.
    ("posts", "community_id"): (
        "INSERT INTO posts (id, author_id, community_id, content, image_url, created_at) "
        "SELECT id, author_id, community_id, content, image_url, created_at "
        "FROM community_posts "
        "WHERE NOT EXISTS (SELECT 1 FROM posts WHERE posts.id = community_posts.id)"
    ),
    ("gifts", "opened_at"): "UPDATE gifts SET opened_at = received_at WHERE opened_at IS NULL",
    ("gifts", "upgraded_at"): (
        "UPDATE gifts SET upgraded_at = received_at "
        "WHERE upgraded_at IS NULL AND model_name IS NOT NULL AND model_name <> ''"
    ),
    # Refunds approved before this column existed were carried out in Telegram immediately, inside
    # the same bot callback that approved them. Leaving them NULL would put them back in the queue
    # of approvals still waiting for `refundStarPayment` and refund them a second time.
    ("star_refunds", "telegram_done_at"): (
        "UPDATE star_refunds SET telegram_done_at = decided_at WHERE status = 'approved'"
    ),
    # Channel addresses used to live only in `communities.slug`, which is how `@gram` could be
    # somebody's account *and* somebody else's channel at once. Handles are one namespace now, so
    # every slug that *can* be a handle becomes the asset row it should always have been: linked
    # to the channel, owned by whoever owns the channel.
    #
    # Two exclusions, both deliberate. A slug with a dash or over 32 characters is not a username
    # anybody could hold, so it stays a plain address. A slug that is also a live account handle
    # is exactly the collision this ends — it is left alone rather than papered over, so its owner
    # can decide which of the two keeps the name.
    ("username_assets", "community_id"): (
        (
            "UPDATE username_assets AS a "
            "SET community_id = c.id, owner_id = COALESCE(a.owner_id, c.owner_id) "
            "FROM communities AS c "
            "WHERE lower(a.username) = lower(c.slug) AND a.community_id IS NULL "
            "AND c.slug ~ '^[a-zA-Z][a-zA-Z0-9_]{2,31}$' "
            "AND NOT EXISTS (SELECT 1 FROM users AS u WHERE lower(u.username) = lower(c.slug))"
        ),
        (
            "INSERT INTO username_assets "
            "(id, username, owner_id, community_id, status, currency, reserved_at, created_at) "
            "SELECT gen_random_uuid(), lower(c.slug), c.owner_id, c.id, 'RESERVED', 'STARS', "
            "now(), now() FROM communities AS c "
            "WHERE c.slug ~ '^[a-zA-Z][a-zA-Z0-9_]{2,31}$' "
            "AND NOT EXISTS (SELECT 1 FROM users AS u WHERE lower(u.username) = lower(c.slug)) "
            "AND NOT EXISTS ("
            "SELECT 1 FROM username_assets AS a WHERE lower(a.username) = lower(c.slug))"
        ),
    ),
}
