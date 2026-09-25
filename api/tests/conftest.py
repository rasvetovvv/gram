from __future__ import annotations

from collections.abc import AsyncIterator
import os
from pathlib import Path

# The broad legacy suite exercises product behaviour rather than SMTP. Focused email-auth tests
# explicitly disable this bypass and stub delivery; production Compose pins it to false.
os.environ.setdefault("EMAIL_AUTH_ENABLED", "true")
os.environ.setdefault("EMAIL_OTP_BYPASS", "true")
os.environ.setdefault("EMAIL_OTP_SECRET", "test-only-email-otp-secret-0123456789abcdef")

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app import main as main_module
from app.db import Base, get_session
from app.main import app
from app.seed import seed_database


@pytest_asyncio.fixture
async def session_factory() -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    """A seeded in-memory database, shared by the HTTP client and any direct-access test."""
    test_engine = create_async_engine(
        "sqlite+aiosqlite://",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    factory = async_sessionmaker(test_engine, expire_on_commit=False)
    async with test_engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with factory() as session:
        await seed_database(session)
    yield factory
    await test_engine.dispose()


@pytest_asyncio.fixture
async def db_session(
    session_factory: async_sessionmaker[AsyncSession],
) -> AsyncIterator[AsyncSession]:
    """Direct database access, for the few facts only time travel can set up."""
    async with session_factory() as session:
        yield session


@pytest_asyncio.fixture
async def client(
    session_factory: async_sessionmaker[AsyncSession],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> AsyncIterator[AsyncClient]:
    async def override_session() -> AsyncIterator[AsyncSession]:
        async with session_factory() as session:
            yield session

    monkeypatch.setattr(main_module, "MEDIA_ROOT", tmp_path / "media")
    main_module._LEGAL_REPORT_WINDOWS.clear()
    app.dependency_overrides[get_session] = override_session
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as test_client:
        yield test_client
    app.dependency_overrides.clear()
