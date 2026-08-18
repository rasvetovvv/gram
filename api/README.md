# GRAM API

FastAPI + async SQLAlchemy service for real local accounts, social graph, feed, chats,
Stars, creator subscriptions, communities, collectible gifts, and username ownership.

## Local demo account

- Email: `leon@gram.local`
- Username: `leon`
- Password: `GramDemo!2026`

The password is local-only and can be overridden with `DEMO_PASSWORD`.

## Authentication

`POST /api/auth/register`, `/login`, `/refresh`, and `/logout` manage two HttpOnly
cookies: a short-lived JWT access credential and a rotating opaque refresh session.
Refresh credentials are stored only as SHA-256 hashes, rotation revokes the previous
session, and replay revokes the remaining active sessions for that account. Passwords
use Argon2 through `pwdlib`.

Browser requests must use `credentials: "include"`. `Authorization: Bearer <JWT>` is
also supported for API clients. CORS is credential-aware and limited by
`CORS_ORIGINS`.

## Additive migrations

Startup calls SQLAlchemy `create_all()`. All new capabilities are represented by new
tables (`auth_identities`, `refresh_sessions`, `user_preferences`, `star_wallets`,
`star_ledger`, `follows`, `creator_subscriptions`, `communities`, collectible metadata,
provenance, and ownership history), while the original public tables remain unchanged.
This is an idempotent additive migration path for an existing PostgreSQL volume: it
does not drop, truncate, or recreate data. The seed then repairs the named demo rows and
renames the retired collectible while leaving user-created rows intact.

Uploaded PNG/JPG/WEBP avatars and covers are validated with Pillow, limited to 5 MB,
served under `/media`, and persisted in the Docker `gram_media` volume.

`POST /api/stars/top-up` is a local payment-provider simulator. Set
`ENABLE_DEMO_TOPUPS=false` outside the local Docker environment until a real provider
webhook is connected; wallet transfers, purchases, and subscription ledger entries are
fully transactional regardless of that switch.

## Verification

```powershell
uv sync --all-groups
uv run ruff format --check app tests
uv run ruff check app tests
uv run ty check app
uv run pytest
```

OpenAPI is available at `http://localhost:8000/docs` when the Docker stack is running.
