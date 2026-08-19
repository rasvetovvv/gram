"""Runtime configuration read from environment variables."""

from __future__ import annotations

import os
from pathlib import Path


def _database_url() -> str:
    url = os.getenv("DATABASE_URL", "postgresql+asyncpg://gram:gram@postgres:5432/gram")
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+asyncpg://", 1)
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


DATABASE_URL = _database_url()
AUTO_SEED = os.getenv("AUTO_SEED", "true").lower() not in {"0", "false", "no"}
CORS_ORIGINS = tuple(
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
    if origin.strip()
)
JWT_SECRET = os.getenv("JWT_SECRET", "local-only-change-this-gram-secret")
JWT_ISSUER = os.getenv("JWT_ISSUER", "gram-api")
ACCESS_TOKEN_MINUTES = int(os.getenv("ACCESS_TOKEN_MINUTES", "15"))
REFRESH_TOKEN_DAYS = int(os.getenv("REFRESH_TOKEN_DAYS", "30"))
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() in {"1", "true", "yes"}
COOKIE_DOMAIN = os.getenv("COOKIE_DOMAIN") or None
ENABLE_INTERNAL_LEDGER_TOPUPS = os.getenv("ENABLE_INTERNAL_LEDGER_TOPUPS", "true").lower() in {
    "1",
    "true",
    "yes",
}
# Warm the gift-artwork cache on startup so the catalogue renders without waiting on
# api.changes.tg, and keeps rendering if that host is unreachable later.
PREFETCH_GIFT_ART = os.getenv("PREFETCH_GIFT_ART", "true").lower() not in {"0", "false", "no"}
ACCESS_COOKIE = "gram_access"
REFRESH_COOKIE = "gram_refresh"
# Accounts signed in on this browser but not currently active keep their refresh token in a
# numbered cookie, so switching between them never needs the password again.
PARKED_COOKIE_PREFIX = "gram_alt_"
MAX_PARKED_ACCOUNTS = 4
MEDIA_ROOT = Path(os.getenv("MEDIA_ROOT", str(Path(__file__).resolve().parents[1] / "media")))
MAX_UPLOAD_BYTES = 5 * 1024 * 1024
# A clip is not a picture. Nothing is transcoded — the file is served as it arrived — so the
# ceiling is what a phone records in about half a minute and what a reader can afford to load.
MAX_VIDEO_BYTES = 64 * 1024 * 1024
DEMO_EMAIL = os.getenv("DEMO_EMAIL", "leon@gram.local")
DEMO_USERNAME = os.getenv("DEMO_USERNAME", "leon")
DEMO_PASSWORD = os.getenv("DEMO_PASSWORD", "GramDemo!2026")
