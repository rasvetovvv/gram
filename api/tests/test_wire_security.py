from __future__ import annotations

import uuid
from datetime import UTC, datetime
from pathlib import Path

import jwt
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app import config, security
from app import main as main_module
from app.config import DEMO_PASSWORD
from app.models import RefreshSession


def test_secret_value_supports_file_and_rejects_ambiguous_sources(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    secret_file = tmp_path / "wire-secret"
    secret_file.write_text("file-backed-secret\n", encoding="utf-8")
    secret_file.chmod(0o600)
    monkeypatch.delenv("TEST_WIRE_SECRET", raising=False)
    monkeypatch.setenv("TEST_WIRE_SECRET_FILE", str(secret_file))
    assert config.secret_value("TEST_WIRE_SECRET") == "file-backed-secret"
    monkeypatch.setenv("TEST_WIRE_SECRET", "environment-secret")
    with pytest.raises(RuntimeError):
        config.secret_value("TEST_WIRE_SECRET")


def test_wire_ticket_is_short_lived_and_audience_bound(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(security, "WIRE_TICKET_SECRET", "test-wire-ticket-secret-at-least-32-bytes")
    monkeypatch.setattr(security, "WIRE_TICKET_TTL_SECONDS", 60)
    user_id = uuid.uuid4()
    session_id = uuid.uuid4()

    encoded, expires = security.create_wire_ticket(user_id, session_id)
    claims = jwt.decode(
        encoded,
        "test-wire-ticket-secret-at-least-32-bytes",
        algorithms=["HS256"],
        audience="gram-wire",
        issuer=security.JWT_ISSUER,
    )

    assert claims["sub"] == str(user_id)
    assert claims["sid"] == str(session_id)
    assert claims["type"] == "wire_ticket"
    assert claims["jti"]
    assert claims["exp"] - claims["iat"] == 60
    assert 0 < (expires - datetime.now(UTC)).total_seconds() <= 60


def test_wire_ticket_fails_closed_without_dedicated_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(security, "WIRE_TICKET_SECRET", "")
    with pytest.raises(RuntimeError, match="not configured"):
        security.create_wire_ticket(uuid.uuid4(), uuid.uuid4())


def test_wire_ticket_binds_to_channel_when_requested(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(security, "WIRE_TICKET_SECRET", "test-wire-ticket-secret-at-least-32-bytes")
    monkeypatch.setattr(security, "WIRE_TICKET_TTL_SECONDS", 60)
    binding = bytes(range(32))
    confirmation = security.channel_binding_confirmation(binding)
    # The gateway derives base64url(SHA-256(binding)) too; that string is exactly 43 chars.
    assert len(confirmation) == 43

    encoded, _ = security.create_wire_ticket(uuid.uuid4(), uuid.uuid4(), channel_binding=confirmation)
    claims = jwt.decode(
        encoded,
        "test-wire-ticket-secret-at-least-32-bytes",
        algorithms=["HS256"],
        audience="gram-wire",
        issuer=security.JWT_ISSUER,
    )
    assert claims["cnf"] == confirmation

    # A ticket minted without a binding carries no cnf claim, so a gateway that keeps binding
    # optional still accepts it.
    unbound, _ = security.create_wire_ticket(uuid.uuid4(), uuid.uuid4())
    unbound_claims = jwt.decode(
        unbound,
        "test-wire-ticket-secret-at-least-32-bytes",
        algorithms=["HS256"],
        audience="gram-wire",
        issuer=security.JWT_ISSUER,
    )
    assert "cnf" not in unbound_claims


def test_wire_ticket_rejects_malformed_channel_binding(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(security, "WIRE_TICKET_SECRET", "test-wire-ticket-secret-at-least-32-bytes")
    for bad in ["", "too-short", "!" * 43, "A" * 42, "A" * 44]:
        with pytest.raises(ValueError, match="channel binding"):
            security.create_wire_ticket(uuid.uuid4(), uuid.uuid4(), channel_binding=bad)


@pytest.mark.asyncio
async def test_authenticated_client_can_mint_wire_ticket(
    client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(security, "WIRE_TICKET_SECRET", "test-wire-ticket-secret-at-least-32-bytes")
    monkeypatch.setattr(main_module, "WIRE_OUTBOX_ENABLED", True)
    monkeypatch.setattr(
        main_module, "WIRE_INTERNAL_SECRET", "test-wire-internal-secret-at-least-32-bytes"
    )
    login = await client.post(
        "/api/auth/login", json={"identifier": "leon", "password": DEMO_PASSWORD}
    )
    assert login.status_code == 200, login.text

    response = await client.post("/api/auth/wire-ticket")
    assert response.status_code == 200, response.text
    body = response.json()
    claims = jwt.decode(
        body["ticket"],
        "test-wire-ticket-secret-at-least-32-bytes",
        algorithms=["HS256"],
        audience="gram-wire",
        issuer=security.JWT_ISSUER,
    )
    assert claims["type"] == "wire_ticket"
    assert claims["sid"]
    assert claims["sub"]

    payload = {"user_id": claims["sub"], "session_id": claims["sid"]}
    missing_secret = await client.post("/api/internal/wire/session-check", json=payload)
    assert missing_secret.status_code == 404
    active = await client.post(
        "/api/internal/wire/session-check",
        json=payload,
        headers={"X-Gram-Wire-Internal": main_module.WIRE_INTERNAL_SECRET},
    )
    assert active.status_code == 200
    assert active.json() == {"active": True}
    assert active.headers["cache-control"] == "no-store"

    async with session_factory() as session, session.begin():
        backing = await session.get(RefreshSession, uuid.UUID(claims["sid"]))
        assert backing is not None
        backing.revoked_at = datetime.now(UTC)
    revoked = await client.post(
        "/api/internal/wire/session-check",
        json=payload,
        headers={"X-Gram-Wire-Internal": main_module.WIRE_INTERNAL_SECRET},
    )
    assert revoked.status_code == 200
    assert revoked.json() == {"active": False}


@pytest.mark.asyncio
async def test_wire_ticket_endpoint_fails_closed_when_unconfigured(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(security, "WIRE_TICKET_SECRET", "")
    login = await client.post(
        "/api/auth/login", json={"identifier": "leon", "password": DEMO_PASSWORD}
    )
    assert login.status_code == 200, login.text
    response = await client.post("/api/auth/wire-ticket")
    assert response.status_code == 503
    assert response.json() == {"detail": "GRAM Wire временно недоступен"}
