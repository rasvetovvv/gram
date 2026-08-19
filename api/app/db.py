"""Async SQLAlchemy database primitives."""

from __future__ import annotations

from collections.abc import AsyncIterator

from sqlalchemy import inspect, text
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
            if backfill:
                connection.execute(text(backfill))


# Run once, at the moment a column first appears, for columns whose NULL is not the truth
# about existing rows. `gifts.upgraded_at` is the case that matters: every item minted before
# the plain/upgraded split already carried a rolled model, backdrop and symbol, so leaving it
# NULL would demote whole collections back to plain artwork and lose the rolls.
BACKFILLS: dict[tuple[str, str], str] = {
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
}
