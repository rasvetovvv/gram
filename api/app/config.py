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


def secret_value(name: str, default: str = "", max_bytes: int = 4096) -> str:
    value = os.getenv(name, "").strip()
    file_name = os.getenv(f"{name}_FILE", "").strip()
    if value and file_name:
        message = f"{name} must use exactly one secret source"
        raise RuntimeError(message)
    if not file_name:
        if len(value.encode()) > max_bytes:
            message = f"{name} is too large"
            raise RuntimeError(message)
        return value or default
    path = Path(file_name)
    try:
        if not path.is_file() or path.stat().st_size not in range(1, max_bytes + 1):
            message = f"invalid {name} secret file"
            raise RuntimeError(message)
        loaded = path.read_text(encoding="utf-8").strip()
    except OSError as exc:
        message = f"cannot read {name} secret file"
        raise RuntimeError(message) from exc
    if not loaded or len(loaded.encode()) > max_bytes:
        message = f"invalid {name} secret file"
        raise RuntimeError(message)
    return loaded


DATABASE_URL = _database_url()
AUTO_SEED = os.getenv("AUTO_SEED", "true").lower() not in {"0", "false", "no"}
CORS_ORIGINS = tuple(
    origin.strip()
    for origin in os.getenv(
        "CORS_ORIGINS", "https://vexory.xyz,https://www.vexory.xyz"
    ).split(",")
    if origin.strip()
)
JWT_SECRET = os.getenv("JWT_SECRET", "local-only-change-this-gram-secret")
JWT_ISSUER = os.getenv("JWT_ISSUER", "gram-api")
# A protocol ticket is intentionally signed with a different key from ordinary access JWTs. The
# gateway can validate its narrow, one-minute credential without receiving the key that can mint a
# browser session. Empty means GRAM Wire is fail-closed and the ticket endpoint returns 503.
WIRE_TICKET_SECRET = secret_value("WIRE_TICKET_SECRET")
WIRE_TICKET_TTL_SECONDS = int(os.getenv("WIRE_TICKET_TTL_SECONDS", "60"))
WIRE_OUTBOX_ENABLED = os.getenv("WIRE_OUTBOX_ENABLED", "false").lower() in {
    "1",
    "true",
    "yes",
    "on",
}
WIRE_REDIS_URL = os.getenv("WIRE_REDIS_URL", "redis://redis:6379/0")
WIRE_INTERNAL_SECRET = secret_value("WIRE_INTERNAL_SECRET")
ACCESS_TOKEN_MINUTES = int(os.getenv("ACCESS_TOKEN_MINUTES", "15"))
REFRESH_TOKEN_DAYS = int(os.getenv("REFRESH_TOKEN_DAYS", "30"))
# How long a just-rotated refresh token still answers instead of being treated as stolen.
#
# A browser has one cookie jar and many in-flight requests. When the access cookie expires, two
# requests can both start a refresh; the second arrives holding the token the first already spent.
# Without a grace window that innocent race reads as credential theft and signs the person out —
# which is what was happening on this deployment several times a day. Thirty seconds is far longer
# than any real race and far shorter than a useful window for a stolen cookie.
REFRESH_GRACE_SECONDS = int(os.getenv("REFRESH_GRACE_SECONDS", "30"))
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() in {"1", "true", "yes"}
COOKIE_DOMAIN = os.getenv("COOKIE_DOMAIN") or None
ENABLE_INTERNAL_LEDGER_TOPUPS = os.getenv("ENABLE_INTERNAL_LEDGER_TOPUPS", "true").lower() in {
    "1",
    "true",
    "yes",
}
# Whether stars may be taken out of the site at all.
#
# Off by default and switched on deliberately, because the Telegram half of a payout is done by a
# person: a queue of requests nobody can settle is worse than a button that says it is closed. The
# read and cancel routes stay open regardless — anything already asked for has to remain visible,
# and cancelling has to keep working so nobody's stars are stranded in a queue that is not moving.
STAR_PAYOUTS_ENABLED = os.getenv("STAR_PAYOUTS_ENABLED", "false").lower() in {
    "1",
    "true",
    "yes",
    "on",
}
# Warm the gift-artwork cache on startup so the catalogue renders without waiting on
# api.changes.tg, and keeps rendering if that host is unreachable later.
PREFETCH_GIFT_ART = os.getenv("PREFETCH_GIFT_ART", "true").lower() not in {"0", "false", "no"}
ACCESS_COOKIE = "gram_access"
REFRESH_COOKIE = "gram_refresh"

# ─── Crypto payments (NOWPayments) ───────────────────────────────────────────────────────────
#
# Off unless a key is present, so a deployment without one behaves exactly as before: the site
# offers Telegram Stars only and every crypto endpoint answers "not configured" rather than 500.
NOWPAYMENTS_API_KEY = os.getenv("NOWPAYMENTS_API_KEY", "")
# The public key is what a hosted-checkout widget would use. Kept here so the frontend can be
# handed it later without another deploy; nothing signs anything with it.
NOWPAYMENTS_PUBLIC_KEY = os.getenv("NOWPAYMENTS_PUBLIC_KEY", "")
# Optional. When set, callbacks are verified by HMAC; when not, a callback is only a nudge and the
# payment is re-read over the API before anything is credited.
NOWPAYMENTS_IPN_SECRET = os.getenv("NOWPAYMENTS_IPN_SECRET", "")
NOWPAYMENTS_API_BASE = os.getenv("NOWPAYMENTS_API_BASE", "https://api.nowpayments.io/v1")
NOWPAYMENTS_TIMEOUT_SECONDS = float(os.getenv("NOWPAYMENTS_TIMEOUT_SECONDS", "20"))
# The currency the shop is priced in. One site star costs one unit of it — 5 ★ is 5 ₴ — and the
# crypto amount is quoted from this by the provider's own rate.
CRYPTO_PRICE_CURRENCY = os.getenv("CRYPTO_PRICE_CURRENCY", "uah")
# How long a crypto invoice is worth showing. The provider expires its own addresses; this only
# decides when we stop polling one and offer to open a new one.
CRYPTO_INVOICE_TTL_MINUTES = int(os.getenv("CRYPTO_INVOICE_TTL_MINUTES", "90"))
# Coins offered for a top-up, in the order they are shown. Every one of them is checked against the
# provider's live minimum for the amount being paid before it is offered, because those minimums
# differ by two orders of magnitude between chains — USDT on BSC moves for cents, USDT on TRON
# needs about eleven dollars — and listing a coin that cannot pay this pack is worse than omitting
# it. The label and network are ours: "USDT" alone is not an answer to "which network".
CRYPTO_COINS: tuple[tuple[str, str, str], ...] = (
    ("usdtbsc", "USDT", "BNB Smart Chain (BEP20)"),
    ("usdtton", "USDT", "TON"),
    ("usdtmatic", "USDT", "Polygon"),
    ("usdterc20", "USDT", "Ethereum (ERC20)"),
    ("usdtsol", "USDT", "Solana"),
    ("usdttrc20", "USDT", "Tron (TRC20)"),
    ("usdcbase", "USDC", "Base"),
    ("usdcbsc", "USDC", "BNB Smart Chain (BEP20)"),
    ("usdcmatic", "USDC", "Polygon"),
    ("usdc", "USDC", "Ethereum (ERC20)"),
    ("usdcsol", "USDC", "Solana"),
    ("ton", "TON", "TON"),
    ("trx", "TRX", "Tron"),
    ("bnbbsc", "BNB", "BNB Smart Chain"),
    ("btc", "BTC", "Bitcoin"),
    ("eth", "ETH", "Ethereum"),
    ("ltc", "LTC", "Litecoin"),
    ("sol", "SOL", "Solana"),
    ("doge", "DOGE", "Dogecoin"),
    ("xmr", "XMR", "Monero"),
)
# Accounts signed in on this browser but not currently active keep their refresh token in a
# numbered cookie, so switching between them never needs the password again.
PARKED_COOKIE_PREFIX = "gram_alt_"
MAX_PARKED_ACCOUNTS = 4
MEDIA_ROOT = Path(os.getenv("MEDIA_ROOT", str(Path(__file__).resolve().parents[1] / "media")))
MAX_UPLOAD_BYTES = 5 * 1024 * 1024
# A clip is not a picture. Nothing is transcoded — the file is served as it arrived — so the
# ceiling is what a phone records in about half a minute and what a reader can afford to load.
MAX_VIDEO_BYTES = 64 * 1024 * 1024
# A document is neither a picture nor a clip. The cap is what a reader can be expected to pull
# down over a phone connection without wondering whether the app has hung.
MAX_FILE_BYTES = 24 * 1024 * 1024
DEMO_EMAIL = os.getenv("DEMO_EMAIL", "leon@gram.local")
DEMO_USERNAME = os.getenv("DEMO_USERNAME", "leon")
DEMO_PASSWORD = os.getenv("DEMO_PASSWORD", "GramDemo!2026")
# Accounts that hold staff powers from the first seed onwards. Everyone else has to be granted
# them by an admin, and that grant is recorded in the audit log like every other decision.
FOUNDING_ADMINS = tuple(
    handle.strip().removeprefix("@").lower()
    for handle in os.getenv("FOUNDING_ADMINS", "rasvetovvv,gram").split(",")
    if handle.strip()
)

# --- Telegram Stars checkout -------------------------------------------------------------------
# Site stars are bought with Telegram Stars, and the charge happens inside our own bot: the site
# never touches a card. An order is created here, the buyer opens the bot through a deep link,
# pays there, and the bot calls back with the charge id.
TELEGRAM_BOT_USERNAME = os.getenv("TELEGRAM_BOT_USERNAME", "vexoryxyzbot").lstrip("@")
# The bot's own credential for the callback. It is a shared secret rather than a user session,
# because the bot acts on behalf of Telegram's payment, not on behalf of a signed-in reader.
BOT_API_SECRET = os.getenv("BOT_API_SECRET", "local-only-change-this-bot-secret")
# How long an unpaid order stays openable. Telegram invoices do not expire on their own, so the
# site decides: long enough to finish paying, short enough that a stale link cannot be revived.
STAR_ORDER_TTL_MINUTES = int(os.getenv("STAR_ORDER_TTL_MINUTES", "60"))
# How long after a payment a refund may be asked for. Telegram's own Stars refunds run on a
# similar horizon, and a purchase older than this has been part of the balance too long to unwind.
REFUND_WINDOW_DAYS = int(os.getenv("REFUND_WINDOW_DAYS", "14"))

# --- Email verification and password-login OTP ------------------------------------------------
EMAIL_AUTH_ENABLED = os.getenv("EMAIL_AUTH_ENABLED", "false").lower() in {"1", "true", "yes", "on"}
# Test-only compatibility switch. Production Compose pins this to false.
EMAIL_OTP_BYPASS = os.getenv("EMAIL_OTP_BYPASS", "false").lower() in {"1", "true", "yes", "on"}
EMAIL_OTP_SECRET = os.getenv("EMAIL_OTP_SECRET", "")
EMAIL_OTP_TTL_MINUTES = int(os.getenv("EMAIL_OTP_TTL_MINUTES", "10"))
EMAIL_OTP_MAX_ATTEMPTS = int(os.getenv("EMAIL_OTP_MAX_ATTEMPTS", "5"))
EMAIL_OTP_RESEND_SECONDS = int(os.getenv("EMAIL_OTP_RESEND_SECONDS", "60"))
EMAIL_OTP_MAX_SENDS = int(os.getenv("EMAIL_OTP_MAX_SENDS", "5"))
SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM = os.getenv("SMTP_FROM", "") or SMTP_USER
SMTP_SSL = os.getenv("SMTP_SSL", "false").lower() in {"1", "true", "yes", "on"}
SMTP_TLS = os.getenv("SMTP_TLS", "true").lower() in {"1", "true", "yes", "on"}
SITE_PUBLIC_URL = os.getenv("SITE_PUBLIC_URL", "https://vexory.xyz").rstrip("/")
