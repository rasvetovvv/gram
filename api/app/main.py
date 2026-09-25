"""FastAPI application for the GRAM social messenger."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
import secrets
import uuid
from collections import Counter, defaultdict
from collections.abc import AsyncIterator, Iterable, Sequence
from contextlib import asynccontextmanager, suppress
from datetime import UTC, datetime, timedelta
from io import BytesIO
from typing import Annotated, Any, Literal, cast

import jwt
from fastapi import (
    Cookie,
    Depends,
    FastAPI,
    File,
    Form,
    Header,
    HTTPException,
    Path,
    Query,
    Request,
    Response,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, ConfigDict, ValidationError
from sqlalchemy import and_, delete, func, or_, select, true, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased
from starlette.concurrency import run_in_threadpool

from app import giftart, music, nowpayments
from app.config import (
    ACCESS_COOKIE,
    ACCESS_TOKEN_MINUTES,
    AUTO_SEED,
    BOT_API_SECRET,
    COOKIE_DOMAIN,
    COOKIE_SECURE,
    CORS_ORIGINS,
    CRYPTO_COINS,
    CRYPTO_INVOICE_TTL_MINUTES,
    CRYPTO_PRICE_CURRENCY,
    EMAIL_AUTH_ENABLED,
    EMAIL_OTP_BYPASS,
    EMAIL_OTP_MAX_ATTEMPTS,
    EMAIL_OTP_MAX_SENDS,
    EMAIL_OTP_RESEND_SECONDS,
    EMAIL_OTP_TTL_MINUTES,
    ENABLE_INTERNAL_LEDGER_TOPUPS,
    MAX_FILE_BYTES,
    MAX_PARKED_ACCOUNTS,
    MAX_UPLOAD_BYTES,
    MAX_VIDEO_BYTES,
    MEDIA_ROOT,
    NOWPAYMENTS_IPN_SECRET,
    PARKED_COOKIE_PREFIX,
    PREFETCH_GIFT_ART,
    REFRESH_COOKIE,
    REFRESH_GRACE_SECONDS,
    REFRESH_TOKEN_DAYS,
    REFUND_WINDOW_DAYS,
    SITE_PUBLIC_URL,
    STAR_ORDER_TTL_MINUTES,
    STAR_PAYOUTS_ENABLED,
    TELEGRAM_BOT_USERNAME,
    WIRE_INTERNAL_SECRET,
    WIRE_OUTBOX_ENABLED,
    WIRE_REDIS_URL,
)
from app.db import SessionFactory, create_schema, get_session
from app.email_auth import (
    email_code_hash,
    email_code_matches,
    ensure_email_auth_ready,
    mask_email,
    new_email_code,
    send_auth_code,
)
from app.gifts import (
    CATEGORIES,
    CATEGORY_LABELS,
    DESIGN_BY_SLUG,
)
from app.models import (
    AdminAction,
    AuthIdentity,
    Chat,
    ChatFolder,
    ChatFolderItem,
    ChatMember,
    Community,
    CommunityMember,
    ContentReport,
    CreatorSettings,
    CreatorSubscription,
    CryptoInvoice,
    CryptoPayoutDetails,
    EmailLoginChallenge,
    Follow,
    FollowRequest,
    Gift,
    GiftCollectible,
    GiftModel,
    GiftOffer,
    GiftShowcase,
    GiftTransfer,
    LegalReport,
    Message,
    MessageHide,
    MessageReaction,
    Notification,
    NotificationKind,
    PendingRegistration,
    Post,
    PostBookmark,
    PostComment,
    PostCommentLike,
    PostDraft,
    PostLike,
    PostMute,
    PostPollVote,
    PostRepost,
    PostView,
    PremiumEntitlement,
    ProfileStory,
    RealtimeOutbox,
    RefreshSession,
    StarLedger,
    StarPayout,
    StarPurchase,
    StarRefund,
    StarWallet,
    StoryView,
    User,
    UserBlock,
    UsernameAsset,
    UsernameOffer,
    UsernameOwnershipEvent,
    UsernameStatus,
    UserPreferences,
    UserProfileDetails,
    UserSettings,
    utcnow,
)
from app.moderation import (
    REASON_LABELS,
    VERIFICATION_LABELS,
    AdminAccountDelete,
    AdminActionOut,
    AdminBanRequest,
    AdminBroadcast,
    AdminCommunityOut,
    AdminCommunityUpdate,
    AdminCryptoInvoiceOut,
    AdminDecision,
    AdminDesignOut,
    AdminDesignUpdate,
    AdminGiftGrant,
    AdminGiftItem,
    AdminGiftTransfer,
    AdminGiftUpdate,
    AdminHideRequest,
    AdminInventoryOut,
    AdminLedgerOut,
    AdminNote,
    AdminOverviewOut,
    AdminOwnerTransfer,
    AdminPayoutOut,
    AdminPostItem,
    AdminRefundOut,
    AdminStarOrderOut,
    AdminStarsGrant,
    AdminUsernameGrant,
    AdminUsernameItem,
    AdminUserOut,
    AdminUserUpdate,
    LegalReportCreate,
    LegalReportOut,
    LegalReportReceipt,
    LegalReportResolve,
    ReportOut,
    ReportResolve,
)
from app.schemas import (
    MAX_OWNED_USERNAMES,
    MAX_POST_IMAGES,
    MIN_POLL_OPTIONS,
    AccountDeleteRequest,
    AccountSlot,
    AdminCryptoPaidIn,
    AuthResponse,
    AuthSessionOut,
    BadgeOffer,
    BadgeSelection,
    BotOrderOut,
    BotPaymentReport,
    BotPayoutOut,
    BotPayoutSettle,
    BotRefundApplied,
    BotRefundDecision,
    BotRefundOut,
    ChatAttachment,
    ChatAutodeleteUpdate,
    ChatFolderCreate,
    ChatFolderOut,
    ChatGiftRequest,
    ChatInfo,
    ChatLink,
    ChatMemberOut,
    ChatMessage,
    ChatStateUpdate,
    ChatSummary,
    CommunityCompact,
    CommunityCreate,
    CommunityOut,
    CommunityUpdate,
    CommunityUsernameAttach,
    CommunityVerification,
    CreatorAnalyticsOut,
    CreatorSeriesPoint,
    CreatorSettingsOut,
    CreatorSettingsUpdate,
    CryptoCoinOut,
    CryptoInvoiceCreate,
    CryptoInvoiceOut,
    CryptoPayoutDetailsOut,
    CryptoStatusOut,
    DetailResponse,
    EmailChallengeOut,
    EmailChallengeResendRequest,
    EmailCodeVerifyRequest,
    FeedPost,
    FollowRequestOut,
    FollowState,
    GiftCategoryOut,
    GiftCompact,
    GiftDesignOut,
    GiftListingUpdate,
    GiftMarketOut,
    GiftModelOut,
    GiftOfferCreate,
    GiftOfferOut,
    GiftOut,
    GiftProvenanceOut,
    GiftPurchaseOut,
    GiftPurchaseRequest,
    GiftShowcaseRequest,
    GiftTransferCreate,
    GiftVariantOut,
    GiftVisibilityUpdate,
    GroupAccessUpdate,
    GroupCreate,
    GroupInvitePreview,
    GroupMembersAdd,
    GroupUpdate,
    HealthResponse,
    LoginRequest,
    MessageCreate,
    MessageEdit,
    MessageForward,
    MessageQuote,
    MessageReactionOut,
    MyBadgesOut,
    NoteUpsert,
    NotificationOut,
    OffersToggle,
    PasswordChange,
    PollOption,
    PostCommentCreate,
    PostCommentEdit,
    PostCommentOut,
    PostCreate,
    PostDraftBody,
    PostDraftOut,
    PostEdit,
    PostMusic,
    PostPollOut,
    PostReportCreate,
    PostSchedule,
    PostViewReceipt,
    PremiumBenefit,
    PremiumEntitlementOut,
    PremiumGiftRequest,
    PremiumLimit,
    PremiumPaymentMethod,
    PremiumPlanOut,
    PremiumPurchaseRequest,
    ProfileBadge,
    ProfileNote,
    ProfileReplyOut,
    ProfileReplyParentPost,
    ProfileShowcaseUpdate,
    ProfileStoryCreate,
    ProfileStoryOut,
    ProfileUpdate,
    ReactionToggle,
    RegisterRequest,
    SearchResults,
    StarLedgerOut,
    StarPackageOut,
    StarPayoutCreate,
    StarPayoutOut,
    StarPurchaseCreate,
    StarPurchaseOut,
    StarRefundOut,
    StarRefundRequest,
    StarSendRequest,
    StarTopUpRequest,
    StarTransferReceipt,
    StoryCompact,
    StoryFeedEntry,
    StoryShare,
    StoryViewerOut,
    SubscriptionCreate,
    SubscriptionOut,
    ToggleState,
    TrendOut,
    UploadedFile,
    UploadedMedia,
    UserCompact,
    UsernameAssetOut,
    UsernameHistoryOut,
    UsernameListingUpdate,
    UsernameOfferCreate,
    UsernameOfferOut,
    UsernameReserve,
    UsernameTransfer,
    UserProfile,
    UserReportCreate,
    UserSettingsOut,
    UserSettingsUpdate,
    WalletOut,
)
from app.security import (
    create_access_token,
    create_wire_ticket,
    decode_access_token,
    hash_password,
    new_refresh_token,
    refresh_expiry,
    refresh_token_hash,
    verify_password,
)
from app.seed import seed_database
from app.wire_outbox import create_wire_redis, run_wire_outbox, run_wire_outbox_pruner

SessionDep = Annotated[AsyncSession, Depends(get_session)]
LEGENDARY_USERNAME_LENGTH = 4
RARE_USERNAME_LENGTH = 6
# What an address has to look like to be a handle anybody could hold. Channel slugs are looser —
# dashes, up to 48 characters — and one of those can never be a collectible username.
HANDLE_SHAPE = re.compile(r"[a-z][a-z0-9_]{2,31}")
MIN_USERNAME_LENGTH = 3
MAX_IMAGE_PIXELS = 40_000_000
DIRECT_CHAT_MEMBER_COUNT = 2
# The official account speaks for the platform: onboarding and security notices arrive
# as a normal direct chat, the way Telegram's service account does.
OFFICIAL_USERNAME = "gram"
# Shown instead of presence wherever the platform account appears, as in the reference.
OFFICIAL_ROLE_TITLE = "Служебные уведомления"
# How long a heartbeat vouches for someone being online; past it the profile says last seen.
PRESENCE_WINDOW = timedelta(minutes=5)
PRESENCE_SWEEP_SECONDS = 60
# Open complaints against one account before visitors are warned about it. Three is a run
# rather than one person's grudge, and it is deliberately visible before staff get to it —
# a queue nobody has reached yet is exactly when a reader most needs the hint.
HEAVILY_REPORTED = 3


async def _expire_presence() -> None:
    """
    Put out the green dot of anyone who stopped visiting.

    Nothing else does: the flag goes up when a request arrives and comes down on logout, so a
    closed tab used to leave someone «в сети» for good. Forty-three places read that flag, which
    is why the truth is restored here rather than re-derived in each of them.
    """
    while True:
        await asyncio.sleep(PRESENCE_SWEEP_SECONDS)
        try:
            async with SessionFactory() as session:
                cutoff = utcnow() - PRESENCE_WINDOW
                rows = (
                    await session.execute(
                        select(User.id, UserProfileDetails.last_seen_at)
                        .join(
                            UserProfileDetails,
                            UserProfileDetails.user_id == User.id,
                            isouter=True,
                        )
                        .where(User.is_online.is_(True))
                    )
                ).all()
                # Compared in Python: the column is timezone-aware on PostgreSQL and a plain
                # string on SQLite, and only one of those compares correctly in SQL.
                stale = [
                    user_id
                    for user_id, last_seen in rows
                    if last_seen is None or _as_utc(last_seen) <= cutoff
                ]
                if stale:
                    await session.execute(
                        update(User).where(User.id.in_(stale)).values(is_online=False)
                    )
                    await session.commit()
        except asyncio.CancelledError:
            raise
        except Exception:  # a housekeeping sweep must not take the app down
            logging.getLogger("gram.presence").exception("presence sweep failed")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Create additive tables and repair local seed data on startup."""
    ensure_email_auth_ready()
    if WIRE_OUTBOX_ENABLED and len(WIRE_INTERNAL_SECRET) < 32:
        raise RuntimeError("GRAM Wire internal authentication is not configured")
    MEDIA_ROOT.mkdir(parents=True, exist_ok=True)
    await create_schema()
    if AUTO_SEED:
        async with SessionFactory() as session:
            await seed_database(session)
    warm: asyncio.Task[int] | None = None
    if PREFETCH_GIFT_ART:
        # Warmed in the background: the catalogue renders from the cache a moment later, and a
        # container with no outbound network still starts and serves everything else.
        warm = asyncio.create_task(giftart.prefetch_originals())
    presence = asyncio.create_task(_expire_presence())
    wire_client = None
    wire_task: asyncio.Task[None] | None = None
    wire_pruner: asyncio.Task[None] | None = None
    if WIRE_OUTBOX_ENABLED:
        wire_client = create_wire_redis(WIRE_REDIS_URL)
        wire_task = asyncio.create_task(run_wire_outbox(SessionFactory, wire_client))
        # One social event writes one row per active account, so delivered receipts have to be
        # trimmed or the table grows with traffic forever. Redis holds the replay window.
        wire_pruner = asyncio.create_task(run_wire_outbox_pruner(SessionFactory))
    yield
    presence.cancel()
    for task in (wire_task, wire_pruner):
        if task is not None:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
    if wire_client is not None:
        await wire_client.aclose()
    if warm and not warm.done():
        warm.cancel()


app = FastAPI(
    title="GRAM API",
    version="0.2.0",
    description="Accounts, social graph, chats, Stars, communities, usernames, and gifts.",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(CORS_ORIGINS),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def protect_auth_responses(request: Request, call_next: Any) -> Response:
    """Pre-auth responses, including dependency/validation failures, must never be cached."""
    response = await call_next(request)
    if request.url.path.startswith(
        ("/api/auth/register", "/api/auth/login", "/api/auth/email/", "/api/internal/wire/")
    ):
        response.headers["Cache-Control"] = "no-store"
        response.headers["Pragma"] = "no-cache"
        response.headers["X-Robots-Tag"] = "noindex"
    return response


app.mount("/media", StaticFiles(directory=MEDIA_ROOT, check_dir=False), name="media")


def _as_utc(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def _client_ip(request: Request) -> str | None:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",", 1)[0].strip()[:64]
    return request.client.host[:64] if request.client else None


def _set_auth_cookies(response: Response, access_token: str, refresh_token: str) -> None:
    common: dict[str, Any] = {
        "httponly": True,
        "secure": COOKIE_SECURE,
        "samesite": "lax",
        "path": "/",
    }
    if COOKIE_DOMAIN:
        common["domain"] = COOKIE_DOMAIN
    response.set_cookie(
        ACCESS_COOKIE,
        access_token,
        max_age=ACCESS_TOKEN_MINUTES * 60,
        **common,
    )
    response.set_cookie(
        REFRESH_COOKIE,
        refresh_token,
        max_age=REFRESH_TOKEN_DAYS * 24 * 60 * 60,
        **common,
    )


def _set_access_cookie(response: Response, access_token: str) -> None:
    """
    Re-issue only the access cookie, leaving the refresh credential untouched.

    Used when a refresh request loses a race with a concurrent one: the winner has already written
    the new refresh token, so overwriting it here would replace a good credential with a stale one.
    """
    common: dict[str, Any] = {
        "httponly": True,
        "secure": COOKIE_SECURE,
        "samesite": "lax",
        "path": "/",
    }
    if COOKIE_DOMAIN:
        common["domain"] = COOKIE_DOMAIN
    response.set_cookie(
        ACCESS_COOKIE, access_token, max_age=ACCESS_TOKEN_MINUTES * 60, **common
    )


async def _revoke_session_chain(session: AsyncSession, row: RefreshSession) -> None:
    """
    Revoke one credential's own rotation chain — the row, its ancestors and its descendants.

    A reuse means *that* chain is compromised, not the account. Revoking every session (which this
    used to do) signed the person out of every other device as well, so one stale tab took the
    phone down with it.
    """
    doomed: set[uuid.UUID] = {row.id}

    # Forward: whatever this token was replaced by, and so on.
    cursor: RefreshSession | None = row
    while cursor is not None and cursor.replaced_by_id is not None:
        if cursor.replaced_by_id in doomed:
            break
        doomed.add(cursor.replaced_by_id)
        cursor = await session.get(RefreshSession, cursor.replaced_by_id)

    # Backward: whatever was replaced *by* this token, up the chain to the original sign-in.
    frontier = {row.id}
    while frontier:
        parents = set(
            (
                await session.scalars(
                    select(RefreshSession.id).where(RefreshSession.replaced_by_id.in_(frontier))
                )
            ).all()
        )
        frontier = parents - doomed
        doomed |= frontier

    await session.execute(
        update(RefreshSession)
        .where(RefreshSession.id.in_(doomed), RefreshSession.revoked_at.is_(None))
        .values(revoked_at=utcnow())
    )


def _clear_auth_cookies(response: Response) -> None:
    options: dict[str, Any] = {"path": "/", "secure": COOKIE_SECURE, "samesite": "lax"}
    if COOKIE_DOMAIN:
        options["domain"] = COOKIE_DOMAIN
    response.delete_cookie(ACCESS_COOKIE, **options)
    response.delete_cookie(REFRESH_COOKIE, **options)


def _cookie_options() -> dict[str, Any]:
    options: dict[str, Any] = {
        "httponly": True,
        "secure": COOKIE_SECURE,
        "samesite": "lax",
        "path": "/",
    }
    if COOKIE_DOMAIN:
        options["domain"] = COOKIE_DOMAIN
    return options


def _parked_tokens(request: Request) -> dict[str, str]:
    """
    Refresh tokens of accounts signed in on this browser but not currently active.

    They stay in httpOnly cookies for the same reason the active one does: the page must be
    able to switch accounts without ever holding a credential it could leak.
    """
    return {
        name: value
        for name, value in request.cookies.items()
        if name.startswith(PARKED_COOKIE_PREFIX) and value
    }


def _set_parked_cookie(response: Response, slot: str, token: str) -> None:
    response.set_cookie(slot, token, max_age=REFRESH_TOKEN_DAYS * 24 * 60 * 60, **_cookie_options())


def _clear_parked_cookie(response: Response, slot: str) -> None:
    options: dict[str, Any] = {"path": "/", "secure": COOKIE_SECURE, "samesite": "lax"}
    if COOKIE_DOMAIN:
        options["domain"] = COOKIE_DOMAIN
    response.delete_cookie(slot, **options)


def _free_parked_slot(taken: set[str]) -> str | None:
    for index in range(1, MAX_PARKED_ACCOUNTS + 1):
        slot = f"{PARKED_COOKIE_PREFIX}{index}"
        if slot not in taken:
            return slot
    return None


async def _live_session(session: AsyncSession, token: str) -> RefreshSession | None:
    """A refresh row that is still usable: present, unrevoked and unexpired."""
    row = await session.scalar(
        select(RefreshSession).where(RefreshSession.token_hash == refresh_token_hash(token))
    )
    if row is None or row.revoked_at is not None or _as_utc(row.expires_at) <= utcnow():
        return None
    return row


async def _drop_parked_slot(
    session: AsyncSession, request: Request, response: Response, *, user_id: uuid.UUID
) -> None:
    """Clear a parked slot for an account that is becoming the active one."""
    for slot, token in _parked_tokens(request).items():
        row = await _live_session(session, token)
        if row is None or row.user_id == user_id:
            _clear_parked_cookie(response, slot)


async def _park_active_session(
    session: AsyncSession, request: Request, response: Response, *, keep_user_id: uuid.UUID
) -> None:
    """
    Move the currently active account into a parked slot before another takes its place.

    Signing into a second account should not sign the first one out — that is the whole point
    of the switcher — so its refresh token is preserved rather than overwritten.
    """
    token = request.cookies.get(REFRESH_COOKIE)
    if not token:
        return
    row = await _live_session(session, token)
    if row is None or row.user_id == keep_user_id:
        return
    parked = _parked_tokens(request)
    # Already parked under some slot: nothing to do.
    for value in parked.values():
        if value == token:
            return
    slot = _free_parked_slot(set(parked))
    if slot is None:
        # The oldest slot makes way, and its session is revoked rather than left dangling.
        slot = f"{PARKED_COOKIE_PREFIX}1"
        evicted = await _live_session(session, parked[slot])
        if evicted is not None:
            evicted.revoked_at = utcnow()
    _set_parked_cookie(response, slot, token)


async def _new_session(
    session: AsyncSession, user: User, request: Request
) -> tuple[RefreshSession, str, str, datetime]:
    raw_refresh = new_refresh_token()
    auth_session = RefreshSession(
        user_id=user.id,
        token_hash=refresh_token_hash(raw_refresh),
        expires_at=refresh_expiry(),
        user_agent=(request.headers.get("user-agent") or "")[:300] or None,
        ip_address=_client_ip(request),
    )
    session.add(auth_session)
    await session.flush()
    access, access_expires = create_access_token(user.id, auth_session.id)
    return auth_session, raw_refresh, access, access_expires


async def _official_dm(session: AsyncSession, user: User, text: str) -> None:
    """
    Deliver a message from the official account into its direct chat with `user`.

    Silently does nothing when the official account is absent, so a database that predates
    it still registers and logs in normally.
    """
    official = await session.scalar(
        select(User).where(func.lower(User.username) == OFFICIAL_USERNAME)
    )
    if official is None or official.id == user.id:
        return
    candidate_ids = (
        select(ChatMember.chat_id)
        .where(ChatMember.user_id.in_([official.id, user.id]))
        .group_by(ChatMember.chat_id)
        .having(func.count(func.distinct(ChatMember.user_id)) == DIRECT_CHAT_MEMBER_COUNT)
    )
    chat = await session.scalar(
        select(Chat).where(
            Chat.id.in_(candidate_ids), Chat.is_group.is_(False), Chat.kind == "direct"
        )
    )
    if chat is None:
        chat = Chat(is_group=False, kind="direct")
        session.add(chat)
        await session.flush()
        session.add_all(
            [
                ChatMember(chat_id=chat.id, user_id=official.id),
                ChatMember(chat_id=chat.id, user_id=user.id),
            ]
        )
    session.add(Message(chat_id=chat.id, sender_id=official.id, content=text))


def _describe_device(request: Request) -> str:
    """
    A short "browser on platform" label from the User-Agent.

    Deliberately crude: the notice only needs to be recognisable enough for someone to say
    "that wasn't me", and parsing UA strings precisely is a losing game.
    """
    agent = request.headers.get("user-agent") or ""
    browser = "Неизвестный браузер"
    for name, marker in (
        ("Edge", "Edg/"),
        ("Opera", "OPR/"),
        ("Chrome", "Chrome/"),
        ("Firefox", "Firefox/"),
        ("Safari", "Version/"),
    ):
        if marker in agent:
            version = agent.split(marker, 1)[1].split(".", 1)[0].split(" ", 1)[0]
            browser = f"{name} {version}" if version.isdigit() else name
            break
    platform = next(
        (
            label
            for label, marker in (
                ("Windows", "Windows"),
                ("macOS", "Mac OS"),
                ("Android", "Android"),
                ("iOS", "iPhone"),
                ("iPadOS", "iPad"),
                ("Linux", "Linux"),
            )
            if marker in agent
        ),
        "неизвестная система",
    )
    return f"GRAM Web, {browser}, {platform}"


async def _notify_new_device(session: AsyncSession, user: User, request: Request) -> None:
    """
    Announce every sign-in in the official chat, as the reference does.

    Keying this on an unseen User-Agent was worse than useless: anyone who signs in from the
    same browser twice never hears from it again, so the notice they most need to see — a
    stranger's session — is the one case indistinguishable from their own.
    """
    now = utcnow()
    await _official_dm(
        session,
        user,
        "Новый вход. "
        f"{user.display_name}, зафиксирован вход в аккаунт с нового устройства "
        f"{now.strftime('%d/%m/%Y')} в {now.strftime('%H:%M:%S')} UTC.\n\n"
        f"Устройство: {_describe_device(request)}\n"
        "Если это были не вы — завершите сеанс в «Настройки → Устройства» "
        "и смените пароль.",
    )


async def _touch_presence(
    session: AsyncSession, user: User, *, online: bool, force: bool = False
) -> bool:
    now = utcnow()
    details = await session.get(UserProfileDetails, user.id)
    if details is None:
        details = UserProfileDetails(user_id=user.id, last_seen_at=now)
        session.add(details)
        user.is_online = await _presence_allowed(session, user) and online
        return True
    recent = details.last_seen_at and now - _as_utc(details.last_seen_at) < timedelta(seconds=45)
    if not force and user.is_online == online and recent:
        return False
    details.last_seen_at = now
    # Someone who switched presence off never lights the flag, so none of the forty-three
    # surfaces that read it has to remember the setting. The heartbeat is still recorded: it
    # is what the last-seen line is measured from, and what the owner sees on their own page.
    user.is_online = online and await _presence_allowed(session, user)
    return True


async def _presence_allowed(session: AsyncSession, user: User) -> bool:
    """Whether this account lets others see it online at all."""
    settings = await session.get(UserSettings, user.id)
    return settings is None or settings.show_online


async def get_current_user(request: Request, session: SessionDep) -> User:
    """Authenticate an access JWT and its still-active server session."""
    authorization = request.headers.get("authorization", "")
    token = authorization[7:].strip() if authorization.lower().startswith("bearer ") else None
    token = token or request.cookies.get(ACCESS_COOKIE)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Требуется авторизация"
        )
    try:
        payload = decode_access_token(token)
        user_id = uuid.UUID(str(payload["sub"]))
        session_id = uuid.UUID(str(payload["sid"]))
    except (jwt.PyJWTError, KeyError, TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Сессия недействительна"
        ) from exc
    row = await session.scalar(
        select(RefreshSession).where(
            RefreshSession.id == session_id,
            RefreshSession.user_id == user_id,
            RefreshSession.revoked_at.is_(None),
            RefreshSession.expires_at > utcnow(),
        )
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Сессия завершена")
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Аккаунт не найден")
    _refuse_banned_write(request, user)
    if await _touch_presence(session, user, online=True):
        await session.commit()
    return user


# Anything that changes state. A banned account keeps reading — it has to be able to open its own
# profile and see the reason — but every write is refused, because that is what a block has to
# mean. Revoking the session instead would only sign them out, and signing back in worked.
WRITE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
# Signing out and rotating one's own credential stay open: locking somebody into a session they
# cannot end would be a different kind of punishment from the one a moderator chose.
BANNED_WRITE_ALLOWED = frozenset({"/api/auth/logout", "/api/auth/refresh"})


def _refuse_banned_write(request: Request, user: User) -> None:
    if user.banned_at is None:
        return
    if request.method not in WRITE_METHODS or request.url.path in BANNED_WRITE_ALLOWED:
        return
    reason = f" Причина: {user.ban_reason}" if user.ban_reason else ""
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=f"Аккаунт заблокирован администрацией.{reason}",
    )


def _refuse_banned_recipient(user: User) -> None:
    """
    A present cannot be delivered to a blocked account.

    Not merely cosmetic: the collectible would be minted, the stars spent, and the recipient
    unable to open, upgrade or transfer any of it — so the purchase is refused before the charge.
    """
    if user.banned_at is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"@{user.username} заблокирован администрацией — подарок не дойдёт",
        )


CurrentUser = Annotated[User, Depends(get_current_user)]


async def premium_user_ids(
    session: AsyncSession, user_ids: Sequence[uuid.UUID]
) -> set[uuid.UUID]:
    """
    Which of these accounts hold active premium, in one query.

    Batched on purpose: the premium mark appears next to every name, and a per-name query
    would multiply with the length of a feed or a thread.
    """
    if not user_ids:
        return set()
    rows = await session.scalars(
        select(PremiumEntitlement.user_id).where(
            PremiumEntitlement.user_id.in_(set(user_ids)),
            PremiumEntitlement.active.is_(True),
            PremiumEntitlement.expires_at > utcnow(),
        )
    )
    return set(rows.all())


async def presence_hidden_ids(
    session: AsyncSession, user_ids: list[uuid.UUID]
) -> set[uuid.UUID]:
    """
    Which of these people have switched presence off, in one query.

    Batched for the same reason premium is: a feed of thirty posts must not become thirty
    settings lookups just to decide whether to draw a green dot.
    """
    if not user_ids:
        return set()
    rows = await session.scalars(
        select(UserSettings.user_id).where(
            UserSettings.user_id.in_(set(user_ids)), UserSettings.show_online.is_(False)
        )
    )
    return set(rows.all())


async def name_gift_map(
    session: AsyncSession, user_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, GiftCompact]:
    """
    The gift each of these people put in their name slot, in one query.

    The emblem sits beside a name in the feed and in a thread, so it is batched for the same
    reason the premium mark is. A showcased gift that has since changed hands is skipped:
    the marker advertises what its wearer owns now.
    """
    if not user_ids:
        return {}
    rows = (
        await session.execute(
            select(GiftShowcase.user_id, Gift)
            .join(Gift, GiftShowcase.gift_id == Gift.id)
            .where(
                GiftShowcase.user_id.in_(set(user_ids)),
                GiftShowcase.slot == "name",
                Gift.owner_id == GiftShowcase.user_id,
            )
        )
    ).all()
    return {user_id: compact_gift(gift) for user_id, gift in rows}


def compact_user(
    user: User,
    *,
    is_premium: bool = False,
    hide_presence: bool = False,
    name_gift: GiftCompact | None = None,
) -> UserCompact:
    return UserCompact(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        avatar_url=user.avatar_url,
        is_verified=user.is_verified,
        verified=user.is_verified,
        # The stored tier wins; a verified account from before tiers existed still reads as
        # official rather than losing its explanation.
        verification_tier=user.verification_tier or ("official" if user.is_verified else None),
        # Someone who hides their presence is never advertised as online, wherever they appear.
        is_online=user.is_online and not hide_presence,
        profile_color=user.profile_color or "default",
        is_premium=is_premium,
        is_admin=user.is_admin,
        is_banned=user.banned_at is not None,
        is_official=user.username.lower() == OFFICIAL_USERNAME,
        role_title=OFFICIAL_ROLE_TITLE if user.username.lower() == OFFICIAL_USERNAME else None,
        name_gift=name_gift,
    )


def compact_gift(gift: Gift) -> GiftCompact:
    return GiftCompact(
        id=gift.id,
        slug=gift.slug,
        name=gift.name,
        image_url=gift.image_url,
        accent=gift.accent,
        rarity=gift.rarity,
        serial_number=gift.serial_number,
        art=gift.art or "orb",
        pattern=gift.pattern or "star",
        backdrop_edge=gift.backdrop_edge or "#08080a",
        model_name=gift.model_name or "",
        pattern_color=gift.pattern_color or "#ffffff",
        upgraded=gift.upgraded_at is not None,
        message=gift.message,
    )


def profile_story_out(
    story: ProfileStory,
    author: User,
    *,
    views_count: int = 0,
    seen: bool = False,
    is_mine: bool = False,
) -> ProfileStoryOut:
    return ProfileStoryOut(
        id=story.id,
        author=compact_user(author),
        title=story.title,
        media_url=story.media_url,
        created_at=story.created_at,
        expires_at=story.expires_at,
        highlight=story.highlight,
        views_count=views_count,
        seen=seen,
        is_mine=is_mine,
    )


def compact_story(story: ProfileStory, author: User) -> StoryCompact:
    """The card a chat bubble draws for a shared story."""
    return StoryCompact(
        id=story.id,
        author=compact_user(author),
        title=story.title,
        media_url=story.media_url,
        created_at=story.created_at,
        expires_at=story.expires_at,
        # A highlight has no window at all; anything else is live until its own moment passes.
        active=story.expires_at is None or _as_utc(story.expires_at) > utcnow(),
    )


async def render_profile(
    session: AsyncSession, user: User, me: User
) -> UserProfile:
    preferences = await session.get(UserPreferences, user.id)
    details = await session.get(UserProfileDetails, user.id)
    creator_settings = await session.get(CreatorSettings, user.id)
    is_premium = user.id in await premium_user_ids(session, [user.id])
    posts_count = int(
        await session.scalar(
            select(func.count()).select_from(Post).where(Post.author_id == user.id)
        )
        or 0
    )
    following = False
    subscribed = False
    blocked = False
    blocked_me = False
    requested = False
    requests_waiting = 0
    if user.id == me.id:
        requests_waiting = int(
            await session.scalar(
                select(func.count())
                .select_from(FollowRequest)
                .where(FollowRequest.target_id == me.id)
            )
            or 0
        )
    if user.id != me.id:
        following = bool(
            await session.scalar(
                select(func.count())
                .select_from(Follow)
                .where(Follow.follower_id == me.id, Follow.following_id == user.id)
            )
        )
        subscribed = bool(
            await session.scalar(
                select(func.count())
                .select_from(CreatorSubscription)
                .where(
                    CreatorSubscription.subscriber_id == me.id,
                    CreatorSubscription.creator_id == user.id,
                    CreatorSubscription.active.is_(True),
                )
            )
        )
        blocked = bool(
            await session.scalar(
                select(func.count())
                .select_from(UserBlock)
                .where(UserBlock.blocker_id == me.id, UserBlock.blocked_id == user.id)
            )
        )
        blocked_me = bool(
            await session.scalar(
                select(func.count())
                .select_from(UserBlock)
                .where(UserBlock.blocker_id == user.id, UserBlock.blocked_id == me.id)
            )
        )
        requested = bool(
            await session.scalar(
                select(func.count())
                .select_from(FollowRequest)
                .where(FollowRequest.requester_id == me.id, FollowRequest.target_id == user.id)
            )
        )
    showcases = (
        await session.execute(
            select(GiftShowcase.slot, Gift)
            .join(Gift, GiftShowcase.gift_id == Gift.id)
            # A showcased gift can change hands, so only still-owned items are advertised.
            .where(GiftShowcase.user_id == user.id, Gift.owner_id == user.id)
        )
    ).all()
    gifts = {slot: compact_gift(gift) for slot, gift in showcases}
    wallet = await session.get(StarWallet, user.id) if user.id == me.id else None
    identity = compact_user(user).model_dump()
    # UserProfile declares role_title, is_premium and name_gift itself, from richer sources than
    # the compact view has; drop the stand-ins so the spread does not collide with them.
    identity.pop("role_title", None)
    identity.pop("is_premium", None)
    identity.pop("name_gift", None)
    last_seen_at = details.last_seen_at if details else None
    identity["is_online"] = bool(
        user.is_online and last_seen_at and _as_utc(last_seen_at) > utcnow() - PRESENCE_WINDOW
    )
    owned_handles = (
        await session.scalars(
            select(UsernameAsset.username)
            .where(UsernameAsset.owner_id == user.id, UsernameAsset.community_id.is_(None))
            .order_by(UsernameAsset.username)
        )
    ).all()
    # Every handle this account holds, channel addresses included. `owned_handles` above is the
    # personal collection — what the automatic list offers and what the cap counts — while this is
    # the wider set that says whether a handle is *allowed* on the profile at all.
    owned_any = {
        handle.lower()
        for handle in (
            await session.scalars(
                select(UsernameAsset.username).where(UsernameAsset.owner_id == user.id)
            )
        ).all()
    }
    # What the "also known as" strip lists, and it is a decision the owner makes rather than a
    # derived set.
    #
    # `usernames_auto` is on until the profile form is saved once. While it is on the list is every
    # handle the account owns, which is the right default before anybody has expressed a preference.
    # Once it is off, `related_usernames` *is* the list — including when it is empty. That is the
    # whole fix for a removed handle coming straight back: the old code merged the owned handles in
    # unconditionally, so deleting one and saving simply put it back on the next read.
    #
    # Either way a handle has to be one this account still holds. The old test only rejected handles
    # *somebody else* owns, so a name that had been released, or was never registered at all, sat in
    # the list forever: it showed under the name and the edit sheet — which offers owned handles —
    # had no row to switch off, making it unremovable by any means the owner had.
    chosen = (
        [*(user.related_usernames or []), *owned_handles]
        if user.usernames_auto
        else list(user.related_usernames or [])
    )
    related: list[str] = []
    for handle in chosen:
        normalized = handle.strip().removeprefix("@").lower()
        if not normalized or normalized == user.username.lower() or normalized in related:
            continue
        if normalized not in owned_any:
            continue
        related.append(normalized)
    # The owner's own switches: presence and content visibility are theirs to set, and the
    # profile is where every other screen reads the result from.
    settings = await session.get(UserSettings, user.id)
    # Open complaints against this account, which is what raises the public warning. Resolved
    # ones are deliberately excluded: a report a moderator has already dismissed must not keep
    # marking somebody for good.
    reports_open = int(
        await session.scalar(
            select(func.count())
            .select_from(ContentReport)
            .where(ContentReport.subject_id == user.id, ContentReport.status == "open")
        )
        or 0
    )
    presence_hidden = bool(settings is not None and not settings.show_online)
    is_private = bool(settings is not None and settings.private_account)
    mine = user.id == me.id
    if presence_hidden and not mine:
        identity["is_online"] = False
        last_seen_at = None
    if mine:
        # Your own page answers "am I here", which your heartbeat knows regardless of what the
        # switch lets other people see — and the flag itself is off while presence is hidden.
        identity["is_online"] = bool(
            last_seen_at and _as_utc(last_seen_at) > utcnow() - PRESENCE_WINDOW
        )
    return UserProfile(
        **identity,
        cover_url=user.cover_url,
        bio=user.bio,
        location=user.location,
        related_usernames=related,
        # The whole collection, and the ceiling on it. The edit sheet needs both: it offers these as
        # the handles that may be shown, and it can say how much room is left instead of letting a
        # save come back as a 409.
        owned_usernames=[handle.lower() for handle in owned_handles],
        max_usernames=MAX_OWNED_USERNAMES,
        # What the account chose to wear, not everything it has: badges are a decision now, and
        # a free profile shows three of them where Premium shows seven.
        badges=profile_badges(shown_badge_slugs(user, is_premium=is_premium)),
        banned_at=user.banned_at,
        # The reason is public: a ban a visitor cannot see the grounds for looks arbitrary, and
        # the account itself has to be told the same thing everyone else reads.
        ban_reason=user.ban_reason,
        reports_count=reports_open,
        heavily_reported=reports_open >= HEAVILY_REPORTED,
        followers_count=user.followers_count,
        following_count=user.following_count,
        joined_at=user.joined_at,
        note=details.profile_note if details else None,
        can_edit_note=user.id == me.id,
        is_me=user.id == me.id,
        is_following=following,
        is_subscribed=subscribed,
        is_blocked=blocked,
        blocked_me=blocked_me,
        posts_count=posts_count,
        stars_balance=wallet.balance if wallet else None,
        featured_gift=gifts.get("featured"),
        name_gift=gifts.get("name"),
        cover_gifts=[gifts[slot] for slot in COVER_SLOTS if slot in gifts],
        interests=preferences.interests if preferences else [],
        onboarding_complete=preferences.onboarding_complete if preferences else True,
        website_url=details.website_url if details else None,
        birthday=details.birthday if details else None,
        github_url=details.github_url if details else None,
        telegram_url=details.telegram_url if details else None,
        profile_song_title=details.profile_song_title if details else None,
        profile_song_artist=details.profile_song_artist if details else None,
        profile_song_url=details.profile_song_url if details else None,
        featured_community_slug=details.featured_community_slug if details else None,
        featured_community_slugs=list(
            (details.featured_community_slugs if details else None)
            or ([details.featured_community_slug] if details and details.featured_community_slug else [])
        ),
        role_title=details.role_title if details else None,
        streak_days=details.streak_days if details else 0,
        last_seen_at=last_seen_at,
        presence_hidden=presence_hidden,
        status_emoji=settings.status_emoji if settings else None,
        status_text=settings.status_text if settings else None,
        is_private=is_private,
        # Own profile, a public one, or one whose owner I follow: the tabs stay open. Being
        # blocked closes them whatever the account's own privacy says.
        can_view_content=bool(mine or (not blocked_me and (not is_private or following))),
        follow_requested=requested,
        follow_requests_count=requests_waiting,
        updated_at=details.updated_at if details else None,
        paid_subscription_enabled=(
            creator_settings.paid_subscription_enabled if creator_settings else False
        ),
        subscription_price_stars=(
            creator_settings.monthly_price
            if creator_settings and creator_settings.paid_subscription_enabled
            else None
        ),
        is_premium=is_premium,
    )


BADGE_CATALOG: dict[str, dict[str, Any]] = {
    "official": {
        "title": "Официальный аккаунт",
        "description": "Официальный аккаунт GRAM.",
        "qualification": "Принадлежит команде платформы. Единственный настоящий @gram.",
        "rarity": "legendary",
        "points": 100,
    },
    "founder": {
        "title": "Основатель",
        "description": "Основатель GRAM.",
        "qualification": "Создатель и владелец платформы GRAM.",
        "rarity": "legendary",
        "points": 100,
    },
    "legend": {
        "title": "Легенда",
        "description": "Легенда сообщества.",
        "qualification": "Исключительный вклад в жизнь GRAM.",
        "rarity": "legendary",
        "points": 90,
    },
    "sponsor": {
        "title": "Официальный спонсор",
        "description": "Официальный спонсор GRAM.",
        "qualification": "Финансово поддерживает развитие платформы.",
        "rarity": "legendary",
        "points": 75,
    },
    "maker": {
        "title": "Разработчик",
        "description": "Разработчик / технический партнёр.",
        "qualification": "Разработчик или технический партнёр GRAM.",
        "rarity": "epic",
        "points": 50,
    },
    "collector": {
        "title": "Коллекционер",
        "description": "Коллекционер редких предметов.",
        "qualification": "Владеет коллекционными подарками и юзернеймами.",
        "rarity": "epic",
        "points": 50,
    },
    "sniper": {
        "title": "Снайпер",
        "description": "Снайпер юзернеймов.",
        "qualification": "Первым занял редкий освободившийся юзернейм.",
        "rarity": "epic",
        "points": 45,
    },
    "night_player": {
        "title": "Ночной игрок",
        "description": "Активен по ночам.",
        "qualification": "Регулярная активность в ночные часы.",
        "rarity": "rare",
        "points": 30,
    },
    "og": {
        "title": "OG GRAM",
        "description": "Один из первых участников.",
        "qualification": "Зарегистрирован в первой волне запуска.",
        "rarity": "rare",
        "points": 30,
    },
    "early": {
        "title": "Ранний участник",
        "description": "Ранний участник GRAM.",
        "qualification": "Присоединился в раннем доступе.",
        "rarity": "rare",
        "points": 25,
    },
    # Everything below is earned rather than granted: the rule beside each one is checked against
    # the account's own record, so a badge is a fact about somebody and not a favour.
    "premium": {
        "title": "Premium",
        "description": "Подписка GRAM Premium.",
        "qualification": "Активная подписка GRAM Premium.",
        "rarity": "epic",
        "points": 40,
    },
    "verified": {
        "title": "Подтверждён",
        "description": "Профиль подтверждён GRAM.",
        "qualification": "Профиль прошёл подтверждение.",
        "rarity": "epic",
        "points": 40,
    },
    "curator": {
        "title": "Куратор коллекции",
        "description": "Большая коллекция подарков.",
        "qualification": "20 коллекционных подарков в собственности.",
        "rarity": "epic",
        "points": 55,
    },
    "upgrader": {
        "title": "Улучшитель",
        "description": "Улучшал подарки за звёзды.",
        "qualification": "Хотя бы один улучшенный подарок.",
        "rarity": "rare",
        "points": 25,
    },
    "gifter": {
        "title": "Даритель",
        "description": "Дарит подарки другим.",
        "qualification": "5 подарков отправлено другим людям.",
        "rarity": "rare",
        "points": 30,
    },
    "handler": {
        "title": "Владелец имён",
        "description": "Держит несколько юзернеймов.",
        "qualification": "3 юзернейма в собственности.",
        "rarity": "rare",
        "points": 30,
    },
    "author": {
        "title": "Автор",
        "description": "Пишет в GRAM регулярно.",
        "qualification": "10 публикаций.",
        "rarity": "common",
        "points": 15,
    },
    "writer": {
        "title": "Публицист",
        "description": "Много публикаций.",
        "qualification": "50 публикаций.",
        "rarity": "rare",
        "points": 35,
    },
    "storyteller": {
        "title": "Рассказчик",
        "description": "Ведёт истории.",
        "qualification": "5 опубликованных историй.",
        "rarity": "common",
        "points": 15,
    },
    "commenter": {
        "title": "Собеседник",
        "description": "Отвечает и обсуждает.",
        "qualification": "25 комментариев.",
        "rarity": "common",
        "points": 15,
    },
    "popular": {
        "title": "Популярный",
        "description": "Много подписчиков.",
        "qualification": "100 подписчиков.",
        "rarity": "rare",
        "points": 35,
    },
    "voice": {
        "title": "Голос GRAM",
        "description": "Очень много подписчиков.",
        "qualification": "1000 подписчиков.",
        "rarity": "legendary",
        "points": 70,
    },
    "channel": {
        "title": "Владелец канала",
        "description": "Ведёт свой канал.",
        "qualification": "Собственный канал в GRAM.",
        "rarity": "rare",
        "points": 30,
    },
    "starman": {
        "title": "Звёздный",
        "description": "Поддерживает других звёздами.",
        "qualification": "5 отправок звёзд другим людям.",
        "rarity": "rare",
        "points": 25,
    },
    "veteran": {
        "title": "Ветеран",
        "description": "В GRAM больше года.",
        "qualification": "Аккаунту больше 365 дней.",
        "rarity": "epic",
        "points": 45,
    },
    "streak": {
        "title": "Серия",
        "description": "Заходит каждый день.",
        "qualification": "Серия визитов 7 дней и больше.",
        "rarity": "common",
        "points": 20,
    },
    "chatter": {
        "title": "Разговорчивый",
        "description": "Много сообщений в чатах.",
        "qualification": "100 отправленных сообщений.",
        "rarity": "common",
        "points": 15,
    },
}

# What each earned badge actually needs: a metric from `badge_metrics` and the number to reach.
# Badges outside this map are staff-granted — they arrive in `users.badges` and cannot be earned.
BADGE_RULES: dict[str, tuple[str, int]] = {
    "premium": ("premium", 1),
    "verified": ("verified", 1),
    "collector": ("gifts", 5),
    "curator": ("gifts", 20),
    "upgrader": ("upgraded_gifts", 1),
    "gifter": ("gifts_sent", 5),
    "sniper": ("usernames_bought", 1),
    "handler": ("usernames", 3),
    "author": ("posts", 10),
    "writer": ("posts", 50),
    "storyteller": ("stories", 5),
    "commenter": ("comments", 25),
    "popular": ("followers", 100),
    "voice": ("followers", 1000),
    "channel": ("communities", 1),
    "starman": ("stars_sent", 5),
    "night_player": ("night_posts", 1),
    "og": ("account_days", 180),
    "early": ("account_days", 90),
    "veteran": ("account_days", 365),
    "streak": ("streak_days", 7),
    "chatter": ("messages", 100),
}

# How many badges an account may wear at once.
FREE_BADGE_SLOTS = 3
PREMIUM_BADGE_SLOTS = 7
# Anything published before this hour counts as a night post — the «Ночной игрок» rule.
NIGHT_HOUR_END = 5


def badge_out(slug: str) -> ProfileBadge:
    """Badges are stored as slugs, so presentation data comes from one shared catalog."""
    entry = BADGE_CATALOG.get(slug) or {
        "title": slug.replace("_", " ").capitalize(),
        "description": "Достижение профиля.",
        "qualification": "Особый статус участника GRAM.",
        "rarity": "common",
        "points": 10,
    }
    return ProfileBadge(
        id=uuid.uuid5(uuid.NAMESPACE_URL, f"gram:badge:{slug}"),
        slug=slug,
        title=entry["title"],
        image_url=entry.get("image_url"),
        description=entry["description"],
        qualification=entry["qualification"],
        rarity=entry["rarity"],
        points=entry["points"],
        issuer=entry.get("issuer", "GRAM"),
    )


def profile_badges(values: list[str] | None) -> list[ProfileBadge]:
    return [badge_out(slug) for slug in values or []]


def badge_slot_limit(*, is_premium: bool) -> int:
    """Premium wears more. Everything else about badges is the same for everybody."""
    return PREMIUM_BADGE_SLOTS if is_premium else FREE_BADGE_SLOTS


def shown_badge_slugs(user: User, *, is_premium: bool) -> list[str]:
    """
    What a profile displays.

    The account's own choice, trimmed to what its plan allows — a Premium subscription that
    lapses should quietly show fewer badges, not keep seven forever. An account that never chose
    shows what staff granted it, so nobody's tick disappeared the day picking arrived.
    """
    limit = badge_slot_limit(is_premium=is_premium)
    chosen = [slug for slug in (user.badge_slots or []) if slug]
    if chosen:
        return chosen[:limit]
    granted = list(user.badges or [])
    granted.sort(key=lambda slug: -int(BADGE_CATALOG.get(slug, {}).get("points", 0)))
    return granted[:limit]


async def badge_metrics(session: AsyncSession, user: User, *, is_premium: bool) -> dict[str, int]:
    """
    The numbers every earned badge is measured against.

    One count per table rather than one per badge: a dozen badges share these totals, and a
    profile's badge picker should not cost twenty round trips.
    """

    async def count(statement: Any) -> int:
        return int(await session.scalar(statement) or 0)

    details = await session.get(UserProfileDetails, user.id)
    night = await session.scalar(
        select(func.count())
        .select_from(Post)
        .where(Post.author_id == user.id, func.extract("hour", Post.created_at) < NIGHT_HOUR_END)
    )
    return {
        "premium": int(is_premium),
        "verified": int(user.is_verified),
        "gifts": await count(
            select(func.count()).select_from(Gift).where(Gift.owner_id == user.id)
        ),
        "upgraded_gifts": await count(
            select(func.count())
            .select_from(Gift)
            .where(Gift.owner_id == user.id, Gift.upgraded_at.is_not(None))
        ),
        "gifts_sent": await count(
            select(func.count())
            .select_from(Gift)
            .where(Gift.sender_id == user.id, Gift.owner_id != user.id)
        ),
        "usernames": await count(
            select(func.count()).select_from(UsernameAsset).where(UsernameAsset.owner_id == user.id)
        ),
        "usernames_bought": await count(
            select(func.count())
            .select_from(UsernameOwnershipEvent)
            .where(
                UsernameOwnershipEvent.to_user_id == user.id,
                UsernameOwnershipEvent.action.in_(["acquired", "offer_accepted"]),
            )
        ),
        "posts": await count(
            select(func.count()).select_from(Post).where(Post.author_id == user.id)
        ),
        "stories": await count(
            select(func.count()).select_from(ProfileStory).where(ProfileStory.author_id == user.id)
        ),
        "comments": await count(
            select(func.count()).select_from(PostComment).where(PostComment.author_id == user.id)
        ),
        "followers": await count(
            select(func.count()).select_from(Follow).where(Follow.following_id == user.id)
        ),
        "communities": await count(
            select(func.count()).select_from(Community).where(Community.owner_id == user.id)
        ),
        "stars_sent": await count(
            select(func.count())
            .select_from(StarLedger)
            .where(StarLedger.user_id == user.id, StarLedger.kind == "star_send")
        ),
        "messages": await count(
            select(func.count()).select_from(Message).where(Message.sender_id == user.id)
        ),
        "night_posts": int(night or 0),
        "account_days": max(0, (utcnow() - _as_utc(user.joined_at)).days),
        "streak_days": details.streak_days if details else 0,
    }


async def available_badges(
    session: AsyncSession, user: User, *, is_premium: bool
) -> tuple[list[str], dict[str, int]]:
    """Which badges this account may wear, and the numbers that decided it."""
    metrics = await badge_metrics(session, user, is_premium=is_premium)
    granted = {slug for slug in (user.badges or []) if slug}
    earned = {
        slug
        for slug, (metric, target) in BADGE_RULES.items()
        if metrics.get(metric, 0) >= target
    }
    order = list(BADGE_CATALOG)
    unlocked = sorted(
        granted | earned, key=lambda slug: order.index(slug) if slug in order else len(order)
    )
    return unlocked, metrics


async def resolve_user(session: AsyncSession, username: str) -> User | None:
    """
    Resolve a profile by its current handle or by any collectible username it owns.

    A handle its owner gave to one of their channels is deliberately not one of them: it is the
    channel's address now, and having it open the owner's profile as well is how `@x` ends up
    meaning two different pages.
    """
    normalized = username.strip().lower().removeprefix("@")
    if not normalized:
        return None
    user = await session.scalar(select(User).where(func.lower(User.username) == normalized))
    if user is not None:
        return user
    return await session.scalar(
        select(User)
        .join(UsernameAsset, UsernameAsset.owner_id == User.id)
        .where(
            func.lower(UsernameAsset.username) == normalized,
            UsernameAsset.community_id.is_(None),
        )
    )


def message_out(
    message: Message,
    sender: User,
    current_user_id: uuid.UUID,
    *,
    quote: MessageQuote | None = None,
    reactions: list[MessageReactionOut] | None = None,
    sender_premium: bool = False,
    sender_name_gift: GiftCompact | None = None,
    gift: GiftCompact | None = None,
    peers_read_at: datetime | None = None,
    claimed_by: UserCompact | None = None,
    forwarded_from: UserCompact | None = None,
    story: StoryCompact | None = None,
) -> ChatMessage:
    mine = message.sender_id == current_user_id
    return ChatMessage(
        id=message.id,
        chat_id=message.chat_id,
        sender_id=message.sender_id,
        # The marks travel with the author, because a group thread is where they are read: who is
        # speaking is the question a group asks on every line, and a bare name does not answer it.
        sender=compact_user(sender, is_premium=sender_premium, name_gift=sender_name_gift),
        content=message.content,
        media_url=message.media_url,
        # Rows written before clips were accepted have no kind, and every one of them is a
        # picture, so the absent value is read as exactly that rather than backfilled.
        media_kind=cast(
            "Literal['image', 'video'] | None",
            message.media_kind or ("image" if message.media_url else None),
        ),
        file_url=message.file_url,
        file_name=message.file_name,
        file_size=message.file_size,
        created_at=message.created_at,
        is_mine=mine,
        # Two ticks mean everyone else has read past this message, so the flag is only ever
        # about my own messages — the reader's own state is not news to them.
        read=bool(mine and peers_read_at is not None and peers_read_at >= message.created_at),
        edited_at=message.edited_at,
        pinned=message.pinned_at is not None,
        service=message.is_service,
        reply_to=quote,
        reactions=reactions or [],
        gift=gift,
        story=story,
        gift_claimable=message.gift_claimable,
        gift_claimed_by=claimed_by,
        forwarded_from=forwarded_from,
    )


async def _peers_read_at(
    session: AsyncSession, chat_id: uuid.UUID, me_id: uuid.UUID
) -> datetime | None:
    """
    How far the *slowest* other participant has read.

    The minimum is deliberate: in a group, "read" should not light up until the message has
    reached everyone, and a single lagging member is exactly the case worth showing.
    """
    stamps = (
        await session.scalars(
            select(ChatMember.last_read_at).where(
                ChatMember.chat_id == chat_id, ChatMember.user_id != me_id
            )
        )
    ).all()
    if not stamps or any(stamp is None for stamp in stamps):
        return None
    return min(stamps)


async def _sender_marks(
    session: AsyncSession, user_id: uuid.UUID
) -> tuple[bool, GiftCompact | None]:
    """
    The premium star and the name gift for one author.

    The batched versions serve a whole thread; this is for the single-message replies and socket
    frames, where the alternative is a `sender` with the marks missing. That matters because the
    client folds a frame over the row it already has: an edit or a reaction carrying a bare author
    would take a premium star off a bubble that had one.
    """
    premium = await premium_user_ids(session, [user_id])
    emblems = await name_gift_map(session, [user_id])
    return user_id in premium, emblems.get(user_id)


def broadcast_payload(message: ChatMessage) -> dict[str, Any]:
    """
    Strip the reader out of a socket frame.

    One frame goes to every member of the chat, so it must carry nothing that depends on who
    is looking: `is_mine`, `read` and a reaction's `mine` are the viewer's own state. Sending
    the author's copy of them made an incoming message render as the recipient's own.
    Each client re-derives them from its own identity.
    """
    data = message.model_dump(mode="json")
    data["is_mine"] = False
    data["read"] = False
    for reaction in data.get("reactions") or []:
        reaction["mine"] = False
    return data


async def require_chat_member(
    session: AsyncSession, chat_id: uuid.UUID, user_id: uuid.UUID
) -> ChatMember:
    member = await session.scalar(
        select(ChatMember).where(ChatMember.chat_id == chat_id, ChatMember.user_id == user_id)
    )
    if member is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Нет доступа к чату")
    return member


async def render_post(  # noqa: PLR0913
    session: AsyncSession,
    post: Post,
    author: User,
    me: User,
    *,
    premium: set[uuid.UUID] | None = None,
    presence_hidden: set[uuid.UUID] | None = None,
    name_gifts: dict[uuid.UUID, GiftCompact] | None = None,
    community: Community | None = None,
    reposted_by: User | None = None,
    reposted_at: datetime | None = None,
) -> FeedPost:
    """The three maps let a list pass one batched lookup each instead of one query per post."""
    premium_ids = premium if premium is not None else await premium_user_ids(session, [author.id])
    hidden_ids = (
        presence_hidden
        if presence_hidden is not None
        else await presence_hidden_ids(session, [author.id])
    )
    emblems = name_gifts if name_gifts is not None else await name_gift_map(session, [author.id])
    # A channel post read one at a time — by permalink, after a like, after an edit — still has
    # to know it belongs to a channel, or its card would suddenly be the owner's own.
    if community is None and post.community_id is not None:
        community = await session.get(Community, post.community_id)
    likes = int(
        await session.scalar(
            select(func.count()).select_from(PostLike).where(PostLike.post_id == post.id)
        )
        or 0
    )
    comments = int(
        await session.scalar(
            select(func.count()).select_from(PostComment).where(PostComment.post_id == post.id)
        )
        or 0
    )
    reposts = int(
        await session.scalar(
            select(func.count()).select_from(PostRepost).where(PostRepost.post_id == post.id)
        )
        or 0
    )
    liked = bool(
        await session.scalar(
            select(func.count())
            .select_from(PostLike)
            .where(PostLike.post_id == post.id, PostLike.user_id == me.id)
        )
    )
    bookmarked = bool(
        await session.scalar(
            select(func.count())
            .select_from(PostBookmark)
            .where(PostBookmark.post_id == post.id, PostBookmark.user_id == me.id)
        )
    )
    reposted = bool(
        await session.scalar(
            select(func.count())
            .select_from(PostRepost)
            .where(PostRepost.post_id == post.id, PostRepost.user_id == me.id)
        )
    )
    unique_views = int(
        await session.scalar(
            select(func.count()).select_from(PostView).where(PostView.post_id == post.id)
        )
        or 0
    )
    viewed = bool(
        await session.scalar(
            select(func.count())
            .select_from(PostView)
            .where(PostView.post_id == post.id, PostView.user_id == me.id)
        )
    )
    muted = bool(
        await session.scalar(
            select(func.count())
            .select_from(PostMute)
            .where(PostMute.post_id == post.id, PostMute.user_id == me.id)
        )
    )
    # What the post earned, read off the ledger rather than kept as a second number that could
    # disagree with it: the credits to its author tagged with this post.
    stars = int(
        await session.scalar(
            select(func.coalesce(func.sum(StarLedger.amount), 0)).where(
                StarLedger.entity_type == "post",
                StarLedger.entity_id == str(post.id),
                StarLedger.amount > 0,
            )
        )
        or 0
    )
    starred = bool(
        await session.scalar(
            select(func.count())
            .select_from(StarLedger)
            .where(
                StarLedger.entity_type == "post",
                StarLedger.entity_id == str(post.id),
                StarLedger.user_id == me.id,
                StarLedger.amount < 0,
            )
        )
    )
    poll = None
    if post.poll_options:
        tally = dict(
            (
                await session.execute(
                    select(PostPollVote.option_index, func.count())
                    .where(PostPollVote.post_id == post.id)
                    .group_by(PostPollVote.option_index)
                )
            ).all()
        )
        mine = await session.scalar(
            select(PostPollVote.option_index).where(
                PostPollVote.post_id == post.id, PostPollVote.user_id == me.id
            )
        )
        poll = PostPollOut(
            options=[
                PollOption(index=index, text=option, votes=int(tally.get(index, 0)))
                for index, option in enumerate(post.poll_options)
            ],
            total_votes=sum(int(count) for count in tally.values()),
            my_choice=mine,
        )
    return FeedPost(
        id=post.id,
        author=compact_user(
            author,
            is_premium=author.id in premium_ids,
            hide_presence=author.id in hidden_ids,
            name_gift=emblems.get(author.id),
        ),
        content=post.content,
        image_url=post.image_url,
        media_url=post.image_url,
        image_urls=list(post.image_urls or ([post.image_url] if post.image_url else [])),
        video_url=post.video_url,
        file_url=post.file_url,
        file_name=post.file_name,
        file_size=post.file_size,
        poll=poll,
        sensitive=post.sensitive,
        link_url=post.link_url,
        link_title=post.link_title,
        created_at=post.created_at,
        like_count=likes,
        likes_count=likes,
        liked_by_me=liked,
        is_liked=liked,
        comment_count=comments,
        comments_count=comments,
        reposts_count=reposts,
        # Recorded reads, not a formula over other counters.
        views_count=max(post.views_total or 0, unique_views),
        unique_views_count=unique_views,
        viewed_by_me=viewed,
        is_bookmarked=bookmarked,
        is_reposted=reposted,
        music=PostMusic.model_validate(post.music) if post.music else None,
        edited_at=post.edited_at,
        is_pinned=post.pinned_at is not None,
        hidden_at=post.hidden_at,
        hidden_reason=post.hidden_reason,
        is_muted=muted,
        stars_count=stars,
        starred_by_me=starred,
        can_edit=post.author_id == me.id,
        can_delete=post.author_id == me.id,
        reposted_by=compact_user(reposted_by) if reposted_by else None,
        reposted_at=reposted_at,
        community_slug=community.slug if community else None,
        community_title=community.title if community else None,
        community_avatar_url=community.avatar_url if community else None,
        community_verified=bool(community and community.is_verified),
        # Only ever true on a card its own author is looking at: the queue is private, and the
        # card says when it goes out rather than showing a date that has not happened.
        publish_at=post.publish_at,
        scheduled=_is_scheduled(post),
    )


async def _handle_conflict(
    session: AsyncSession,
    handle: str,
    *,
    user_id: uuid.UUID | None = None,
    community_id: uuid.UUID | None = None,
) -> str | None:
    """
    Why a handle cannot be taken, or None when it can.

    Handles are one namespace. `@gram` used to be able to be a person's account *and* somebody
    else's channel at the same time, because accounts, channels and collectible handles lived in
    three tables and none of them asked the other two. Every place that claims a handle asks
    here instead.

    `user_id` and `community_id` are the claimant: their own rows are not a conflict with
    themselves.
    """
    wanted = handle.strip().removeprefix("@").lower()
    account = select(User.username).where(func.lower(User.username) == wanted)
    if user_id is not None:
        account = account.where(User.id != user_id)
    if await session.scalar(account):
        return f"@{wanted} — это аккаунт пользователя"
    channel = select(Community.slug).where(func.lower(Community.slug) == wanted)
    if community_id is not None:
        channel = channel.where(Community.id != community_id)
    if await session.scalar(channel):
        return f"@{wanted} — адрес сообщества"
    asset = await session.scalar(
        select(UsernameAsset).where(func.lower(UsernameAsset.username) == wanted)
    )
    if asset is None:
        return None
    if asset.community_id is not None and asset.community_id != community_id:
        return f"@{wanted} уже указывает на другое сообщество"
    if asset.owner_id is not None and asset.owner_id != user_id:
        return f"@{wanted} уже принадлежит другому владельцу"
    return None


async def _refuse_taken_handle(
    session: AsyncSession,
    handle: str,
    *,
    user_id: uuid.UUID | None = None,
    community_id: uuid.UUID | None = None,
) -> None:
    """The same check, as the 409 every caller wants to raise."""
    reason = await _handle_conflict(
        session, handle, user_id=user_id, community_id=community_id
    )
    if reason is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=reason)


async def render_username(
    session: AsyncSession, asset: UsernameAsset, owner: User | None, me: User
) -> UsernameAssetOut:
    rarity = (
        "legendary"
        if len(asset.username) <= LEGENDARY_USERNAME_LENGTH
        else "rare"
        if len(asset.username) <= RARE_USERNAME_LENGTH
        else "common"
    )
    last_event = await session.scalar(
        select(UsernameOwnershipEvent)
        .where(UsernameOwnershipEvent.asset_id == asset.id)
        .order_by(UsernameOwnershipEvent.created_at.desc())
        .limit(1)
    )
    # The market's own numbers, and they are counts of real bids rather than of history rows.
    pending = (
        await session.execute(
            select(UsernameOffer.amount_stars, UsernameOffer.bidder_id).where(
                UsernameOffer.asset_id == asset.id, UsernameOffer.status == "pending"
            )
        )
    ).all()
    mine_bid = [amount for amount, bidder in pending if bidder == me.id]
    community = (
        await session.get(Community, asset.community_id) if asset.community_id else None
    )
    return UsernameAssetOut(
        id=asset.id,
        username=asset.username,
        owner=compact_user(owner) if owner else None,
        owner_username=owner.username if owner else "",
        status=asset.status,
        rarity=rarity,
        price=float(asset.price) if asset.price is not None else None,
        currency=asset.currency,
        is_owned_by_me=asset.owner_id == me.id,
        created_at=asset.created_at,
        acquired_at=asset.reserved_at or asset.created_at,
        offers_count=len(pending),
        last_action=last_event.action if last_event else None,
        last_action_at=last_event.created_at if last_event else None,
        is_primary_handle=bool(owner and owner.username.lower() == asset.username.lower()),
        offers_disabled=asset.offers_disabled,
        community_slug=community.slug if community else None,
        community_title=community.title if community else None,
        is_community_primary=bool(
            community and community.slug.lower() == asset.username.lower()
        ),
        listed_at=asset.listed_at,
        top_offer_stars=max((amount for amount, _ in pending), default=None),
        my_offer_stars=max(mine_bid, default=None),
    )


async def render_gift(session: AsyncSession, gift: Gift, owner: User, me: User) -> GiftOut:
    collectible = await session.get(GiftCollectible, gift.id)
    showcase = await session.scalar(
        select(GiftShowcase).where(
            GiftShowcase.user_id == owner.id, GiftShowcase.gift_id == gift.id
        )
    )
    source_user = aliased(User)
    destination_user = aliased(User)
    transfer_rows = (
        await session.execute(
            select(GiftTransfer, source_user, destination_user)
            .join(source_user, GiftTransfer.from_user_id == source_user.id)
            .join(destination_user, GiftTransfer.to_user_id == destination_user.id)
            .where(GiftTransfer.gift_id == gift.id)
            .order_by(GiftTransfer.transferred_at)
        )
    ).all()
    provenance = [
        GiftProvenanceOut(
            id=None,
            event="minted",
            from_user=None,
            to_user=None,
            note="Создание коллекционного подарка",
            occurred_at=collectible.minted_at if collectible else gift.received_at,
            provenance_hash=collectible.provenance_hash if collectible else None,
        )
    ]
    provenance.extend(
        GiftProvenanceOut(
            id=transfer.id,
            event="transferred",
            from_user=compact_user(source),
            to_user=compact_user(destination),
            note=transfer.note,
            occurred_at=transfer.transferred_at,
            provenance_hash=collectible.provenance_hash if collectible else None,
        )
        for transfer, source, destination in transfer_rows
    )
    # A hidden name is hidden from the recipient, not from the person who chose to hide it:
    # opening a gift you gave has to say that you gave it.
    sender = (
        await session.get(User, gift.sender_id)
        if gift.sender_id and (not gift.sender_hidden or gift.sender_id == me.id)
        else None
    )
    design = DESIGN_BY_SLUG.get(design_slug(gift.slug))
    return GiftOut(
        id=gift.id,
        slug=gift.slug,
        name=gift.name,
        description=gift.description,
        serial_number=gift.serial_number,
        edition_size=gift.edition_size,
        supply=gift.edition_size,
        rarity=gift.rarity,
        image_url=gift.image_url,
        accent=gift.accent,
        owner=compact_user(owner),
        owner_username=owner.username,
        creator=collectible.creator_username if collectible else "gram",
        received_at=gift.received_at,
        acquired_at=gift.received_at,
        is_owned_by_me=gift.owner_id == me.id,
        model=collectible.model if collectible else None,
        backdrop=collectible.backdrop if collectible else None,
        symbol=collectible.symbol if collectible else None,
        traits=collectible.traits if collectible else {},
        value_stars=collectible.value_stars if collectible else 0,
        provenance_hash=collectible.provenance_hash if collectible else None,
        showcased_as=showcase.slot if showcase else None,
        provenance=provenance,
        art=gift.art or "orb",
        pattern=gift.pattern or "star",
        backdrop_edge=gift.backdrop_edge or "#08080a",
        model_name=gift.model_name or "",
        pattern_color=gift.pattern_color or "#ffffff",
        text_color=gift.text_color or "#ffffff",
        design_slug=design_slug(gift.slug),
        category=design.category if design else None,
        sender=compact_user(sender) if sender else None,
        sender_hidden=gift.sender_hidden,
        sent_by_me=bool(gift.sender_id and gift.sender_id == me.id),
        message=gift.message,
        upgraded_at=gift.upgraded_at,
        upgraded=gift.upgraded_at is not None,
        upgrade_price_stars=design.upgrade_price_stars if design else 25,
        sale_price_stars=gift.sale_price_stars,
        listed_at=gift.listed_at,
        is_listed=gift.sale_price_stars is not None,
        hidden_in_profile=gift.hidden_in_profile,
        is_pinned=gift.pinned_at is not None,
        offers_disabled=gift.offers_disabled,
    )


def design_slug(gift_slug: str) -> str:
    """`signal-crystal-007` -> `signal-crystal`, so an item can point back at its design."""
    head, _, tail = gift_slug.rpartition("-")
    return head if head and tail.isdigit() else gift_slug


@app.get("/health", response_model=HealthResponse, tags=["system"])
async def health(session: SessionDep) -> HealthResponse:
    await session.scalar(select(1))
    return HealthResponse(status="ok", service="gram-api", database="ok")


_LEGAL_REPORT_WINDOWS: dict[str, list[datetime]] = defaultdict(list)


def _legal_reference(report_id: uuid.UUID) -> str:
    return f"GRAM-{report_id.hex[:10].upper()}"


def _legal_report_rate_limit(request: Request, email: str) -> None:
    """Limit public submissions without retaining raw email or network identifiers in memory."""

    now = utcnow()
    subjects: list[tuple[str, str, int]] = [("email", email, 5)]
    if client_ip := _client_ip(request):
        subjects.append(("network", client_ip, 10))
    pending: list[tuple[str, list[datetime]]] = []
    for scope, subject, limit in subjects:
        key = hashlib.sha256(f"legal:{scope}:{subject}".encode()).hexdigest()
        recent = [
            moment
            for moment in _LEGAL_REPORT_WINDOWS.get(key, [])
            if (now - moment).total_seconds() < 3600
        ]
        if len(recent) >= limit:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Слишком много обращений. Подождите и повторите позже.",
            )
        pending.append((key, recent))
    for key, recent in pending:
        _LEGAL_REPORT_WINDOWS[key] = [*recent, now]
    if len(_LEGAL_REPORT_WINDOWS) > 4096:
        for stale_key in list(_LEGAL_REPORT_WINDOWS)[:1024]:
            _LEGAL_REPORT_WINDOWS.pop(stale_key, None)


@app.post(
    "/api/legal/reports",
    response_model=LegalReportReceipt,
    status_code=status.HTTP_201_CREATED,
    tags=["legal"],
)
async def submit_legal_report(
    payload: LegalReportCreate,
    request: Request,
    response: Response,
    session: SessionDep,
) -> LegalReportReceipt:
    """Receive a public rights, safety, account-access, or technical-support request."""

    response.headers["Cache-Control"] = "no-store"
    if payload.website:
        # A bot that filled the hidden field gets a normal-looking receipt but creates no case.
        return LegalReportReceipt(reference_code=_legal_reference(uuid.uuid4()))
    _legal_report_rate_limit(request, payload.reporter_email)
    report = LegalReport(
        kind=payload.kind,
        reporter_role=payload.reporter_role,
        reporter_name=payload.reporter_name,
        reporter_email=payload.reporter_email,
        country=payload.country,
        account_username=payload.account_username,
        content_urls=payload.content_urls,
        original_work=payload.original_work,
        details=payload.details.strip(),
        requested_action=payload.requested_action,
        electronic_signature=payload.electronic_signature,
    )
    session.add(report)
    await session.commit()
    await session.refresh(report)
    return LegalReportReceipt(reference_code=_legal_reference(report.id))


_DUMMY_PASSWORD_HASH = hash_password(secrets.token_urlsafe(32))
_AUTH_SEND_WINDOWS: dict[str, list[datetime]] = defaultdict(list)


def _auth_rate_limit(request: Request, action: str, *, limit: int, seconds: int = 900) -> None:
    """Bound email-producing auth attempts without retaining raw network identifiers."""
    now = utcnow()
    key = hashlib.sha256(f"{action}:{_client_ip(request) or 'unknown'}".encode()).hexdigest()
    recent = [moment for moment in _AUTH_SEND_WINDOWS[key] if (now - moment).total_seconds() < seconds]
    if len(recent) >= limit:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Слишком много попыток. Подождите немного и повторите.",
        )
    recent.append(now)
    _AUTH_SEND_WINDOWS[key] = recent


def _challenge_out(
    challenge: PendingRegistration | EmailLoginChallenge,
    *,
    email: str,
    purpose: Literal["register", "login"],
    delivery: Literal["sent", "failed"],
) -> EmailChallengeOut:
    return EmailChallengeOut(
        challenge_id=challenge.id,
        purpose=purpose,
        masked_email=mask_email(email),
        expires_in=max(0, int((_as_utc(challenge.expires_at) - utcnow()).total_seconds())),
        resend_after=EMAIL_OTP_RESEND_SECONDS,
        delivery=delivery,
    )


async def _deliver_email_code(email: str, code: str, purpose: Literal["register", "login"]) -> Literal["sent", "failed"]:
    try:
        await run_in_threadpool(send_auth_code, email, code, purpose=purpose)
    except Exception as error:  # SMTP details and the recipient never belong in logs.
        logging.getLogger("gram.auth").warning(
            "email delivery failed purpose=%s error_class=%s", purpose, type(error).__name__
        )
        return "failed"
    return "sent"


async def _registration_username(
    session: AsyncSession, email: str, requested: str | None
) -> str:
    if requested:
        live = await session.scalar(select(User.id).where(func.lower(User.username) == requested))
        pending = await session.scalar(
            select(PendingRegistration.id).where(
                func.lower(PendingRegistration.username) == requested,
                PendingRegistration.expires_at > utcnow(),
            )
        )
        if live or pending:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Юзернейм уже занят")
        return requested
    base = re.sub(r"[^a-zA-Z0-9_]", "", email.split("@", 1)[0])[:24].lower()
    if len(base) < MIN_USERNAME_LENGTH or not base[:1].isalpha():
        base = f"user_{base}"[:24]
    username = base
    suffix = 1
    while True:
        live = await session.scalar(select(User.id).where(func.lower(User.username) == username))
        pending = await session.scalar(
            select(PendingRegistration.id).where(
                func.lower(PendingRegistration.username) == username,
                PendingRegistration.expires_at > utcnow(),
            )
        )
        if not live and not pending:
            return username
        suffix += 1
        username = f"{base[: 31 - len(str(suffix))]}{suffix}"


async def _create_registered_user(session: AsyncSession, pending: PendingRegistration) -> User:
    """Atomically turn a verified pending row into the same durable account registration used before."""
    if await session.scalar(
        select(AuthIdentity.user_id).where(func.lower(AuthIdentity.email) == pending.email)
    ):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email уже используется")
    if await session.scalar(select(User.id).where(func.lower(User.username) == pending.username)):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Юзернейм уже занят")
    user = User(
        username=pending.username,
        display_name=pending.display_name,
        bio="",
        related_usernames=[],
        badges=[],
        is_online=True,
    )
    session.add(user)
    await session.flush()
    session.add(
        AuthIdentity(
            user_id=user.id,
            email=pending.email,
            password_hash=pending.password_hash,
            email_verified=True,
        )
    )
    session.add(
        UserPreferences(
            user_id=user.id,
            interests=[],
            onboarding_complete=pending.onboarding_complete,
        )
    )
    session.add(UserProfileDetails(user_id=user.id, last_seen_at=utcnow()))
    session.add(StarWallet(user_id=user.id, balance=100))
    session.add(
        StarLedger(
            user_id=user.id,
            amount=100,
            balance_after=100,
            kind="welcome",
            description="Стартовый баланс аккаунта",
            correlation_id=uuid.uuid4(),
        )
    )
    session.add(
        CreatorSettings(user_id=user.id, paid_subscription_enabled=False, monthly_price=50)
    )
    asset = await session.scalar(
        select(UsernameAsset).where(func.lower(UsernameAsset.username) == pending.username)
    )
    if asset is None:
        asset = UsernameAsset(
            username=pending.username,
            owner_id=user.id,
            status=UsernameStatus.RESERVED,
            currency="STARS",
            reserved_at=utcnow(),
        )
        session.add(asset)
    elif asset.owner_id is None:
        asset.owner_id = user.id
        asset.status = UsernameStatus.RESERVED
        asset.reserved_at = utcnow()
        asset.listed_at = None
        asset.price = None
    else:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Юзернейм уже занят")
    await session.flush()
    session.add(UsernameOwnershipEvent(asset_id=asset.id, to_user_id=user.id, action="registered"))
    await _official_dm(
        session,
        user,
        f"Добро пожаловать в GRAM, {pending.display_name}!\n\n"
        f"Ваш юзернейм — @{pending.username}, он закреплён за аккаунтом. На балансе 100 ★ "
        "на первые подарки и подписки.\n\n"
        "Что стоит сделать сейчас:\n"
        "• заполнить профиль — аватар, описание, оформление;\n"
        "• найти интересных авторов в разделе «Поиск»;\n"
        "• опубликовать первую запись.\n\n"
        "Мы пишем сюда только по делу: безопасность аккаунта и важные изменения.",
    )
    return user


async def _create_full_session(
    session: AsyncSession,
    user: User,
    request: Request,
    response: Response,
    *,
    notify_login: bool,
) -> tuple[str, str, datetime]:
    await _park_active_session(session, request, response, keep_user_id=user.id)
    await _drop_parked_slot(session, request, response, user_id=user.id)
    await _touch_presence(session, user, online=True, force=True)
    if notify_login:
        await _notify_new_device(session, user, request)
    _, raw_refresh, access, access_expires = await _new_session(session, user, request)
    return raw_refresh, access, access_expires


async def _start_registration_challenge(
    payload: RegisterRequest, request: Request, session: AsyncSession
) -> EmailChallengeOut:
    _auth_rate_limit(request, "register", limit=10)
    if await session.scalar(
        select(AuthIdentity.user_id).where(func.lower(AuthIdentity.email) == payload.email)
    ):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email уже используется")
    now = utcnow()
    await session.execute(
        delete(PendingRegistration).where(
            PendingRegistration.expires_at < now - timedelta(days=1)
        )
    )
    existing = await session.scalar(
        select(PendingRegistration).where(func.lower(PendingRegistration.email) == payload.email)
    )
    if existing is not None and _as_utc(existing.expires_at) > now:
        return _challenge_out(
            existing, email=existing.email, purpose="register", delivery="sent"
        )
    if existing is not None:
        await session.delete(existing)
        await session.flush()
    username = await _registration_username(session, payload.email, payload.username)
    display_name = payload.display_name or payload.email.split("@", 1)[0].replace(".", " ").title()
    challenge_id = uuid.uuid4()
    code = new_email_code()
    challenge = PendingRegistration(
        id=challenge_id,
        email=payload.email,
        username=username,
        display_name=display_name,
        onboarding_complete=payload.username is not None and payload.display_name is not None,
        password_hash=await run_in_threadpool(hash_password, payload.password),
        code_hash=email_code_hash(challenge_id, code),
        expires_at=now + timedelta(minutes=EMAIL_OTP_TTL_MINUTES),
        attempts=0,
        sent_count=1,
        last_sent_at=now,
    )
    session.add(challenge)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email или юзернейм уже ожидает подтверждения",
        ) from exc
    delivery = await _deliver_email_code(payload.email, code, "register")
    return _challenge_out(challenge, email=payload.email, purpose="register", delivery=delivery)


async def _start_login_challenge(
    identity: AuthIdentity, user: User, request: Request, session: AsyncSession
) -> EmailChallengeOut:
    _auth_rate_limit(request, "login", limit=20)
    now = utcnow()
    await session.execute(
        delete(EmailLoginChallenge).where(
            EmailLoginChallenge.created_at < now - timedelta(days=1)
        )
    )
    await session.execute(
        update(EmailLoginChallenge)
        .where(
            EmailLoginChallenge.user_id == user.id,
            EmailLoginChallenge.consumed_at.is_(None),
        )
        .values(consumed_at=now)
    )
    challenge_id = uuid.uuid4()
    code = new_email_code()
    challenge = EmailLoginChallenge(
        id=challenge_id,
        user_id=user.id,
        code_hash=email_code_hash(challenge_id, code),
        expires_at=now + timedelta(minutes=EMAIL_OTP_TTL_MINUTES),
        attempts=0,
        sent_count=1,
        last_sent_at=now,
    )
    session.add(challenge)
    await session.commit()
    delivery = await _deliver_email_code(identity.email, code, "login")
    return _challenge_out(challenge, email=identity.email, purpose="login", delivery=delivery)


@app.post(
    "/api/auth/register",
    response_model=AuthResponse | EmailChallengeOut,
    status_code=status.HTTP_201_CREATED,
    tags=["auth"],
)
async def register(
    payload: RegisterRequest, request: Request, response: Response, session: SessionDep
) -> AuthResponse | EmailChallengeOut:
    if EMAIL_AUTH_ENABLED and not EMAIL_OTP_BYPASS:
        return await _start_registration_challenge(payload, request, session)
    if await session.scalar(
        select(AuthIdentity).where(func.lower(AuthIdentity.email) == payload.email)
    ):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email уже используется")
    username = payload.username
    if username is None:
        base = re.sub(r"[^a-zA-Z0-9_]", "", payload.email.split("@", 1)[0])[:24].lower()
        if len(base) < MIN_USERNAME_LENGTH or not base[:1].isalpha():
            base = f"user_{base}"[:24]
        username = base
        suffix = 1
        while await session.scalar(select(User.id).where(func.lower(User.username) == username)):
            suffix += 1
            username = f"{base[: 31 - len(str(suffix))]}{suffix}"
    elif await session.scalar(select(User.id).where(func.lower(User.username) == username)):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Юзернейм уже занят")
    display_name = payload.display_name or payload.email.split("@", 1)[0].replace(".", " ").title()
    user = User(
        username=username,
        display_name=display_name,
        bio="",
        related_usernames=[],
        badges=[],
        is_online=True,
    )
    session.add(user)
    await session.flush()
    session.add(
        AuthIdentity(
            user_id=user.id,
            email=payload.email,
            password_hash=await run_in_threadpool(hash_password, payload.password),
        )
    )
    completed = payload.username is not None and payload.display_name is not None
    session.add(UserPreferences(user_id=user.id, interests=[], onboarding_complete=completed))
    session.add(UserProfileDetails(user_id=user.id, last_seen_at=utcnow()))
    wallet = StarWallet(user_id=user.id, balance=100)
    session.add(wallet)
    correlation = uuid.uuid4()
    session.add(
        StarLedger(
            user_id=user.id,
            amount=100,
            balance_after=100,
            kind="welcome",
            description="Стартовый баланс аккаунта",
            correlation_id=correlation,
        )
    )
    settings = CreatorSettings(user_id=user.id, paid_subscription_enabled=False, monthly_price=50)
    session.add(settings)
    # A handle can already have an asset row — freed by a deleted account, or reserved in the
    # marketplace. Inserting blindly violated the unique index and answered a registration
    # with a 500, so an existing row is adopted instead.
    asset = await session.scalar(
        select(UsernameAsset).where(func.lower(UsernameAsset.username) == username)
    )
    if asset is None:
        asset = UsernameAsset(
            username=username,
            owner_id=user.id,
            status=UsernameStatus.RESERVED,
            currency="STARS",
            reserved_at=utcnow(),
        )
        session.add(asset)
    elif asset.owner_id is None:
        asset.owner_id = user.id
        asset.status = UsernameStatus.RESERVED
        asset.reserved_at = utcnow()
        asset.listed_at = None
        asset.price = None
    else:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Юзернейм уже занят")
    await session.flush()
    session.add(UsernameOwnershipEvent(asset_id=asset.id, to_user_id=user.id, action="registered"))
    await _official_dm(
        session,
        user,
        f"Добро пожаловать в GRAM, {display_name}!\n\n"
        f"Ваш юзернейм — @{username}, он закреплён за аккаунтом. На балансе 100 ★ "
        "на первые подарки и подписки.\n\n"
        "Что стоит сделать сейчас:\n"
        "• заполнить профиль — аватар, описание, оформление;\n"
        "• найти интересных авторов в разделе «Поиск»;\n"
        "• опубликовать первую запись.\n\n"
        "Мы пишем сюда только по делу: безопасность аккаунта и важные изменения.",
    )
    _, raw_refresh, access, access_expires = await _new_session(session, user, request)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Email или юзернейм уже используется"
        ) from exc
    _set_auth_cookies(response, access, raw_refresh)
    return AuthResponse(
        user=await render_profile(session, user, user), access_expires_at=access_expires
    )


@app.post("/api/auth/login", response_model=AuthResponse | EmailChallengeOut, tags=["auth"])
async def login(
    payload: LoginRequest, request: Request, response: Response, session: SessionDep
) -> AuthResponse | EmailChallengeOut:
    identifier = payload.identifier.strip().lower().removeprefix("@")
    row = (
        await session.execute(
            select(AuthIdentity, User)
            .join(User, AuthIdentity.user_id == User.id)
            .where(
                or_(
                    func.lower(AuthIdentity.email) == identifier,
                    func.lower(User.username) == identifier,
                )
            )
        )
    ).first()
    password_hash = row.AuthIdentity.password_hash if row is not None else _DUMMY_PASSWORD_HASH
    password_matches = await run_in_threadpool(verify_password, payload.password, password_hash)
    if row is None or not password_matches:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Неверный логин или пароль"
        )
    identity, user = row
    if EMAIL_AUTH_ENABLED and not EMAIL_OTP_BYPASS:
        response.status_code = status.HTTP_202_ACCEPTED
        return await _start_login_challenge(identity, user, request, session)
    del identity
    # Whoever is signed in right now keeps their session in a parked slot, so this login adds
    # an account to the browser instead of replacing the one already there.
    await _park_active_session(session, request, response, keep_user_id=user.id)
    await _drop_parked_slot(session, request, response, user_id=user.id)
    await _touch_presence(session, user, online=True, force=True)
    # Checked before the new session row lands, or the device would already look familiar.
    await _notify_new_device(session, user, request)
    _, raw_refresh, access, access_expires = await _new_session(session, user, request)
    await session.commit()
    _set_auth_cookies(response, access, raw_refresh)
    return AuthResponse(
        user=await render_profile(session, user, user), access_expires_at=access_expires
    )


@app.post("/api/auth/email/verify", response_model=AuthResponse, tags=["auth"])
async def verify_email_code(
    payload: EmailCodeVerifyRequest,
    request: Request,
    response: Response,
    session: SessionDep,
) -> AuthResponse:
    if not EMAIL_AUTH_ENABLED or EMAIL_OTP_BYPASS:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Проверка почты выключена")
    _auth_rate_limit(request, "verify", limit=30)
    now = utcnow()
    pending = await session.scalar(
        select(PendingRegistration)
        .where(PendingRegistration.id == payload.challenge_id)
        .with_for_update()
    )
    if pending is not None:
        if pending.attempts >= EMAIL_OTP_MAX_ATTEMPTS:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Лимит попыток исчерпан — запросите новый код",
            )
        if _as_utc(pending.expires_at) <= now:
            raise HTTPException(status_code=status.HTTP_410_GONE, detail="Код истёк — запросите новый")
        if not email_code_matches(pending.id, payload.code, pending.code_hash):
            pending.attempts += 1
            await session.commit()
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Неверный код")
        user = await _create_registered_user(session, pending)
        await session.delete(pending)
        raw_refresh, access, access_expires = await _create_full_session(
            session, user, request, response, notify_login=False
        )
        try:
            await session.commit()
        except IntegrityError as exc:
            await session.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Email или юзернейм уже используется",
            ) from exc
        _set_auth_cookies(response, access, raw_refresh)
        return AuthResponse(
            user=await render_profile(session, user, user), access_expires_at=access_expires
        )

    challenge = await session.scalar(
        select(EmailLoginChallenge)
        .where(EmailLoginChallenge.id == payload.challenge_id)
        .with_for_update()
    )
    if challenge is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Проверка не найдена")
    if challenge.consumed_at is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Код уже использован")
    if challenge.attempts >= EMAIL_OTP_MAX_ATTEMPTS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Лимит попыток исчерпан — начните вход заново",
        )
    if _as_utc(challenge.expires_at) <= now:
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Код истёк — начните вход заново")
    if not email_code_matches(challenge.id, payload.code, challenge.code_hash):
        challenge.attempts += 1
        await session.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Неверный код")
    identity = await session.get(AuthIdentity, challenge.user_id)
    user = await session.get(User, challenge.user_id)
    if identity is None or user is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Вход недоступен")
    challenge.consumed_at = now
    identity.email_verified = True
    raw_refresh, access, access_expires = await _create_full_session(
        session, user, request, response, notify_login=True
    )
    await session.commit()
    _set_auth_cookies(response, access, raw_refresh)
    return AuthResponse(
        user=await render_profile(session, user, user), access_expires_at=access_expires
    )


@app.post("/api/auth/email/resend", response_model=EmailChallengeOut, tags=["auth"])
async def resend_email_code(
    payload: EmailChallengeResendRequest,
    request: Request,
    session: SessionDep,
) -> EmailChallengeOut:
    if not EMAIL_AUTH_ENABLED or EMAIL_OTP_BYPASS:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Проверка почты выключена")
    _auth_rate_limit(request, "resend", limit=10)
    now = utcnow()
    pending = await session.scalar(
        select(PendingRegistration)
        .where(PendingRegistration.id == payload.challenge_id)
        .with_for_update()
    )
    purpose: Literal["register", "login"]
    challenge: PendingRegistration | EmailLoginChallenge
    email: str
    if pending is not None:
        challenge = pending
        email = pending.email
        purpose = "register"
    else:
        login_challenge = await session.scalar(
            select(EmailLoginChallenge)
            .where(EmailLoginChallenge.id == payload.challenge_id)
            .with_for_update()
        )
        if login_challenge is None or login_challenge.consumed_at is not None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Проверка не найдена")
        identity = await session.get(AuthIdentity, login_challenge.user_id)
        if identity is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Проверка не найдена")
        challenge = login_challenge
        email = identity.email
        purpose = "login"
    if challenge.sent_count >= EMAIL_OTP_MAX_SENDS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Лимит отправок исчерпан — начните заново позже",
        )
    elapsed = (now - _as_utc(challenge.last_sent_at)).total_seconds()
    if elapsed < EMAIL_OTP_RESEND_SECONDS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Новый код можно запросить через {max(1, int(EMAIL_OTP_RESEND_SECONDS - elapsed))} сек.",
        )
    code = new_email_code()
    challenge.code_hash = email_code_hash(challenge.id, code)
    challenge.expires_at = now + timedelta(minutes=EMAIL_OTP_TTL_MINUTES)
    challenge.attempts = 0
    challenge.sent_count += 1
    challenge.last_sent_at = now
    await session.commit()
    delivery = await _deliver_email_code(email, code, purpose)
    return _challenge_out(challenge, email=email, purpose=purpose, delivery=delivery)


@app.post("/api/auth/refresh", response_model=AuthResponse, tags=["auth"])
async def refresh_auth(
    request: Request,
    response: Response,
    session: SessionDep,
    refresh_cookie: Annotated[str | None, Cookie(alias=REFRESH_COOKIE)] = None,
) -> AuthResponse:
    """
    Trade a refresh cookie for a fresh pair, rotating the credential.

    Two things here are about *not* signing people out by accident, which is what the previous
    version did several times a day:

    1. A rotated token presented again within `REFRESH_GRACE_SECONDS` is a race, not a theft. Two
       requests whose access cookie expired in the same second both refresh; the browser has one
       cookie jar, so the second one arrives holding the token the first has already spent. That is
       ordinary and unavoidable — the answer is to hand back the replacement's own credentials
       rather than to treat it as an attack.
    2. When a reuse *is* outside the grace window, only the chain that token belongs to is revoked.
       Revoking every session of the account meant one stale tab on a laptop signed the same person
       out of their phone as well, which is exactly the reported symptom.
    """
    if not refresh_cookie:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh-сессия отсутствует"
        )
    current = await session.scalar(
        select(RefreshSession)
        .where(RefreshSession.token_hash == refresh_token_hash(refresh_cookie))
        .with_for_update()
    )
    if current is None:
        _clear_auth_cookies(response)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh-сессия недействительна"
        )
    if current.revoked_at is not None:
        replacement = (
            await session.get(RefreshSession, current.replaced_by_id)
            if current.replaced_by_id
            else None
        )
        within_grace = (
            utcnow() - _as_utc(current.revoked_at)
        ).total_seconds() <= REFRESH_GRACE_SECONDS
        # A live replacement, moments old: the caller simply lost a race with itself.
        if (
            replacement is not None
            and replacement.revoked_at is None
            and _as_utc(replacement.expires_at) > utcnow()
            and within_grace
        ):
            user = await session.get(User, replacement.user_id)
            if user is None:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED, detail="Аккаунт не найден"
                )
            # Nothing is rotated and the refresh cookie is left alone: the winner of the race has
            # already put its own token in the jar, and the raw value of a stored credential cannot
            # be reconstructed from its hash anyway. Only the short-lived access cookie is re-issued,
            # bound to the replacement's session, which makes the losing retry idempotent.
            access, access_expires = create_access_token(user.id, replacement.id)
            _set_access_cookie(response, access)
            return AuthResponse(
                user=await render_profile(session, user, user), access_expires_at=access_expires
            )
        # A genuine reuse. Revoke this credential's own chain and nothing else, so other devices
        # stay signed in.
        await _revoke_session_chain(session, current)
        await session.commit()
        _clear_auth_cookies(response)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Обнаружено повторное использование сессии",
        )
    if _as_utc(current.expires_at) <= utcnow():
        current.revoked_at = utcnow()
        await session.commit()
        _clear_auth_cookies(response)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh-сессия истекла"
        )
    user = await session.get(User, current.user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Аккаунт не найден")
    await _touch_presence(session, user, online=True, force=True)
    replacement, raw_refresh, access, access_expires = await _new_session(session, user, request)
    current.revoked_at = utcnow()
    current.replaced_by_id = replacement.id
    await session.commit()
    _set_auth_cookies(response, access, raw_refresh)
    return AuthResponse(
        user=await render_profile(session, user, user), access_expires_at=access_expires
    )


@app.post("/api/auth/logout", response_model=DetailResponse, tags=["auth"])
async def logout(
    request: Request,
    response: Response,
    session: SessionDep,
    refresh_cookie: Annotated[str | None, Cookie(alias=REFRESH_COOKIE)] = None,
) -> DetailResponse:
    session_ids: set[uuid.UUID] = set()
    user_ids: set[uuid.UUID] = set()
    access = request.cookies.get(ACCESS_COOKIE)
    if access:
        with suppress(jwt.PyJWTError, KeyError, TypeError, ValueError):
            access_payload = decode_access_token(access)
            session_ids.add(uuid.UUID(str(access_payload["sid"])))
            user_ids.add(uuid.UUID(str(access_payload["sub"])))
    if refresh_cookie:
        refresh_row = await session.scalar(
            select(RefreshSession).where(
                RefreshSession.token_hash == refresh_token_hash(refresh_cookie)
            )
        )
        if refresh_row:
            session_ids.add(refresh_row.id)
            user_ids.add(refresh_row.user_id)
    if session_ids:
        await session.execute(
            update(RefreshSession)
            .where(RefreshSession.id.in_(session_ids), RefreshSession.revoked_at.is_(None))
            .values(revoked_at=utcnow())
        )
        await session.flush()
        for user_id in user_ids:
            has_active_session = bool(
                await session.scalar(
                    select(func.count())
                    .select_from(RefreshSession)
                    .where(
                        RefreshSession.user_id == user_id,
                        RefreshSession.revoked_at.is_(None),
                        RefreshSession.expires_at > utcnow(),
                    )
                )
            )
            user = await session.get(User, user_id)
            if user is not None:
                await _touch_presence(
                    session, user, online=has_active_session, force=not has_active_session
                )
        await session.commit()
    _clear_auth_cookies(response)
    return DetailResponse(detail="signed_out")


@app.get("/api/auth/accounts", response_model=list[AccountSlot], tags=["auth"])
async def read_account_slots(
    request: Request, response: Response, session: SessionDep
) -> list[AccountSlot]:
    """
    Accounts this browser can switch into. Deliberately unauthenticated: the login screen
    needs the list before anyone is signed in, and each slot is proven by its own cookie.
    """
    slots: list[AccountSlot] = []
    seen: set[uuid.UUID] = set()

    async def add(token: str, *, active: bool, slot: str | None) -> None:
        row = await _live_session(session, token)
        if row is None:
            # A dead slot would offer a switch that cannot happen, so its cookie goes too.
            if slot:
                _clear_parked_cookie(response, slot)
            return
        if row.user_id in seen:
            if slot:
                _clear_parked_cookie(response, slot)
            return
        user = await session.get(User, row.user_id)
        if user is None:
            if slot:
                _clear_parked_cookie(response, slot)
            return
        seen.add(user.id)
        premium = await premium_user_ids(session, [user.id])
        slots.append(
            AccountSlot(
                user=compact_user(user, is_premium=user.id in premium),
                active=active,
                expires_at=_as_utc(row.expires_at),
            )
        )

    active_token = request.cookies.get(REFRESH_COOKIE)
    if active_token:
        await add(active_token, active=True, slot=None)
    for slot, token in sorted(_parked_tokens(request).items()):
        await add(token, active=False, slot=slot)
    return slots


@app.post("/api/auth/accounts/{user_id}/activate", response_model=AuthResponse, tags=["auth"])
async def activate_account_slot(
    user_id: uuid.UUID, request: Request, response: Response, session: SessionDep
) -> AuthResponse:
    """
    Make a parked account the active one, without asking for its password again.

    Its refresh token is rotated on the way in, exactly as `/auth/refresh` does, so a slot
    cannot be replayed after it has been used.
    """
    parked = _parked_tokens(request)
    target: tuple[str, RefreshSession] | None = None
    for slot, token in sorted(parked.items()):
        row = await _live_session(session, token)
        if row is not None and row.user_id == user_id:
            target = (slot, row)
            break
    if target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Этот аккаунт не подключён к устройству"
        )
    slot, row = target
    user = await session.get(User, row.user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Аккаунт не найден")

    # The account leaving the foreground keeps its session in the slot the arriving one frees.
    outgoing = request.cookies.get(REFRESH_COOKIE)
    outgoing_row = await _live_session(session, outgoing) if outgoing else None

    await _touch_presence(session, user, online=True, force=True)
    replacement, raw_refresh, access, access_expires = await _new_session(session, user, request)
    row.revoked_at = utcnow()
    row.replaced_by_id = replacement.id
    await session.commit()

    if outgoing_row is not None and outgoing_row.user_id != user.id and outgoing:
        _set_parked_cookie(response, slot, outgoing)
    else:
        _clear_parked_cookie(response, slot)
    _set_auth_cookies(response, access, raw_refresh)
    return AuthResponse(
        user=await render_profile(session, user, user), access_expires_at=access_expires
    )


@app.delete("/api/auth/accounts/{user_id}", response_model=DetailResponse, tags=["auth"])
async def remove_account_slot(
    user_id: uuid.UUID, request: Request, response: Response, session: SessionDep
) -> DetailResponse:
    """Sign one account out of this browser, leaving the others alone."""
    removed = False
    for slot, token in sorted(_parked_tokens(request).items()):
        row = await _live_session(session, token)
        if row is None or row.user_id != user_id:
            continue
        row.revoked_at = utcnow()
        _clear_parked_cookie(response, slot)
        removed = True
    active = request.cookies.get(REFRESH_COOKIE)
    if active:
        row = await _live_session(session, active)
        if row is not None and row.user_id == user_id:
            row.revoked_at = utcnow()
            _clear_auth_cookies(response)
            removed = True
    if not removed:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Аккаунт не найден")
    user = await session.get(User, user_id)
    if user is not None:
        remaining = bool(
            await session.scalar(
                select(func.count())
                .select_from(RefreshSession)
                .where(
                    RefreshSession.user_id == user_id,
                    RefreshSession.revoked_at.is_(None),
                    RefreshSession.expires_at > utcnow(),
                )
            )
        )
        await _touch_presence(session, user, online=remaining, force=not remaining)
    await session.commit()
    return DetailResponse(detail="account_removed")


@app.get("/api/auth/sessions", response_model=list[AuthSessionOut], tags=["auth"])
async def read_auth_sessions(
    request: Request,
    session: SessionDep,
    me: CurrentUser,
) -> list[AuthSessionOut]:
    """Active refresh sessions, so the security tab can show and revoke them."""
    current_id: uuid.UUID | None = None
    access = request.cookies.get(ACCESS_COOKIE)
    if access:
        with suppress(jwt.PyJWTError, KeyError, TypeError, ValueError):
            current_id = uuid.UUID(str(decode_access_token(access)["sid"]))
    rows = (
        await session.scalars(
            select(RefreshSession)
            .where(
                RefreshSession.user_id == me.id,
                RefreshSession.revoked_at.is_(None),
                RefreshSession.expires_at > utcnow(),
            )
            .order_by(RefreshSession.created_at.desc())
        )
    ).all()
    return [
        AuthSessionOut(
            id=row.id,
            created_at=row.created_at,
            expires_at=row.expires_at,
            user_agent=row.user_agent,
            ip_address=row.ip_address,
            current=row.id == current_id,
        )
        for row in rows
    ]


@app.delete("/api/auth/sessions", response_model=DetailResponse, tags=["auth"])
async def revoke_other_sessions(
    request: Request, session: SessionDep, me: CurrentUser
) -> DetailResponse:
    current_id: uuid.UUID | None = None
    access = request.cookies.get(ACCESS_COOKIE)
    if access:
        with suppress(jwt.PyJWTError, KeyError, TypeError, ValueError):
            current_id = uuid.UUID(str(decode_access_token(access)["sid"]))
    query = update(RefreshSession).where(
        RefreshSession.user_id == me.id, RefreshSession.revoked_at.is_(None)
    )
    if current_id is not None:
        query = query.where(RefreshSession.id != current_id)
    await session.execute(query.values(revoked_at=utcnow()))
    await session.commit()
    return DetailResponse(detail="sessions_revoked")


@app.post("/api/auth/password", response_model=DetailResponse, tags=["auth"])
async def change_password(
    payload: PasswordChange, request: Request, session: SessionDep, me: CurrentUser
) -> DetailResponse:
    identity = await session.get(AuthIdentity, me.id)
    if identity is None or not verify_password(payload.current_password, identity.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Текущий пароль неверный"
        )
    if payload.current_password == payload.new_password:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Новый пароль должен отличаться от текущего",
        )
    identity.password_hash = hash_password(payload.new_password)
    current_id: uuid.UUID | None = None
    access = request.cookies.get(ACCESS_COOKIE)
    if access:
        with suppress(jwt.PyJWTError, KeyError, TypeError, ValueError):
            current_id = uuid.UUID(str(decode_access_token(access)["sid"]))
    # A password change invalidates every other device.
    revoke = update(RefreshSession).where(
        RefreshSession.user_id == me.id, RefreshSession.revoked_at.is_(None)
    )
    if current_id is not None:
        revoke = revoke.where(RefreshSession.id != current_id)
    await session.execute(revoke.values(revoked_at=utcnow()))
    await session.commit()
    return DetailResponse(detail="password_changed")


async def touch_daily_streak(session: AsyncSession, me: User) -> None:
    """
    The streak counts calendar days with at least one visit: same day is a no-op, the very
    next day extends it, and any longer gap restarts it at one. Premium protects one missed
    calendar day: returning after a two-day gap extends the series once instead of erasing it.
    A row that predates the streak timestamp falls back to `last_seen_at`, and an unknown last
    visit keeps the existing count rather than punishing the user for missing history.
    """
    details = await session.get(UserProfileDetails, me.id)
    if details is None:
        details = UserProfileDetails(user_id=me.id)
        session.add(details)
    now = utcnow()
    today = now.date()
    marker = details.streak_updated_at or details.last_seen_at
    last = marker.date() if marker else None
    if last == today:
        return
    if last is None:
        details.streak_days = max(1, details.streak_days or 0)
    elif (today - last).days == 1:
        details.streak_days = (details.streak_days or 0) + 1
    elif (today - last).days == 2 and await has_premium(session, me.id):
        details.streak_days = (details.streak_days or 0) + 1
    else:
        details.streak_days = 1
    details.streak_updated_at = now
    details.last_seen_at = now
    await session.commit()


class WireSessionCheckRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_id: uuid.UUID
    session_id: uuid.UUID


@app.post("/api/internal/wire/session-check", include_in_schema=False)
async def check_wire_session(
    payload: WireSessionCheckRequest,
    session: SessionDep,
    internal_secret: Annotated[
        str | None, Header(alias="X-Gram-Wire-Internal")
    ] = None,
) -> dict[str, bool]:
    """Confirm that a ticket-bound backing session is still active."""
    if (
        len(WIRE_INTERNAL_SECRET) < 32
        or internal_secret is None
        or not secrets.compare_digest(internal_secret, WIRE_INTERNAL_SECRET)
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Не найдено")
    refresh = await session.get(RefreshSession, payload.session_id)
    user = await session.get(User, payload.user_id)
    active = bool(
        refresh is not None
        and refresh.user_id == payload.user_id
        and refresh.revoked_at is None
        and _as_utc(refresh.expires_at) > utcnow()
        and user is not None
        and user.banned_at is None
    )
    return {"active": active}


@app.post("/api/auth/wire-ticket", tags=["auth"])
async def issue_wire_ticket(request: Request, me: CurrentUser) -> dict[str, Any]:
    """Mint a one-minute, audience-bound ticket for the first encrypted GRAM Wire frame."""
    if not WIRE_OUTBOX_ENABLED or len(WIRE_INTERNAL_SECRET) < 32:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="GRAM Wire временно недоступен",
        )
    authorization = request.headers.get("authorization", "")
    token = authorization[7:].strip() if authorization.lower().startswith("bearer ") else None
    token = token or request.cookies.get(ACCESS_COOKIE)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Требуется авторизация"
        )
    # The browser binds the ticket to its live encrypted session by sending the base64url
    # SHA-256 of the handshake channel binding. It is optional so a client that has not been
    # rebuilt yet still authenticates, and malformed values are rejected as a bad request
    # rather than silently minting an unbound ticket.
    channel_binding = request.headers.get("X-Gram-Wire-Channel-Binding")
    try:
        session_id = uuid.UUID(str(decode_access_token(token)["sid"]))
        ticket, expires_at = create_wire_ticket(
            me.id, session_id, channel_binding=channel_binding or None
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Некорректная привязка канала GRAM Wire",
        ) from exc
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="GRAM Wire временно недоступен",
        ) from exc
    return {"ticket": ticket, "expires_at": expires_at}


@app.get("/api/auth/me", response_model=UserProfile, tags=["auth"])
@app.get("/api/users/me", response_model=UserProfile, tags=["profiles"])
async def read_current_profile(session: SessionDep, me: CurrentUser) -> UserProfile:
    await touch_daily_streak(session, me)
    return await render_profile(session, me, me)


@app.delete("/api/users/me", response_model=DetailResponse, tags=["profiles"])
async def delete_account(
    payload: AccountDeleteRequest,
    response: Response,
    session: SessionDep,
    me: CurrentUser,
) -> DetailResponse:
    """Irreversible account removal, guarded by the account password."""
    identity = await session.get(AuthIdentity, me.id)
    if identity is None or not verify_password(payload.password, identity.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Пароль неверный")
    owned_communities = (
        await session.scalars(select(Community.title).where(Community.owner_id == me.id))
    ).all()
    if owned_communities:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Сначала передайте или удалите свои каналы: "
                + ", ".join(owned_communities)
            ),
        )
    # Transfer history references users with RESTRICT, so it goes before the account row.
    await session.execute(
        delete(GiftTransfer).where(
            or_(GiftTransfer.from_user_id == me.id, GiftTransfer.to_user_id == me.id)
        )
    )
    # Release the handles this account held. `owner_id` is ON DELETE SET NULL, so without
    # this the name stays RESERVED to nobody and can never be registered again.
    await session.execute(
        update(UsernameAsset)
        .where(UsernameAsset.owner_id == me.id)
        .values(
            owner_id=None,
            status=UsernameStatus.AVAILABLE,
            reserved_at=None,
            listed_at=None,
            price=None,
        )
    )
    await session.delete(me)
    await session.commit()
    _clear_auth_cookies(response)
    return DetailResponse(detail="account_deleted")


@app.patch("/api/users/me", response_model=UserProfile, tags=["profiles"])
async def update_current_profile(  # noqa: C901, PLR0912, PLR0915
    payload: ProfileUpdate, session: SessionDep, me: CurrentUser
) -> UserProfile:
    fields = payload.model_dump(exclude_unset=True)
    interests = fields.pop("interests", None)
    onboarding_complete = fields.pop("onboarding_complete", None)
    related_usernames = fields.pop("related_usernames", None)
    detail_field_names = {
        "website_url",
        "birthday",
        "github_url",
        "telegram_url",
        "profile_song_title",
        "profile_song_artist",
        "profile_song_url",
        "featured_community_slug",
        "featured_community_slugs",
        "role_title",
        "streak_days",
    }
    detail_fields = {field: fields.pop(field) for field in detail_field_names if field in fields}
    # Two of the remaining fields are Premium's, and both refusals name the price rather than the
    # rule: a long description, and a name colour. Keeping a colour already chosen is free — the
    # subscription pays for choosing, and a lapsed one does not strip a profile bare.
    if (bio := fields.get("bio")) and len(bio) > FREE_BIO_LENGTH:
        await _require_premium(
            session,
            me,
            f"Описание длиннее {FREE_BIO_LENGTH} символов — возможность Premium "
            f"(с ним до {PREMIUM_BIO_LENGTH})",
        )
    colour = fields.get("profile_color")
    if colour and colour not in {"default", me.profile_color or "default"}:
        await _require_premium(
            session, me, "Цвет имени в профиле, ленте и чатах — возможность GRAM Premium"
        )
    username = fields.pop("username", None)
    if username and username.lower() != me.username.lower():
        # Accounts, channels and collectible handles share one namespace.
        await _refuse_taken_handle(session, username, user_id=me.id)
        old_asset = await session.scalar(
            select(UsernameAsset).where(
                UsernameAsset.owner_id == me.id, UsernameAsset.username == me.username
            )
        )
        existing_asset = await session.scalar(
            select(UsernameAsset).where(func.lower(UsernameAsset.username) == username.lower())
        )
        previous_handle = me.username
        me.username = username.lower()
        if existing_asset is None:
            existing_asset = UsernameAsset(
                username=me.username,
                owner_id=me.id,
                status=UsernameStatus.RESERVED,
                currency="STARS",
                reserved_at=utcnow(),
            )
            session.add(existing_asset)
            await session.flush()
        else:
            existing_asset.owner_id = me.id
            existing_asset.status = UsernameStatus.RESERVED
            existing_asset.reserved_at = utcnow()
        session.add(
            UsernameOwnershipEvent(
                asset_id=existing_asset.id,
                to_user_id=me.id,
                action="profile_username",
            )
        )
        if old_asset and old_asset.id != existing_asset.id:
            # A previous handle stays owned by the account, so it cannot be sniped after a rename.
            old_asset.owner_id = me.id
            old_asset.status = UsernameStatus.RESERVED
            old_asset.price = None
            old_asset.listed_at = None
            session.add(
                UsernameOwnershipEvent(
                    asset_id=old_asset.id,
                    to_user_id=me.id,
                    action="released_handle",
                )
            )
        elif old_asset is None:
            kept = UsernameAsset(
                username=previous_handle,
                owner_id=me.id,
                status=UsernameStatus.RESERVED,
                currency="STARS",
                reserved_at=utcnow(),
            )
            session.add(kept)
            await session.flush()
            session.add(
                UsernameOwnershipEvent(
                    asset_id=kept.id, to_user_id=me.id, action="released_handle"
                )
            )
    for field, value in fields.items():
        setattr(me, field, value)
    if related_usernames is not None or "related_usernames" in payload.model_fields_set:
        me.related_usernames = related_usernames or []
        # Sending the field at all is the owner taking charge of the list. From here on it is theirs
        # verbatim, empty included — which is what makes a removed handle stay removed.
        me.usernames_auto = False
    # A profile may advertise several communities; the single slug stays the first of them, so
    # whichever field the client sends, both end up saying the same thing.
    chosen_slugs = detail_fields.get("featured_community_slugs")
    if chosen_slugs is not None:
        deduped: list[str] = []
        for slug in chosen_slugs:
            if slug not in deduped:
                deduped.append(slug)
        detail_fields["featured_community_slugs"] = deduped
        detail_fields["featured_community_slug"] = deduped[0] if deduped else None
    featured_community_slug = detail_fields.get("featured_community_slug")
    if featured_community_slug is not None and "featured_community_slugs" not in detail_fields:
        detail_fields["featured_community_slugs"] = [featured_community_slug]
    to_verify = [
        slug for slug in (detail_fields.get("featured_community_slugs") or []) if slug is not None
    ]
    if to_verify:
        owned = set(
            (
                await session.scalars(
                    select(Community.slug).where(
                        Community.slug.in_(to_verify), Community.owner_id == me.id
                    )
                )
            ).all()
        )
        if len(owned) != len(to_verify):
            # Existence is not enough: a profile advertising someone else's community would
            # read as an endorsement nobody gave.
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="В профиле можно показать только свои сообщества",
            )
    if detail_fields:
        details = await session.get(UserProfileDetails, me.id)
        if details is None:
            details = UserProfileDetails(user_id=me.id)
            session.add(details)
        for field, value in detail_fields.items():
            setattr(details, field, 0 if field == "streak_days" and value is None else value)
        details.updated_at = utcnow()
    preferences = await session.get(UserPreferences, me.id)
    if preferences is None:
        preferences = UserPreferences(user_id=me.id, interests=[], onboarding_complete=False)
        session.add(preferences)
    if interests is not None:
        preferences.interests = interests
    if onboarding_complete is not None:
        if onboarding_complete and (not me.username or not me.display_name.strip()):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Для завершения настройки нужны имя и юзернейм",
            )
        preferences.onboarding_complete = onboarding_complete
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Юзернейм уже занят"
        ) from exc
    await session.refresh(me)
    return await render_profile(session, me, me)


async def _store_image(file: UploadFile, folder: str, owner_id: uuid.UUID) -> str:
    """
    Validate an uploaded image and keep it under `MEDIA_ROOT/<folder>`, returning its URL.

    Pillow both identifies and verifies the payload, so a renamed executable is rejected on
    content rather than on the extension the browser happened to send.
    """
    payload = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(payload) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE, detail="Файл больше 5 МБ"
        )
    try:
        with Image.open(BytesIO(payload)) as image:
            image_format = (image.format or "").upper()
            width, height = image.size
            image.verify()
    except (UnidentifiedImageError, OSError, SyntaxError, Image.DecompressionBombError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Файл не является изображением",
        ) from exc
    extensions = {"JPEG": "jpg", "PNG": "png", "WEBP": "webp"}
    extension = extensions.get(image_format)
    if extension is None:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Поддерживаются PNG, JPG и WEBP",
        )
    if width * height > MAX_IMAGE_PIXELS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Слишком большое разрешение изображения",
        )
    target_dir = MEDIA_ROOT / folder
    target_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{owner_id}-{uuid.uuid4().hex}.{extension}"
    (target_dir / filename).write_bytes(payload)
    return f"/media/{folder}/{filename}"


# The container's own signature, read from the bytes rather than trusted from the name. MP4 and
# friends put `ftyp` at offset 4; WebM and Matroska share the EBML magic.
VIDEO_SIGNATURES: tuple[tuple[bytes, int, str], ...] = (
    (b"ftyp", 4, "mp4"),
    (bytes.fromhex("1a45dfa3"), 0, "webm"),
)


# What a post may carry as a document, identified by its own first bytes. Everything else is
# refused: this is a place to put a rider, a spec or a dataset, not a place to host programs.
FILE_SIGNATURES: tuple[tuple[bytes, str, str], ...] = (
    (b"%PDF-", "pdf", "PDF"),
    (b"PK\x03\x04", "zip", "ZIP"),
)
# Text is recognised by decoding rather than by a signature, because it has none.
TEXT_EXTENSIONS = {"txt": "TXT", "md": "MD", "csv": "CSV", "json": "JSON", "log": "LOG"}
SAFE_NAME = re.compile(r"[^\w \-.()\[\]]+", re.UNICODE)


def _basename(name: str) -> str:
    """
    The last segment of whatever the browser sent as a filename.

    Written out rather than handed to `pathlib`, because `Path` in this module is FastAPI's
    path-parameter marker — and a directory separator from a client has no business reaching a
    path API in the first place.
    """
    return name.replace("\\", "/").rsplit("/", 1)[-1].strip()


def _document_kind(payload: bytes, original_name: str) -> tuple[str, str] | None:
    """The extension to store under and the label to show, or None if this is not allowed."""
    for magic, extension, label in FILE_SIGNATURES:
        if payload.startswith(magic):
            return extension, label
    suffix = _basename(original_name).rpartition(".")[2].lower()
    if suffix in TEXT_EXTENSIONS:
        try:
            payload.decode("utf-8")
        except UnicodeDecodeError:
            return None
        return suffix, TEXT_EXTENSIONS[suffix]
    return None


async def _store_document(
    file: UploadFile, folder: str, owner_id: uuid.UUID, limit_bytes: int = MAX_FILE_BYTES
) -> tuple[str, str, int, str]:
    """
    Keep an uploaded document and return where it went, what to call it, its size and its kind.

    The stored name is ours — the author's is kept only as a label — so nothing about the upload
    can decide a path. The reader always gets it as a download: see `download_post_file`.

    `limit_bytes` is what this uploader may send: the free ceiling, or four times it with Premium.
    """
    payload = await file.read(limit_bytes + 1)
    if len(payload) > limit_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"Файл больше {limit_bytes // (1024 * 1024)} МБ",
        )
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Файл пустой"
        )
    original = (file.filename or "file").strip()
    resolved = _document_kind(payload, original)
    if resolved is None:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Поддерживаются PDF, ZIP и текстовые файлы (TXT, MD, CSV, JSON, LOG)",
        )
    extension, label = resolved
    target_dir = MEDIA_ROOT / folder
    target_dir.mkdir(parents=True, exist_ok=True)
    stored = f"{owner_id}-{uuid.uuid4().hex}.{extension}"
    (target_dir / stored).write_bytes(payload)
    # The label a reader sees, with anything that could travel as a path taken out of it.
    shown = SAFE_NAME.sub("_", _basename(original))[:160] or f"file.{extension}"
    return f"/api/feed/files/{stored}", shown, len(payload), label


async def _store_video(
    file: UploadFile, folder: str, owner_id: uuid.UUID, limit_bytes: int = MAX_VIDEO_BYTES
) -> str:
    """
    Keep an uploaded clip under `MEDIA_ROOT/<folder>` and return its URL.

    Nothing is transcoded: the file is served back exactly as it arrived, which is why the
    container is identified from its own bytes and anything else is refused. A renamed
    executable does not become a video by being called one.

    `limit_bytes` is this uploader's ceiling — Premium raises it, because nothing here has to be
    re-encoded and the only cost is what a reader has to pull down.
    """
    payload = await file.read(limit_bytes + 1)
    if len(payload) > limit_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"Видео больше {limit_bytes // (1024 * 1024)} МБ",
        )
    extension = next(
        (
            ext
            for magic, offset, ext in VIDEO_SIGNATURES
            if payload[offset : offset + len(magic)] == magic
        ),
        None,
    )
    if extension is None:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Поддерживаются MP4 и WEBM",
        )
    target_dir = MEDIA_ROOT / folder
    target_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{owner_id}-{uuid.uuid4().hex}.{extension}"
    (target_dir / filename).write_bytes(payload)
    return f"/media/{folder}/{filename}"


async def _save_profile_image(
    file: UploadFile, folder: str, session: AsyncSession, me: User
) -> UserProfile:
    """
    Store an avatar or a cover — a picture, or a short clip for a living one.

    A clip is kept exactly as it arrived and checked from its own bytes, like every other video
    here; the client loops it muted, so a "live" avatar is a video that behaves like an image.
    """
    kind = (file.content_type or "").lower()
    url = (
        await _store_video(file, folder, me.id)
        if kind.startswith("video/")
        else await _store_image(file, folder, me.id)
    )
    if folder == "avatars":
        me.avatar_url = url
    else:
        me.cover_url = url
    await session.commit()
    await session.refresh(me)
    return await render_profile(session, me, me)


@app.post("/api/users/me/avatar", response_model=UserProfile, tags=["profiles"])
async def upload_avatar(
    session: SessionDep, me: CurrentUser, file: Annotated[UploadFile, File()]
) -> UserProfile:
    return await _save_profile_image(file, "avatars", session, me)


@app.post("/api/users/me/cover", response_model=UserProfile, tags=["profiles"])
async def upload_cover(
    session: SessionDep, me: CurrentUser, file: Annotated[UploadFile, File()]
) -> UserProfile:
    return await _save_profile_image(file, "covers", session, me)


async def settings_for(session: AsyncSession, user_id: uuid.UUID) -> UserSettings:
    """The account's switches, created on first read so every caller can rely on a row."""
    settings = await session.get(UserSettings, user_id)
    if settings is None:
        settings = UserSettings(user_id=user_id)
        session.add(settings)
        await session.commit()
        await session.refresh(settings)
    return settings


async def _refuse_closed_inbox(session: AsyncSession, recipient: User, *, gift: bool) -> None:
    """
    Refuse a handover the recipient has switched off.

    Checked before anything moves, like the ban check beside it: a collectible that has already
    landed is the recipient's problem to undo, and undoing it costs them exactly as much work as
    receiving it did. The refusal names the person's choice rather than pretending the transfer
    failed, so the sender knows there is nothing to retry.
    """
    settings = await settings_for(session, recipient.id)
    if gift:
        if settings.accept_gifts:
            return
        detail = f"@{recipient.username} не принимает подарки"
    else:
        if settings.accept_usernames:
            return
        detail = f"@{recipient.username} не принимает юзернеймы"
    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


async def require_content_access(session: AsyncSession, owner: User, me: User) -> None:
    """
    A private account's posts, stories and replies are for its followers.

    The profile itself stays readable — name, avatar, counts — so a stranger can decide whether
    to ask; only the content behind the tabs is closed. Somebody the owner has blocked is closed
    out of the content too, and told so rather than shown an empty page.
    """
    if owner.id == me.id:
        return
    blocked = await session.scalar(
        select(UserBlock.id).where(
            UserBlock.blocker_id == owner.id, UserBlock.blocked_id == me.id
        )
    )
    if blocked is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"@{owner.username} заблокировал(а) вас",
        )
    settings = await session.get(UserSettings, owner.id)
    if settings is None or not settings.private_account:
        return
    follows = await session.scalar(
        select(Follow.id).where(Follow.follower_id == me.id, Follow.following_id == owner.id)
    )
    if follows is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Закрытый аккаунт: подпишитесь, чтобы видеть публикации",
        )


@app.get("/api/users/me/settings", response_model=UserSettingsOut, tags=["profiles"])
async def read_my_settings(session: SessionDep, me: CurrentUser) -> UserSettingsOut:
    return UserSettingsOut.model_validate(await settings_for(session, me.id))


@app.patch("/api/users/me/settings", response_model=UserSettingsOut, tags=["profiles"])
async def update_my_settings(
    payload: UserSettingsUpdate, session: SessionDep, me: CurrentUser
) -> UserSettingsOut:
    """Only the fields sent are touched, so one switch never resets another."""
    settings = await settings_for(session, me.id)
    changes = payload.model_dump(exclude_unset=True)
    # An emoji beside the name is a premium decoration, like the name's colour. Clearing it is
    # always allowed, and one already set keeps showing if the subscription lapses — the
    # subscription buys the choice, not the pixels.
    emoji = changes.get("status_emoji")
    if emoji and emoji != settings.status_emoji:
        await _require_premium(
            session, me, "Эмодзи-статус рядом с именем — возможность GRAM Premium"
        )
    for field, value in changes.items():
        setattr(settings, field, value)
    # The switch takes effect on the surfaces that read the flag straight away, rather than
    # from this account's next request onwards.
    me.is_online = settings.show_online and me.is_online
    if settings.show_online:
        await _touch_presence(session, me, online=True, force=True)
    await session.commit()
    await session.refresh(settings)
    return UserSettingsOut.model_validate(settings)


@app.get("/api/users/recommended", response_model=list[UserCompact], tags=["profiles"])
async def recommended_users(
    session: SessionDep, me: CurrentUser, limit: Annotated[int, Query(ge=1, le=30)] = 8
) -> list[UserCompact]:
    followed = select(Follow.following_id).where(Follow.follower_id == me.id)
    users = (
        await session.scalars(
            select(User)
            .where(User.id != me.id, User.id.not_in(followed))
            .order_by(User.is_verified.desc(), User.followers_count.desc())
            .limit(limit)
        )
    ).all()
    return [compact_user(user) for user in users]


@app.get("/api/badges", response_model=list[ProfileBadge], tags=["profiles"])
async def list_badges() -> list[ProfileBadge]:
    return [badge_out(slug) for slug in BADGE_CATALOG]


@app.get("/api/badges/{slug}", response_model=ProfileBadge, tags=["profiles"])
async def read_badge(slug: str) -> ProfileBadge:
    normalized = slug.strip().lower()
    if normalized not in BADGE_CATALOG:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Бейдж не найден")
    return badge_out(normalized)


# Declared before `/api/users/{username}/badges`: routes match in order, and "me" would
# otherwise be read as somebody's handle and never resolve.
@app.get("/api/users/me/badges", response_model=MyBadgesOut, tags=["profiles"])
async def read_my_badges(session: SessionDep, me: CurrentUser) -> MyBadgesOut:
    """
    The whole shelf: every badge in GRAM, which of them this account has, and what the rest need.

    Locked ones are shown on purpose — a list of only what somebody already earned is a list
    nobody can act on, and the requirement is the interesting part.
    """
    is_premium = me.id in await premium_user_ids(session, [me.id])
    unlocked, metrics = await available_badges(session, me, is_premium=is_premium)
    earned = set(unlocked)
    chosen = shown_badge_slugs(me, is_premium=is_premium)
    offers: list[BadgeOffer] = []
    for slug in BADGE_CATALOG:
        rule = BADGE_RULES.get(slug)
        offers.append(
            BadgeOffer(
                badge=badge_out(slug),
                earned=slug in earned,
                chosen=slug in chosen,
                progress=min(metrics.get(rule[0], 0), rule[1]) if rule else None,
                target=rule[1] if rule else None,
            )
        )
    # Earned first, then the closest to being earned: the shelf reads as a path.
    offers.sort(
        key=lambda offer: (
            not offer.earned,
            -((offer.progress or 0) / offer.target) if offer.target else 0,
            -offer.badge.points,
        )
    )
    return MyBadgesOut(
        limit=badge_slot_limit(is_premium=is_premium), slots=chosen, badges=offers
    )


@app.put("/api/users/me/badges", response_model=UserProfile, tags=["profiles"])
async def choose_my_badges(
    payload: BadgeSelection, session: SessionDep, me: CurrentUser
) -> UserProfile:
    """
    Wear a chosen set of badges.

    Only what the account actually has, and only as many as its plan allows: three for everybody,
    seven with Premium. Both refusals name the number rather than silently trimming the list.
    """
    is_premium = me.id in await premium_user_ids(session, [me.id])
    limit = badge_slot_limit(is_premium=is_premium)
    wanted = list(dict.fromkeys(slug.strip() for slug in payload.slugs if slug.strip()))
    if len(wanted) > limit:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Можно носить {limit} бейджа"
            + ("" if is_premium else " — с Premium доступно 7"),
        )
    unlocked, _ = await available_badges(session, me, is_premium=is_premium)
    missing = [slug for slug in wanted if slug not in set(unlocked)]
    if missing:
        first = badge_out(missing[0])
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"«{first.title}» пока не получен: {first.qualification}",
        )
    me.badge_slots = wanted
    await session.commit()
    await session.refresh(me)
    return await render_profile(session, me, me)


@app.get("/api/users/{username}/badges", response_model=list[ProfileBadge], tags=["profiles"])
async def read_user_badges(username: str, session: SessionDep) -> list[ProfileBadge]:
    user = await resolve_user(session, username)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Пользователь не найден")
    is_premium = user.id in await premium_user_ids(session, [user.id])
    return profile_badges(shown_badge_slugs(user, is_premium=is_premium))


@app.get("/api/users/{username}", response_model=UserProfile, tags=["profiles"])
async def read_public_profile(username: str, session: SessionDep, me: CurrentUser) -> UserProfile:
    user = await resolve_user(session, username)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Пользователь не найден")
    return await render_profile(session, user, me)


@app.get("/api/users/{username}/stories", response_model=list[ProfileStoryOut], tags=["profiles"])
async def read_profile_stories(
    username: str, session: SessionDep, me: CurrentUser
) -> list[ProfileStoryOut]:
    author = await resolve_user(session, username)
    if author is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Пользователь не найден",
        )
    await require_content_access(session, author, me)
    stories = (
        await session.scalars(
            select(ProfileStory)
            .where(
                ProfileStory.author_id == author.id,
                or_(
                    ProfileStory.highlight.is_(True),
                    ProfileStory.expires_at.is_(None),
                    ProfileStory.expires_at > utcnow(),
                ),
            )
            .order_by(ProfileStory.highlight.desc(), ProfileStory.created_at.desc())
        )
    ).all()
    # A story published into a channel lives on that channel, not on its author's profile.
    own = [story for story in stories if story.community_id is None]
    counts, seen = await _story_stats(session, [story.id for story in own], me.id)
    return [
        profile_story_out(
            story,
            author,
            views_count=counts.get(story.id, 0),
            seen=story.id in seen or author.id == me.id,
            is_mine=author.id == me.id,
        )
        for story in own
    ]


@app.post(
    "/api/users/me/stories",
    response_model=ProfileStoryOut,
    status_code=status.HTTP_201_CREATED,
    tags=["profiles"],
)
async def create_profile_story(
    payload: ProfileStoryCreate, session: SessionDep, me: CurrentUser
) -> ProfileStoryOut:
    community_id: uuid.UUID | None = None
    if payload.community_slug:
        community = await session.scalar(
            select(Community).where(func.lower(Community.slug) == payload.community_slug.lower())
        )
        if community is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Сообщество не найдено"
            )
        if community.owner_id != me.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Публиковать историю канала может только владелец",
            )
        community_id = community.id
    story = ProfileStory(
        author_id=me.id,
        community_id=community_id,
        title=payload.title,
        media_url=payload.media_url,
        expires_at=payload.expires_at,
        highlight=payload.highlight,
    )
    session.add(story)
    await session.commit()
    await session.refresh(story)
    return profile_story_out(story, me)


@app.delete("/api/users/me/stories/{story_id}", response_model=DetailResponse, tags=["profiles"])
async def delete_profile_story(
    story_id: uuid.UUID, session: SessionDep, me: CurrentUser
) -> DetailResponse:
    story = await session.get(ProfileStory, story_id)
    if story is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="История не найдена"
        )
    if story.author_id != me.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Историю может удалить только автор",
        )
    await session.delete(story)
    await session.commit()
    return DetailResponse(detail="deleted")


@app.post(
    "/api/users/me/stories/media",
    response_model=UploadedMedia,
    status_code=status.HTTP_201_CREATED,
    tags=["profiles"],
)
async def upload_story_media(
    session: SessionDep, me: CurrentUser, file: Annotated[UploadFile, File()]
) -> UploadedMedia:
    """
    Store one picture or clip for a story being composed.

    One endpoint, because the composer has one file button: what arrived decides which checker
    runs, and neither trusts the name it was given.
    """
    del session
    kind = (file.content_type or "").lower()
    if kind.startswith("video/"):
        return UploadedMedia(url=await _store_video(file, "stories", me.id))
    return UploadedMedia(url=await _store_image(file, "stories", me.id))


async def _story_stats(
    session: AsyncSession, story_ids: list[uuid.UUID], me_id: uuid.UUID
) -> tuple[dict[uuid.UUID, int], set[uuid.UUID]]:
    """View counts for a set of stories, and which of them this reader has already opened."""
    if not story_ids:
        return {}, set()
    wanted = set(story_ids)
    counts = (
        await session.execute(
            select(StoryView.story_id, func.count())
            .where(StoryView.story_id.in_(wanted))
            .group_by(StoryView.story_id)
        )
    ).all()
    seen = set(
        (
            await session.scalars(
                select(StoryView.story_id).where(
                    StoryView.story_id.in_(wanted), StoryView.user_id == me_id
                )
            )
        ).all()
    )
    return {story_id: int(total) for story_id, total in counts}, seen


async def _readable_story(
    session: AsyncSession, story_id: uuid.UUID, me: User
) -> tuple[ProfileStory, User]:
    """A story the caller is allowed to see, with its author — or the right refusal."""
    story = await session.get(ProfileStory, story_id)
    if story is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="История не найдена")
    author = await session.get(User, story.author_id)
    if author is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Автор не найден")
    await require_content_access(session, author, me)
    return story, author


@app.get("/api/stories/feed", response_model=list[StoryFeedEntry], tags=["profiles"])
async def read_stories_feed(session: SessionDep, me: CurrentUser) -> list[StoryFeedEntry]:
    """
    What the people this reader follows are showing right now, grouped by author.

    Only stories with a live window: a highlight with no expiry is a permanent decoration of
    somebody's profile, and putting it in the rail would mean it never went away. Channel
    stories are left out too — they belong to the channel's own page.
    """
    followed = set(
        (
            await session.scalars(
                select(Follow.following_id).where(Follow.follower_id == me.id)
            )
        ).all()
    )
    # Somebody who blocked me keeps their stories to themselves, even if I still follow them.
    blockers = set(
        (
            await session.scalars(
                select(UserBlock.blocker_id).where(UserBlock.blocked_id == me.id)
            )
        ).all()
    )
    authors = (followed | {me.id}) - (blockers - {me.id})
    rows = (
        await session.execute(
            select(ProfileStory, User)
            .join(User, ProfileStory.author_id == User.id)
            .where(
                ProfileStory.author_id.in_(authors),
                ProfileStory.community_id.is_(None),
                ProfileStory.expires_at.is_not(None),
                ProfileStory.expires_at > utcnow(),
            )
            .order_by(ProfileStory.created_at)
        )
    ).all()
    counts, seen = await _story_stats(session, [story.id for story, _ in rows], me.id)
    grouped: dict[uuid.UUID, list[ProfileStoryOut]] = {}
    authors_by_id: dict[uuid.UUID, User] = {}
    for story, author in rows:
        authors_by_id[author.id] = author
        grouped.setdefault(author.id, []).append(
            profile_story_out(
                story,
                author,
                views_count=counts.get(story.id, 0),
                seen=story.id in seen or author.id == me.id,
                is_mine=author.id == me.id,
            )
        )
    entries = [
        StoryFeedEntry(
            author=compact_user(authors_by_id[author_id]),
            stories=stories,
            has_unseen=any(not story.seen for story in stories),
            is_me=author_id == me.id,
        )
        for author_id, stories in grouped.items()
    ]
    # Mine first, then whoever has something unwatched, newest activity first inside each group:
    # the order the rail is read in.
    entries.sort(
        key=lambda entry: (
            not entry.is_me,
            not entry.has_unseen,
            -_as_utc(entry.stories[-1].created_at).timestamp(),
        )
    )
    return entries


@app.post("/api/stories/{story_id}/view", response_model=DetailResponse, tags=["profiles"])
async def mark_story_seen(
    story_id: uuid.UUID, session: SessionDep, me: CurrentUser
) -> DetailResponse:
    """Record that this reader opened the story. Opening one's own changes nothing."""
    story, _ = await _readable_story(session, story_id, me)
    if story.author_id == me.id:
        return DetailResponse(detail="own_story")
    existing = await session.scalar(
        select(StoryView.id).where(StoryView.story_id == story.id, StoryView.user_id == me.id)
    )
    if existing is None:
        session.add(StoryView(story_id=story.id, user_id=me.id))
        await session.commit()
    return DetailResponse(detail="seen")


@app.get(
    "/api/stories/{story_id}/viewers", response_model=list[StoryViewerOut], tags=["profiles"]
)
async def read_story_viewers(
    story_id: uuid.UUID, session: SessionDep, me: CurrentUser
) -> list[StoryViewerOut]:
    """Who watched. The author's own list — a viewer is not told who else was there."""
    story = await session.get(ProfileStory, story_id)
    if story is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="История не найдена")
    if story.author_id != me.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Просмотры видит только автор истории",
        )
    rows = (
        await session.execute(
            select(StoryView, User)
            .join(User, StoryView.user_id == User.id)
            .where(StoryView.story_id == story.id)
            .order_by(StoryView.created_at.desc())
        )
    ).all()
    return [StoryViewerOut(user=compact_user(user), at=view.created_at) for view, user in rows]


@app.post(
    "/api/stories/{story_id}/share",
    response_model=DetailResponse,
    status_code=status.HTTP_201_CREATED,
    tags=["profiles"],
)
async def share_story(
    story_id: uuid.UUID, payload: StoryShare, session: SessionDep, me: CurrentUser
) -> DetailResponse:
    """
    Send a story into conversations — anyone's story, not only one's own.

    The message points at the story rather than copying its media: if the author takes it down,
    the card says so instead of outliving the decision.
    """
    story, _ = await _readable_story(session, story_id, me)
    sent = 0
    for chat_id in dict.fromkeys(payload.chat_ids):
        outgoing = await create_chat_message(
            session, chat_id, me, payload.text.strip(), story_id=story.id
        )
        await chat_connections.broadcast(
            chat_id, {"type": "message", "message": broadcast_payload(outgoing)}
        )
        sent += 1
    return DetailResponse(detail=f"Отправлено: {sent}")


@app.get("/api/users/{username}/replies", response_model=list[ProfileReplyOut], tags=["profiles"])
async def read_profile_replies(
    username: str,
    session: SessionDep,
    me: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
) -> list[ProfileReplyOut]:
    author = await resolve_user(session, username)
    if author is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Пользователь не найден",
        )
    await require_content_access(session, author, me)
    post_author = aliased(User)
    rows = (
        await session.execute(
            select(PostComment, Post, post_author)
            .join(Post, PostComment.post_id == Post.id)
            .join(post_author, Post.author_id == post_author.id)
            .where(PostComment.author_id == author.id)
            .order_by(PostComment.created_at.desc())
            .limit(limit)
        )
    ).all()
    return [
        ProfileReplyOut(
            id=reply.id,
            post_id=post.id,
            author=compact_user(author),
            content=reply.content,
            created_at=reply.created_at,
            parent_post=ProfileReplyParentPost(
                id=post.id,
                author=compact_user(parent_author),
                content=post.content,
                image_url=post.image_url,
                created_at=post.created_at,
            ),
        )
        for reply, post, parent_author in rows
    ]


@app.put("/api/users/me/note", response_model=ProfileNote, tags=["profiles"])
async def upsert_profile_note(
    payload: NoteUpsert, session: SessionDep, me: CurrentUser
) -> ProfileNote:
    """The note belongs to the profile owner and is shown to everyone who opens it."""
    details = await session.get(UserProfileDetails, me.id)
    if details is None:
        details = UserProfileDetails(user_id=me.id)
        session.add(details)
    text = (payload.content or "").strip()
    details.profile_note = text or None
    details.updated_at = utcnow()
    await session.commit()
    await session.refresh(details)
    return ProfileNote(content=details.profile_note, updated_at=details.updated_at)


async def _follow_state(
    target: User, me: User, *, active: bool, requested: bool = False
) -> FollowState:
    return FollowState(
        username=target.username,
        is_following=active,
        followers_count=target.followers_count,
        following_count=me.following_count,
        requested=requested,
    )


@app.post("/api/users/{username}/follow", response_model=FollowState, tags=["social graph"])
async def follow_user(username: str, session: SessionDep, me: CurrentUser) -> FollowState:
    target = await resolve_user(session, username)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Пользователь не найден")
    if target.id == me.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Нельзя подписаться на себя"
        )
    # A block that could be walked around by pressing «Читать» again would not be a block.
    if await session.scalar(
        select(UserBlock.id).where(
            UserBlock.blocker_id == target.id, UserBlock.blocked_id == me.id
        )
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"@{target.username} заблокировал(а) вас",
        )
    # A banned account cannot gain an audience while it is banned. Existing followers keep their
    # subscription — the ban is on the account, not on the people who once read it — but the
    # count must not keep growing after a moderator has stopped it.
    if target.banned_at is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"@{target.username} заблокирован администрацией",
        )
    existing = await session.scalar(
        select(Follow).where(Follow.follower_id == me.id, Follow.following_id == target.id)
    )
    if existing:
        return await _follow_state(target, me, active=True)
    # A closed account decides for itself: the follow becomes a request it can answer.
    target_settings = await settings_for(session, target.id)
    if target_settings.private_account:
        pending = await session.scalar(
            select(FollowRequest).where(
                FollowRequest.requester_id == me.id, FollowRequest.target_id == target.id
            )
        )
        if pending is None:
            session.add(FollowRequest(requester_id=me.id, target_id=target.id))
            session.add(
                Notification(
                    user_id=target.id,
                    actor_id=me.id,
                    kind=NotificationKind.FOLLOW_REQUEST,
                    text=f"{me.display_name} хочет подписаться на вас",
                    entity_id=str(me.id),
                )
            )
            await session.commit()
        return await _follow_state(target, me, active=False, requested=True)
    await session.execute(select(User).where(User.id.in_([me.id, target.id])).with_for_update())
    session.add(Follow(follower_id=me.id, following_id=target.id))
    me.following_count += 1
    target.followers_count += 1
    session.add(
        Notification(
            user_id=target.id,
            actor_id=me.id,
            kind=NotificationKind.FOLLOW,
            text=f"{me.display_name} подписался(ась) на вас",
            entity_id=str(me.id),
        )
    )
    await session.commit()
    return await _follow_state(target, me, active=True)


@app.delete("/api/users/{username}/follow", response_model=FollowState, tags=["social graph"])
async def unfollow_user(username: str, session: SessionDep, me: CurrentUser) -> FollowState:
    target = await resolve_user(session, username)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Пользователь не найден")
    # Withdrawing an unanswered request is the same gesture as unfollowing.
    pending = await session.scalar(
        select(FollowRequest).where(
            FollowRequest.requester_id == me.id, FollowRequest.target_id == target.id
        )
    )
    if pending is not None:
        await session.delete(pending)
        await session.commit()
    existing = await session.scalar(
        select(Follow).where(Follow.follower_id == me.id, Follow.following_id == target.id)
    )
    if existing:
        await session.execute(select(User).where(User.id.in_([me.id, target.id])).with_for_update())
        await session.delete(existing)
        me.following_count = max(0, me.following_count - 1)
        target.followers_count = max(0, target.followers_count - 1)
        await session.commit()
    return await _follow_state(target, me, active=False)


@app.get(
    "/api/users/me/follow-requests", response_model=list[FollowRequestOut], tags=["social graph"]
)
async def read_follow_requests(session: SessionDep, me: CurrentUser) -> list[FollowRequestOut]:
    """Who is waiting to be let into a closed account, newest first."""
    rows = (
        await session.execute(
            select(FollowRequest, User)
            .join(User, FollowRequest.requester_id == User.id)
            .where(FollowRequest.target_id == me.id)
            .order_by(FollowRequest.created_at.desc())
        )
    ).all()
    hidden = await presence_hidden_ids(session, [user.id for _, user in rows])
    premium = await premium_user_ids(session, [user.id for _, user in rows])
    emblems = await name_gift_map(session, [user.id for _, user in rows])
    return [
        FollowRequestOut(
            id=request.id,
            user=compact_user(
                user,
                is_premium=user.id in premium,
                hide_presence=user.id in hidden,
                name_gift=emblems.get(user.id),
            ),
            created_at=request.created_at,
        )
        for request, user in rows
    ]


@app.post(
    "/api/users/me/follow-requests/{request_id}",
    response_model=FollowState,
    tags=["social graph"],
)
async def accept_follow_request(
    request_id: uuid.UUID, session: SessionDep, me: CurrentUser
) -> FollowState:
    """Let them in: the request becomes a real follow, and they hear about it."""
    request = await session.get(FollowRequest, request_id)
    if request is None or request.target_id != me.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Заявка не найдена")
    requester = await session.get(User, request.requester_id)
    if requester is None:
        await session.delete(request)
        await session.commit()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Заявка не найдена")
    existing = await session.scalar(
        select(Follow).where(Follow.follower_id == requester.id, Follow.following_id == me.id)
    )
    if existing is None:
        await session.execute(
            select(User).where(User.id.in_([me.id, requester.id])).with_for_update()
        )
        session.add(Follow(follower_id=requester.id, following_id=me.id))
        requester.following_count += 1
        me.followers_count += 1
        session.add(
            Notification(
                user_id=requester.id,
                actor_id=me.id,
                kind=NotificationKind.FOLLOW,
                text=f"{me.display_name} принял(а) вашу заявку",
                entity_id=str(me.id),
            )
        )
    await session.delete(request)
    await session.commit()
    return await _follow_state(me, requester, active=True)


@app.delete(
    "/api/users/me/follow-requests/{request_id}",
    response_model=DetailResponse,
    tags=["social graph"],
)
async def decline_follow_request(
    request_id: uuid.UUID, session: SessionDep, me: CurrentUser
) -> DetailResponse:
    """
    Refuse quietly.

    The requester is not told, and the row is deleted rather than remembered as a refusal, so
    they may ask again later — a permanent "no" is what blocking is for.
    """
    request = await session.get(FollowRequest, request_id)
    if request is None or request.target_id != me.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Заявка не найдена")
    await session.delete(request)
    await session.commit()
    return DetailResponse(detail="Заявка отклонена")


BLOCKED_ACTION_DETAIL = "Недоступно: между вами блокировка"


async def blocked_pair_ids(session: AsyncSession, me_id: uuid.UUID) -> set[uuid.UUID]:
    """
    Everyone on either side of a block with this account.

    A block is symmetric in what it hides: the person I blocked disappears from my lists just
    as I disappear from theirs. One query, because it filters whole feeds.
    """
    rows = await session.execute(
        select(UserBlock.blocker_id, UserBlock.blocked_id).where(
            or_(UserBlock.blocker_id == me_id, UserBlock.blocked_id == me_id)
        )
    )
    ids: set[uuid.UUID] = set()
    for blocker_id, blocked_id in rows.all():
        ids.add(blocked_id if blocker_id == me_id else blocker_id)
    return ids


async def unreadable_author_ids(session: AsyncSession, me: User) -> set[uuid.UUID]:
    """
    Authors whose posts must not appear in a mixed list for this reader.

    Two reasons, both the authors' own decisions: a block in either direction, and a closed
    account this reader has not been let into. The author page answers 403 for the second case,
    but a feed cannot — it would have to explain a refusal about thirty different people — so
    the posts are simply not there, which is what "закрытый аккаунт" means.
    """
    walled_off = await blocked_pair_ids(session, me.id)
    closed = set(
        (
            await session.scalars(
                select(UserSettings.user_id).where(UserSettings.private_account.is_(True))
            )
        ).all()
    )
    if closed:
        allowed = set(
            (
                await session.scalars(
                    select(Follow.following_id).where(
                        Follow.follower_id == me.id, Follow.following_id.in_(closed)
                    )
                )
            ).all()
        )
        closed -= allowed
        closed.discard(me.id)
    return walled_off | closed


async def refuse_if_blocked_with(session: AsyncSession, other_id: uuid.UUID, me: User) -> None:
    """Refuse an action aimed at someone a block stands between — in either direction."""
    if other_id == me.id:
        return
    if await _blocked_between(session, me.id, other_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=BLOCKED_ACTION_DETAIL
        )


async def _blocked_between(
    session: AsyncSession, first_id: uuid.UUID, second_id: uuid.UUID
) -> bool:
    """Whether either of two people has blocked the other — a block cuts both directions."""
    found = await session.scalar(
        select(UserBlock.id).where(
            or_(
                and_(UserBlock.blocker_id == first_id, UserBlock.blocked_id == second_id),
                and_(UserBlock.blocker_id == second_id, UserBlock.blocked_id == first_id),
            )
        )
    )
    return found is not None


BLOCKED_CHAT_DETAIL = "Переписка недоступна: чат заблокирован"


async def refuse_if_closed_inbox(session: AsyncSession, target: User, me: User) -> None:
    """
    Honour the recipient's «кто может мне писать».

    `following` means the recipient follows the sender — the reference's own reading of it, and
    the only one that makes the setting useful: an account that answers nobody it has not
    chosen to hear from. The refusal names the reason, because a chat that silently fails to
    open reads as a broken product.
    """
    if target.id == me.id:
        return
    settings = await settings_for(session, target.id)
    rule = settings.who_can_message or "everyone"
    if rule == "everyone":
        return
    if rule == "nobody":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"@{target.username} не принимает сообщения",
        )
    follows_me = await session.scalar(
        select(Follow.id).where(Follow.follower_id == target.id, Follow.following_id == me.id)
    )
    if not follows_me:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"@{target.username} принимает сообщения только от тех, кого читает",
        )


async def _drop_following(session: AsyncSession, follower: User, followed: User) -> None:
    """Undo one direction of following, keeping both counters honest."""
    link = await session.scalar(
        select(Follow).where(Follow.follower_id == follower.id, Follow.following_id == followed.id)
    )
    if link is None:
        return
    await session.delete(link)
    follower.following_count = max(0, follower.following_count - 1)
    followed.followers_count = max(0, followed.followers_count - 1)


@app.post("/api/users/{username}/block", response_model=DetailResponse, tags=["social graph"])
async def block_user(username: str, session: SessionDep, me: CurrentUser) -> DetailResponse:
    """
    Refuse a person: the direct chat closes both ways and any following is dropped.

    Both directions of following go, not only mine: someone I have blocked must not keep my
    posts in their feed, and a follower count that still includes them would be a lie. The
    blocked side is told plainly on my profile, because silence there reads as a bug.
    """
    target = await resolve_user(session, username)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Пользователь не найден")
    if target.id == me.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Нельзя заблокировать себя"
        )
    existing = await session.scalar(
        select(UserBlock).where(UserBlock.blocker_id == me.id, UserBlock.blocked_id == target.id)
    )
    if existing is not None:
        return DetailResponse(detail="Уже заблокирован")
    session.add(UserBlock(blocker_id=me.id, blocked_id=target.id))
    await session.execute(select(User).where(User.id.in_([me.id, target.id])).with_for_update())
    await _drop_following(session, me, target)
    await _drop_following(session, target, me)
    await session.commit()
    return DetailResponse(detail=f"@{target.username} заблокирован")


@app.delete("/api/users/{username}/block", response_model=DetailResponse, tags=["social graph"])
async def unblock_user(username: str, session: SessionDep, me: CurrentUser) -> DetailResponse:
    """Lifts only my own block; if they blocked me too, that row is theirs to remove."""
    target = await resolve_user(session, username)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Пользователь не найден")
    existing = await session.scalar(
        select(UserBlock).where(UserBlock.blocker_id == me.id, UserBlock.blocked_id == target.id)
    )
    if existing is not None:
        await session.delete(existing)
        await session.commit()
    return DetailResponse(detail=f"@{target.username} разблокирован")


@app.get("/api/users/{username}/followers", response_model=list[UserCompact], tags=["social graph"])
async def user_followers(username: str, session: SessionDep, me: CurrentUser) -> list[UserCompact]:
    del me
    target = await resolve_user(session, username)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Пользователь не найден")
    users = (
        await session.scalars(
            select(User)
            .join(Follow, Follow.follower_id == User.id)
            .where(Follow.following_id == target.id)
        )
    ).all()
    return [compact_user(user) for user in users]


@app.get("/api/users/{username}/following", response_model=list[UserCompact], tags=["social graph"])
async def user_following(username: str, session: SessionDep, me: CurrentUser) -> list[UserCompact]:
    del me
    target = await resolve_user(session, username)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Пользователь не найден")
    users = (
        await session.scalars(
            select(User)
            .join(Follow, Follow.following_id == User.id)
            .where(Follow.follower_id == target.id)
        )
    ).all()
    return [compact_user(user) for user in users]


MAX_DRAFTS = 20


def _draft_out(draft: PostDraft, community_slug: str | None) -> PostDraftOut:
    return PostDraftOut(
        id=draft.id,
        content=draft.content or "",
        image_urls=list(draft.image_urls or []),
        video_url=draft.video_url,
        file_url=draft.file_url,
        file_name=draft.file_name,
        file_size=draft.file_size,
        poll_options=list(draft.poll_options or []),
        sensitive=draft.sensitive,
        link_url=draft.link_url,
        link_title=draft.link_title,
        community_slug=community_slug,
        created_at=draft.created_at,
        updated_at=draft.updated_at,
    )


async def _draft_community(session: AsyncSession, me: User, slug: str | None) -> Community | None:
    """A draft for a channel is only offered by the channel that its author owns."""
    if not slug:
        return None
    community = await _resolve_community(session, slug)
    if community is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Сообщество не найдено")
    if community.owner_id != me.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Черновик канала может сохранить только его владелец",
        )
    return community


def _apply_draft(draft: PostDraft, payload: PostDraftBody, community: Community | None) -> None:
    draft.community_id = community.id if community else None
    draft.content = payload.content
    draft.image_urls = list(payload.image_urls or []) or None
    draft.video_url = payload.video_url
    draft.file_url = payload.file_url
    draft.file_name = payload.file_name
    draft.file_size = payload.file_size
    draft.poll_options = list(payload.poll_options or []) or None
    draft.sensitive = payload.sensitive
    draft.link_url = payload.link_url
    draft.link_title = payload.link_title


@app.get("/api/feed/drafts", response_model=list[PostDraftOut], tags=["feed"])
async def read_drafts(session: SessionDep, me: CurrentUser) -> list[PostDraftOut]:
    """One's own unfinished posts, most recently touched first."""
    rows = (
        await session.execute(
            select(PostDraft, Community.slug)
            .outerjoin(Community, PostDraft.community_id == Community.id)
            .where(PostDraft.author_id == me.id)
            .order_by(PostDraft.updated_at.desc())
            .limit(MAX_DRAFTS)
        )
    ).all()
    return [_draft_out(draft, slug) for draft, slug in rows]


@app.post(
    "/api/feed/drafts",
    response_model=PostDraftOut,
    status_code=status.HTTP_201_CREATED,
    tags=["feed"],
)
async def create_draft(
    payload: PostDraftBody, session: SessionDep, me: CurrentUser
) -> PostDraftOut:
    """
    Keep an unfinished post.

    Bounded, because a drawer nobody empties is not a feature: past twenty the oldest has to go
    or be deleted deliberately, and saying so is better than quietly dropping one.
    """
    held = int(
        await session.scalar(
            select(func.count()).select_from(PostDraft).where(PostDraft.author_id == me.id)
        )
        or 0
    )
    if held >= MAX_DRAFTS:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Больше {MAX_DRAFTS} черновиков не сохранить — удалите ненужные",
        )
    community = await _draft_community(session, me, payload.community_slug)
    draft = PostDraft(author_id=me.id)
    _apply_draft(draft, payload, community)
    session.add(draft)
    await session.commit()
    await session.refresh(draft)
    return _draft_out(draft, community.slug if community else None)


@app.patch("/api/feed/drafts/{draft_id}", response_model=PostDraftOut, tags=["feed"])
async def update_draft(
    draft_id: uuid.UUID, payload: PostDraftBody, session: SessionDep, me: CurrentUser
) -> PostDraftOut:
    """Save over a draft that was picked up again, rather than leaving two of the same post."""
    draft = await session.get(PostDraft, draft_id)
    if draft is None or draft.author_id != me.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Черновик не найден")
    community = await _draft_community(session, me, payload.community_slug)
    _apply_draft(draft, payload, community)
    await session.commit()
    await session.refresh(draft)
    return _draft_out(draft, community.slug if community else None)


@app.delete("/api/feed/drafts/{draft_id}", response_model=DetailResponse, tags=["feed"])
async def delete_draft(
    draft_id: uuid.UUID, session: SessionDep, me: CurrentUser
) -> DetailResponse:
    draft = await session.get(PostDraft, draft_id)
    if draft is None or draft.author_id != me.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Черновик не найден")
    await session.delete(draft)
    await session.commit()
    return DetailResponse(detail="Черновик удалён")


@app.get("/api/feed/bookmarks", response_model=list[FeedPost], tags=["feed"])
async def read_bookmarks(session: SessionDep, me: CurrentUser) -> list[FeedPost]:
    rows = (
        await session.execute(
            select(Post, User)
            .join(PostBookmark, PostBookmark.post_id == Post.id)
            .join(User, Post.author_id == User.id)
            .where(PostBookmark.user_id == me.id)
            # Saved before the block or before the account closed, and no longer mine to read.
            .where(Post.author_id.notin_(await unreadable_author_ids(session, me)))
            .order_by(PostBookmark.created_at.desc())
        )
    ).all()
    premium = await premium_user_ids(session, [author.id for _, author in rows])
    hidden = await presence_hidden_ids(session, [author.id for _, author in rows])
    return [
        await render_post(session, post, author, me, premium=premium, presence_hidden=hidden)
        for post, author in rows
    ]


HASHTAG_PATTERN = re.compile(r"#([0-9a-zA-Zа-яА-ЯёЁ_]{2,40})")


async def hashtag_counts(session: AsyncSession, sample: int = 800) -> Counter[str]:
    """Trends are derived from post text, so no separate tag table has to be maintained."""
    rows = (
        await session.scalars(select(Post.content).order_by(Post.created_at.desc()).limit(sample))
    ).all()
    counter: Counter[str] = Counter()
    for content in rows:
        for tag in {match.lower() for match in HASHTAG_PATTERN.findall(content or "")}:
            counter[tag] += 1
    return counter


@app.get("/api/trends", response_model=list[TrendOut], tags=["discovery"])
async def read_trends(
    session: SessionDep,
    me: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=30)] = 8,
) -> list[TrendOut]:
    del me
    counts = await hashtag_counts(session)
    return [
        TrendOut(tag=tag, posts_count=total) for tag, total in counts.most_common(limit)
    ]


@app.get("/api/search", response_model=SearchResults, tags=["discovery"])
async def search_everything(
    session: SessionDep,
    me: CurrentUser,
    q: Annotated[str, Query(min_length=1, max_length=80)],
    limit: Annotated[int, Query(ge=1, le=30)] = 8,
) -> SearchResults:
    """One query across people, channels and hashtags for the Explore field."""
    del me
    needle = q.strip().removeprefix("@").removeprefix("#").lower()
    if not needle:
        return SearchResults(query=q)
    pattern = f"%{needle}%"
    users = (
        await session.scalars(
            select(User)
            .where(
                or_(
                    func.lower(User.username).like(pattern),
                    func.lower(User.display_name).like(pattern),
                    func.lower(User.bio).like(pattern),
                )
            )
            .order_by(User.is_verified.desc(), User.followers_count.desc())
            .limit(limit)
        )
    ).all()
    community_rows = (
        await session.execute(
            select(Community, User)
            .join(User, Community.owner_id == User.id)
            .where(
                or_(
                    func.lower(Community.slug).like(pattern),
                    func.lower(Community.title).like(pattern),
                    func.lower(Community.description).like(pattern),
                )
            )
            .order_by(Community.members_count.desc())
            .limit(limit)
        )
    ).all()
    counts = await hashtag_counts(session)
    tags = [
        TrendOut(tag=tag, posts_count=total)
        for tag, total in counts.most_common()
        if needle in tag
    ][:limit]
    return SearchResults(
        query=q,
        people=[compact_user(user) for user in users],
        communities=[
            CommunityCompact(
                slug=community.slug,
                title=community.title,
                avatar_url=community.avatar_url,
                members_count=community.members_count,
                is_verified=community.is_verified,
                owner_verified=owner.is_verified,
            )
            for community, owner in community_rows
        ],
        tags=tags,
    )


@app.get("/api/feed", response_model=list[FeedPost], tags=["feed"])
async def read_feed(
    session: SessionDep,
    me: CurrentUser,
    mode: Annotated[str, Query(pattern="^(for_you|following)$")] = "for_you",
    author: str | None = None,
    hashtag: Annotated[str | None, Query(max_length=40)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
) -> list[FeedPost]:
    query = select(Post, User).join(User, Post.author_id == User.id)
    author_user: User | None = None
    if author:
        author_user = await resolve_user(session, author)
        if author_user is None:
            return []
        await require_content_access(session, author_user, me)
        query = query.where(Post.author_id == author_user.id)
    if hashtag:
        tag = hashtag.strip().removeprefix("#").lower()
        query = query.where(func.lower(Post.content).like(f"%#{tag}%"))
    if mode == "following":
        followed = select(Follow.following_id).where(Follow.follower_id == me.id)
        query = query.where(or_(Post.author_id == me.id, Post.author_id.in_(followed)))
    # A community publishes on its own page, with its own subscribe button; folding its posts
    # into a personal feed would make "подписаться на канал" and "читать человека" the same act.
    query = query.where(Post.community_id.is_(None))
    # A block hides both ways, and a closed account is only read by the people it let in.
    hidden_authors = await unreadable_author_ids(session, me)
    if hidden_authors:
        query = query.where(Post.author_id.notin_(hidden_authors))
    # A post hidden by staff leaves the feed for everyone except its author and staff: the author
    # has to be able to see what was hidden in order to understand the notice about it, and a
    # moderator has to be able to review the decision afterwards.
    if not me.is_admin:
        query = query.where(or_(Post.hidden_at.is_(None), Post.author_id == me.id))
    # A queued post is in no feed at all until its moment arrives, its author's own included: a
    # publication that has not happened has no place in a list of things to read. Its author finds
    # it in `/api/feed/scheduled`, opens it by its own link, and edits it there.
    query = query.where(or_(Post.publish_at.is_(None), Post.publish_at <= utcnow()))
    # One author's page opens with whatever they pinned; a mixed feed has no owner to pin it.
    # A post that was queued sorts by the moment it went out, which is the only date a reader
    # has any use for.
    fresh = func.coalesce(Post.publish_at, Post.created_at)
    order = (
        (Post.pinned_at.is_(None), fresh.desc())
        if author
        else (fresh.desc(),)
    )
    rows = (await session.execute(query.order_by(*order).limit(limit))).all()
    entries = [(post, post_author, None, None) for post, post_author in rows]
    entries += await _reposted_entries(
        session,
        me,
        author_user=author_user,
        mode=mode,
        hashtag=hashtag,
        hidden_authors=hidden_authors,
        already=[post.id for post, *_ in entries],
        limit=limit,
    )
    # Newest first by whatever put it in the list — the post's own date, or the moment somebody
    # passed it on. An author's own pin still leads their page.
    entries.sort(
        key=lambda entry: (
            0 if author and entry[2] is None and entry[0].pinned_at is not None else 1,
            -_as_utc(entry[3] or entry[0].created_at).timestamp(),
        )
    )
    if not author:
        entries = entries[:limit]
    author_ids = [post_author.id for _, post_author, _, _ in entries]
    premium = await premium_user_ids(session, author_ids)
    hidden = await presence_hidden_ids(session, author_ids)
    emblems = await name_gift_map(session, author_ids)
    return [
        await render_post(
            session,
            post,
            post_author,
            me,
            premium=premium,
            presence_hidden=hidden,
            name_gifts=emblems,
            reposted_by=reposter,
            reposted_at=reposted_at,
        )
        for post, post_author, reposter, reposted_at in entries
    ]


async def _reposted_entries(  # noqa: PLR0913
    session: AsyncSession,
    me: User,
    *,
    author_user: User | None,
    mode: str,
    hashtag: str | None,
    hidden_authors: set[uuid.UUID],
    already: list[uuid.UUID],
    limit: int,
) -> list[tuple[Post, User, User | None, datetime | None]]:
    """
    Posts that belong in this list because somebody passed them on.

    A repost is how a reader shares someone else's words, so it has to appear somewhere: on the
    reposter's own page, and in the feed of the people who read them. Until now it only moved a
    counter, which made the button look broken. A hashtag search is deliberately left out: it
    answers "who wrote about this", not "who mentioned it".
    """
    if hashtag:
        return []
    if author_user is not None:
        whose = PostRepost.user_id == author_user.id
    elif mode == "following":
        followed = select(Follow.following_id).where(Follow.follower_id == me.id)
        whose = or_(PostRepost.user_id == me.id, PostRepost.user_id.in_(followed))
    else:
        # «Для вас» is a discovery feed: a repost by a stranger says nothing to this reader, so
        # only the posts themselves compete there.
        return []
    reposter = aliased(User)
    rows = (
        await session.execute(
            select(PostRepost, Post, User, reposter)
            .join(Post, PostRepost.post_id == Post.id)
            .join(User, Post.author_id == User.id)
            .join(reposter, PostRepost.user_id == reposter.id)
            .where(Post.community_id.is_(None), whose)
            .order_by(PostRepost.created_at.desc())
            .limit(limit)
        )
    ).all()
    seen = set(already)
    found: list[tuple[Post, User, User | None, datetime | None]] = []
    for repost, post, post_author, reposter_user in rows:
        # Not twice in one list, and never across a block or into a closed account.
        if post.id in seen or post.author_id in hidden_authors:
            continue
        seen.add(post.id)
        found.append((post, post_author, reposter_user, repost.created_at))
    return found


def _is_scheduled(post: Post) -> bool:
    """Whether this post is still waiting for its moment, and so belongs to its author alone."""
    return post.publish_at is not None and _as_utc(post.publish_at) > utcnow()


async def _resolve_publish_at(
    session: AsyncSession, me: User, moment: datetime | None
) -> datetime | None:
    """
    What a requested publication time really means.

    A moment in the past — or none at all — means now, and `None` in the column is what "published"
    looks like everywhere else. A moment in the future is the premium feature, so it is refused with
    the price rather than silently ignored, and it cannot be further out than a year: a queue nobody
    will live to see is a way to lose a draft, not to plan one.
    """
    if moment is None:
        return None
    when = _as_utc(moment)
    if when <= utcnow():
        return None
    if when > utcnow() + timedelta(days=SCHEDULE_HORIZON_DAYS):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Отложить публикацию можно не дальше чем на {SCHEDULE_HORIZON_DAYS} дней",
        )
    await _require_premium(
        session,
        me,
        "Отложенная публикация — возможность GRAM Premium",
        staff_pass=True,
    )
    return when


async def _check_post_size(
    session: AsyncSession, me: User, content: str, images: list[str] | None
) -> None:
    """
    The two limits Premium raises on a publication, checked where the publication is made.

    The schema accepts the premium maximum, because a Pydantic model cannot look up a
    subscription; this is the free ceiling, refused by name so the author reads what to do rather
    than "422".
    """
    if await has_premium(session, me.id):
        return
    if len(content) > FREE_POST_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail=(
                f"Пост длиннее {FREE_POST_LENGTH} символов — возможность Premium "
                f"(с ним до {PREMIUM_POST_LENGTH})"
            ),
        )
    if len([url for url in (images or []) if url]) > FREE_POST_IMAGES:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail=(
                f"Больше {FREE_POST_IMAGES} фото в одной публикации — возможность Premium "
                f"(с ним до {PREMIUM_POST_IMAGES})"
            ),
        )


@app.post("/api/feed", response_model=FeedPost, status_code=status.HTTP_201_CREATED, tags=["feed"])
async def create_post(payload: PostCreate, session: SessionDep, me: CurrentUser) -> FeedPost:
    await _check_post_size(session, me, payload.content, payload.image_urls)
    publish_at = await _resolve_publish_at(session, me, payload.publish_at)
    gallery = [url for url in (payload.image_urls or []) if url][:PREMIUM_POST_IMAGES]
    post = Post(
        author_id=me.id,
        content=payload.content,
        # `image_url` is the first picture, which is what older readers of this row expect.
        image_url=gallery[0] if gallery else payload.image_url,
        image_urls=gallery or ([payload.image_url] if payload.image_url else None),
        video_url=payload.video_url,
        poll_options=_poll_options(payload),
        file_url=payload.file_url,
        file_name=payload.file_name,
        file_size=payload.file_size,
        sensitive=payload.sensitive,
        link_url=payload.link_url,
        link_title=(payload.link_title or None),
        music=await resolve_post_music(payload.content),
        publish_at=publish_at,
    )
    session.add(post)
    await session.flush()
    if not _is_scheduled(post):
        await enqueue_wire_social_event(
            session, "post_created", post.id, author_id=me.id, actor_id=me.id
        )
    await session.commit()
    await session.refresh(post)
    rendered = await render_post(session, post, me, me)
    if not _is_scheduled(post):
        await broadcast_social("post_created", post.id, actor_id=me.id)
    return rendered


async def resolve_post_music(content: str) -> dict[str, Any] | None:
    """
    A SoundCloud link in the text becomes a card.

    The lookup happens in a worker thread: one slow oEmbed response must not hold the event
    loop, and a failed one must not stop the post from being published.
    """
    link = music.find_link(content)
    if not link:
        return None
    return await run_in_threadpool(music.resolve, link)


@app.post(
    "/api/feed/media",
    response_model=UploadedMedia,
    status_code=status.HTTP_201_CREATED,
    tags=["feed"],
)
async def upload_post_media(
    session: SessionDep, me: CurrentUser, file: Annotated[UploadFile, File()]
) -> UploadedMedia:
    """
    Store one picture for a post being written.

    Uploading and publishing are separate steps so the composer can show a real preview and
    let the author drop a picture again before sending anything.
    """
    del session
    return UploadedMedia(url=await _store_image(file, "posts", me.id))


@app.post(
    "/api/feed/video",
    response_model=UploadedMedia,
    status_code=status.HTTP_201_CREATED,
    tags=["feed"],
)
async def upload_post_video(
    session: SessionDep, me: CurrentUser, file: Annotated[UploadFile, File()]
) -> UploadedMedia:
    """One clip for a post being written, stored as it arrived and served back the same way."""
    return UploadedMedia(
        url=await _store_video(
            file, "posts", me.id, await upload_ceiling(session, me, MAX_VIDEO_BYTES)
        )
    )


def _poll_options(payload: PostCreate) -> list[str] | None:
    """Trim the answers and refuse a poll that is really one answer twice."""
    if not payload.poll_options:
        return None
    options = [option.strip() for option in payload.poll_options if option.strip()]
    if len(options) < MIN_POLL_OPTIONS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="В опросе нужно минимум два варианта",
        )
    if len({option.lower() for option in options}) != len(options):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Варианты опроса не должны повторяться",
        )
    return options


@app.post("/api/feed/{post_id}/poll/{option_index}", response_model=FeedPost, tags=["feed"])
async def vote_in_poll(
    post_id: uuid.UUID, option_index: int, session: SessionDep, me: CurrentUser
) -> FeedPost:
    """
    Answer a poll, once.

    A vote is not changeable: the reference's poll is a snapshot, and results that move as
    people reconsider are a different thing. The second attempt is refused by name rather than
    silently ignored, so the client can say why nothing happened.
    """
    row = (
        await session.execute(
            select(Post, User).join(User, Post.author_id == User.id).where(Post.id == post_id)
        )
    ).first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Публикация не найдена")
    post, author = row
    if not post.poll_options:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="У публикации нет опроса"
        )
    if not 0 <= option_index < len(post.poll_options):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Такого варианта нет")
    await require_content_access(session, author, me)
    await refuse_if_blocked_with(session, author.id, me)
    existing = await session.scalar(
        select(PostPollVote).where(
            PostPollVote.post_id == post.id, PostPollVote.user_id == me.id
        )
    )
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Вы уже ответили на этот опрос"
        )
    session.add(PostPollVote(post_id=post.id, user_id=me.id, option_index=option_index))
    await session.commit()
    return await render_post(session, post, author, me)


@app.post(
    "/api/feed/file",
    response_model=UploadedFile,
    status_code=status.HTTP_201_CREATED,
    tags=["feed"],
)
async def upload_post_file(
    session: SessionDep, me: CurrentUser, file: Annotated[UploadFile, File()]
) -> UploadedFile:
    """One document for a post being written."""
    url, name, size, kind = await _store_document(
        file, "files", me.id, await upload_ceiling(session, me, MAX_FILE_BYTES)
    )
    return UploadedFile(url=url, name=name, size=size, kind=kind)


@app.get("/api/feed/files/{stored_name}", tags=["feed"])
async def download_post_file(stored_name: str) -> FileResponse:
    """
    Hand a stored document back, always as a download.

    Never inline: a browser that decides for itself what to do with a file is how an upload
    becomes a page on our own origin. The name comes from the path, and the path is one we
    generated — `..` and separators cannot appear in it, and are refused anyway.
    """
    if "/" in stored_name or "\\" in stored_name or stored_name.startswith("."):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Файл не найден")
    target = (MEDIA_ROOT / "files" / stored_name).resolve()
    root = (MEDIA_ROOT / "files").resolve()
    if root not in target.parents or not target.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Файл не найден")
    return FileResponse(
        target,
        media_type="application/octet-stream",
        filename=stored_name,
        headers={"X-Content-Type-Options": "nosniff"},
    )


@app.post("/api/feed/{post_id}/view", response_model=PostViewReceipt, tags=["feed"])
async def record_post_view(
    post_id: uuid.UUID, session: SessionDep, me: CurrentUser
) -> PostViewReceipt:
    """
    Count a read of this post.

    Called when the post is actually on screen, so the number means something. Repeat reads
    raise the total; the unique count is the number of people, which is why both are returned.
    """
    post = await session.get(Post, post_id)
    if post is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Публикация не найдена")
    await refuse_if_blocked_with(session, post.author_id, me)
    seen = await session.scalar(
        select(PostView).where(PostView.post_id == post_id, PostView.user_id == me.id)
    )
    recorded = seen is None
    if recorded:
        session.add(PostView(post_id=post_id, user_id=me.id))
    post.views_total = (post.views_total or 0) + 1
    await session.commit()
    unique_views = int(
        await session.scalar(
            select(func.count()).select_from(PostView).where(PostView.post_id == post_id)
        )
        or 0
    )
    return PostViewReceipt(
        recorded=recorded,
        views_count=max(post.views_total or 0, unique_views),
        unique_views_count=unique_views,
    )


@app.delete("/api/feed/{post_id}", response_model=DetailResponse, tags=["feed"])
async def delete_post(post_id: uuid.UUID, session: SessionDep, me: CurrentUser) -> DetailResponse:
    post = await session.get(Post, post_id)
    if post is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Публикация не найдена")
    if post.author_id != me.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Нельзя удалить чужую публикацию"
        )
    await enqueue_wire_social_event(
        session, "post_deleted", post_id, author_id=post.author_id, actor_id=me.id
    )
    await session.delete(post)
    await session.commit()
    await broadcast_social("post_deleted", post_id, actor_id=me.id)
    return DetailResponse(detail="deleted")


async def _own_post(session: AsyncSession, post_id: uuid.UUID, me: User) -> Post:
    """The post, if it is this account's to change."""
    post = await session.get(Post, post_id)
    if post is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Публикация не найдена")
    if post.author_id != me.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Нельзя изменить чужую публикацию"
        )
    return post


@app.patch("/api/feed/{post_id}", response_model=FeedPost, tags=["feed"])
async def edit_post(
    post_id: uuid.UUID, payload: PostEdit, session: SessionDep, me: CurrentUser
) -> FeedPost:
    """
    Rewrite one's own post.

    The music card is resolved again from the new text: removing a link removes the card, and
    pasting another one replaces it. `edited_at` is what the card shows as «ред.».

    Rewriting something still waiting for its moment is not an edit anybody has to be told about,
    so «ред.» is only stamped on a post that has readers. Moving the moment itself is a different
    request — `PATCH /api/feed/{id}/schedule`.
    """
    post = await _own_post(session, post_id, me)
    await _check_post_size(session, me, payload.content, post.image_urls)
    post.content = payload.content
    if payload.sensitive is not None:
        post.sensitive = payload.sensitive
    post.link_url = payload.link_url
    post.link_title = payload.link_title or None
    post.music = await resolve_post_music(payload.content)
    if not _is_scheduled(post):
        post.edited_at = utcnow()
        await enqueue_wire_social_event(
            session, "post_updated", post.id, author_id=me.id, actor_id=me.id
        )
    await session.commit()
    await session.refresh(post)
    rendered = await render_post(session, post, me, me)
    if not _is_scheduled(post):
        await broadcast_social("post_updated", post.id, actor_id=me.id)
    return rendered


@app.patch("/api/feed/{post_id}/schedule", response_model=FeedPost, tags=["feed"])
async def reschedule_post(
    post_id: uuid.UUID, payload: PostSchedule, session: SessionDep, me: CurrentUser
) -> FeedPost:
    """
    Move one's own queued post, or publish it now by sending no moment at all.

    A post that has already gone out cannot be pulled back: readers may have seen it, and a
    disappearing publication is a different feature with different consequences.
    """
    post = await _own_post(session, post_id, me)
    if post.publish_at is not None and not _is_scheduled(post):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Эта публикация уже вышла — время изменить нельзя",
        )
    post.publish_at = await _resolve_publish_at(session, me, payload.publish_at)
    await session.commit()
    await session.refresh(post)
    return await render_post(session, post, me, me)


@app.post("/api/feed/{post_id}/pin", response_model=FeedPost, tags=["feed"])
async def pin_post(post_id: uuid.UUID, session: SessionDep, me: CurrentUser) -> FeedPost:
    """Keep this post at the top of one's profile, in place of whatever was pinned before."""
    post = await _own_post(session, post_id, me)
    where = (
        Post.community_id == post.community_id
        if post.community_id is not None
        else and_(Post.author_id == me.id, Post.community_id.is_(None))
    )
    await session.execute(update(Post).where(where, Post.id != post.id).values(pinned_at=None))
    post.pinned_at = utcnow()
    await session.commit()
    await session.refresh(post)
    return await render_post(session, post, me, me)


@app.delete("/api/feed/{post_id}/pin", response_model=FeedPost, tags=["feed"])
async def unpin_post(post_id: uuid.UUID, session: SessionDep, me: CurrentUser) -> FeedPost:
    post = await _own_post(session, post_id, me)
    post.pinned_at = None
    await session.commit()
    await session.refresh(post)
    return await render_post(session, post, me, me)


@app.post("/api/feed/{post_id}/mute", response_model=DetailResponse, tags=["feed"])
async def mute_post(post_id: uuid.UUID, session: SessionDep, me: CurrentUser) -> DetailResponse:
    """Stop being notified about this post — likes, comments and replies alike."""
    if await session.get(Post, post_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Публикация не найдена")
    existing = await session.scalar(
        select(PostMute).where(PostMute.post_id == post_id, PostMute.user_id == me.id)
    )
    if existing is None:
        session.add(PostMute(post_id=post_id, user_id=me.id))
        await session.commit()
    return DetailResponse(detail="Уведомления отключены")


@app.delete("/api/feed/{post_id}/mute", response_model=DetailResponse, tags=["feed"])
async def unmute_post(post_id: uuid.UUID, session: SessionDep, me: CurrentUser) -> DetailResponse:
    existing = await session.scalar(
        select(PostMute).where(PostMute.post_id == post_id, PostMute.user_id == me.id)
    )
    if existing is not None:
        await session.delete(existing)
        await session.commit()
    return DetailResponse(detail="Уведомления включены")


async def file_report(
    session: AsyncSession,
    me: User,
    kind: str,
    target_id: str,
    payload: PostReportCreate,
) -> DetailResponse:
    """
    Store a complaint, whatever it is about.

    Stored, not swallowed: a second complaint from the same person replaces their reason
    rather than adding a row, so a count means "how many people", not "how many clicks".

    Whose content it was and what it said are captured here, at the only moment both are
    reliably available: by the time a moderator opens the queue the post may be edited, the
    comment deleted and the account renamed.
    """
    subject_id, excerpt = await _report_subject(session, kind, target_id)
    existing = await session.scalar(
        select(ContentReport).where(
            ContentReport.target_kind == kind,
            ContentReport.target_id == target_id,
            ContentReport.reporter_id == me.id,
        )
    )
    if existing is None:
        session.add(
            ContentReport(
                target_kind=kind,
                target_id=target_id,
                reporter_id=me.id,
                reason=payload.reason,
                comment=payload.comment,
                subject_id=subject_id,
                excerpt=excerpt,
                status="open",
            )
        )
    else:
        existing.reason = payload.reason
        existing.comment = payload.comment
        existing.subject_id = existing.subject_id or subject_id
        existing.excerpt = existing.excerpt or excerpt
        # A fresh complaint reopens a case somebody had already closed.
        existing.status = "open"
        existing.resolution = None
        existing.resolved_at = None
        existing.resolved_by_id = None
    await session.commit()
    return DetailResponse(detail="Жалоба отправлена")


async def _report_subject(  # noqa: PLR0911
    session: AsyncSession, kind: str, target_id: str
) -> tuple[uuid.UUID | None, str | None]:
    """Who is answerable for the reported thing, and a snapshot of what it said."""
    def as_uuid(value: str) -> uuid.UUID | None:
        try:
            return uuid.UUID(value)
        except (ValueError, AttributeError):
            return None

    if kind == "user":
        user = await resolve_user(session, target_id)
        return (user.id if user else None), (f"@{user.username}" if user else None)
    if kind == "post" and (post_id := as_uuid(target_id)):
        post = await session.get(Post, post_id)
        return (post.author_id if post else None), (post.content[:500] if post else None)
    if kind == "comment" and (comment_id := as_uuid(target_id)):
        comment = await session.get(PostComment, comment_id)
        return (comment.author_id if comment else None), (comment.content[:500] if comment else None)
    if kind == "message" and (message_id := as_uuid(target_id)):
        message = await session.get(Message, message_id)
        return (message.sender_id if message else None), (message.content[:500] if message else None)
    if kind == "community":
        community = await session.scalar(select(Community).where(Community.slug == target_id))
        return (community.owner_id if community else None), (community.title if community else None)
    return None, None


@app.post(
    "/api/feed/{post_id}/report",
    response_model=DetailResponse,
    status_code=status.HTTP_201_CREATED,
    tags=["feed"],
)
async def report_post(
    post_id: uuid.UUID, payload: PostReportCreate, session: SessionDep, me: CurrentUser
) -> DetailResponse:
    """
    File a complaint about a post.

    Stored, not swallowed: a second complaint from the same person replaces their reason
    rather than adding a row, so the count means "how many people", not "how many clicks".
    """
    post = await session.get(Post, post_id)
    if post is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Публикация не найдена")
    if post.author_id == me.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Нельзя пожаловаться на свою публикацию",
        )
    return await file_report(session, me, "post", str(post_id), payload)


@app.post(
    "/api/users/{username}/report",
    response_model=DetailResponse,
    status_code=status.HTTP_201_CREATED,
    tags=["social graph"],
)
async def report_user(
    username: str, payload: UserReportCreate, session: SessionDep, me: CurrentUser
) -> DetailResponse:
    """A complaint about an account: stored once per person, its reason replaceable."""
    subject = await resolve_user(session, username)
    if subject is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Аккаунт не найден")
    if subject.id == me.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Нельзя пожаловаться на себя"
        )
    return await file_report(session, me, "user", str(subject.id), payload)


async def post_notification_allowed(
    session: AsyncSession, post_id: uuid.UUID, user_id: uuid.UUID
) -> bool:
    """False when this person has muted this post, wherever the notification comes from."""
    return not await session.scalar(
        select(func.count())
        .select_from(PostMute)
        .where(PostMute.post_id == post_id, PostMute.user_id == user_id)
    )


@app.post("/api/feed/{post_id}/like", response_model=FeedPost, tags=["feed"])
async def toggle_post_like(post_id: uuid.UUID, session: SessionDep, me: CurrentUser) -> FeedPost:
    row = (
        await session.execute(
            select(Post, User).join(User, Post.author_id == User.id).where(Post.id == post_id)
        )
    ).first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Публикация не найдена")
    post, author = row
    await refuse_if_blocked_with(session, author.id, me)
    like = await session.scalar(
        select(PostLike).where(PostLike.post_id == post.id, PostLike.user_id == me.id)
    )
    if like:
        await session.delete(like)
    else:
        session.add(PostLike(post_id=post.id, user_id=me.id))
        if author.id != me.id and await post_notification_allowed(session, post.id, author.id):
            session.add(
                Notification(
                    user_id=author.id,
                    actor_id=me.id,
                    kind=NotificationKind.LIKE,
                    text=f"{me.display_name} оценил(а) вашу публикацию",
                    entity_id=str(post.id),
                )
            )
    await enqueue_wire_social_event(
        session, "post_reacted", post.id, author_id=author.id, actor_id=me.id
    )
    await session.commit()
    rendered = await render_post(session, post, author, me)
    # Counters on other readers' screens move on their own; the actor already holds this response.
    await broadcast_social("post_reacted", post.id, actor_id=me.id)
    return rendered


@app.get("/api/feed/scheduled", response_model=list[FeedPost], tags=["feed"])
async def read_scheduled_posts(session: SessionDep, me: CurrentUser) -> list[FeedPost]:
    """
    One's own queue: everything written and not yet published, soonest first.

    Registered before `/api/feed/{post_id}`, or the word would be read as an id — the same reason
    `/api/feed/bookmarks` sits where it does.
    """
    rows = (
        await session.execute(
            select(Post, User)
            .join(User, Post.author_id == User.id)
            .where(
                Post.author_id == me.id,
                Post.publish_at.is_not(None),
                Post.publish_at > utcnow(),
            )
            .order_by(Post.publish_at)
        )
    ).all()
    return [await render_post(session, post, author, me) for post, author in rows]


@app.get("/api/feed/{post_id}", response_model=FeedPost, tags=["feed"])
async def read_post(post_id: uuid.UUID, session: SessionDep, me: CurrentUser) -> FeedPost:
    """
    One post by id, so a permalink does not depend on it being in the first page of the feed.

    Registered after the literal `/api/feed/bookmarks`, or that word would be parsed as an id.
    """
    row = (
        await session.execute(
            select(Post, User).join(User, Post.author_id == User.id).where(Post.id == post_id)
        )
    ).first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Публикация не найдена")
    post, author = row
    # A queued post has no readers yet, and a link to one is a link to nothing — the same answer
    # as for a post that does not exist, because to everybody but its author it does not.
    if _is_scheduled(post) and post.author_id != me.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Публикация не найдена")
    await require_content_access(session, author, me)
    return await render_post(session, post, author, me)


async def render_comments(
    session: AsyncSession,
    post: Post,
    rows: list[tuple[PostComment, User]],
    me: User,
) -> list[PostCommentOut]:
    """
    Comments with their likes, reply counts and what the viewer may do to each.

    Every extra fact is one batched query rather than one per row: a thread of fifty comments
    would otherwise be fifty of everything.
    """
    ids = [comment.id for comment, _ in rows]
    likes: dict[uuid.UUID, int] = {}
    mine: set[uuid.UUID] = set()
    replies: dict[uuid.UUID, int] = {}
    if ids:
        for comment_id, count in (
            await session.execute(
                select(PostCommentLike.comment_id, func.count())
                .where(PostCommentLike.comment_id.in_(ids))
                .group_by(PostCommentLike.comment_id)
            )
        ).all():
            likes[comment_id] = int(count)
        mine = set(
            (
                await session.scalars(
                    select(PostCommentLike.comment_id).where(
                        PostCommentLike.comment_id.in_(ids), PostCommentLike.user_id == me.id
                    )
                )
            ).all()
        )
        for parent_id, count in (
            await session.execute(
                select(PostComment.parent_id, func.count())
                .where(PostComment.parent_id.in_(ids))
                .group_by(PostComment.parent_id)
            )
        ).all():
            if parent_id is not None:
                replies[parent_id] = int(count)
    hidden = await presence_hidden_ids(session, [author.id for _, author in rows])
    premium = await premium_user_ids(session, [author.id for _, author in rows])
    emblems = await name_gift_map(session, [author.id for _, author in rows])
    return [
        PostCommentOut(
            id=comment.id,
            post_id=comment.post_id,
            author=compact_user(
                author,
                is_premium=author.id in premium,
                hide_presence=author.id in hidden,
                name_gift=emblems.get(author.id),
            ),
            content=comment.content,
            created_at=comment.created_at,
            edited_at=comment.edited_at,
            parent_id=comment.parent_id,
            replies_count=replies.get(comment.id, 0),
            likes_count=likes.get(comment.id, 0),
            liked_by_me=comment.id in mine,
            can_edit=comment.author_id == me.id,
            # A post author moderates their own thread; everyone else only their own words.
            can_delete=me.id in (comment.author_id, post.author_id),
        )
        for comment, author in rows
    ]


@app.get("/api/feed/{post_id}/comments", response_model=list[PostCommentOut], tags=["feed"])
async def read_comments(
    post_id: uuid.UUID,
    session: SessionDep,
    me: CurrentUser,
    sort: Annotated[str, Query(pattern="^(new|old|top)$")] = "new",
) -> list[PostCommentOut]:
    """The reference offers three orders over one thread: «Новые», «Старые», «Популярные»."""
    post = await session.get(Post, post_id)
    if post is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Публикация не найдена")
    author = await session.get(User, post.author_id)
    if author is not None:
        await require_content_access(session, author, me)
    query = (
        select(PostComment, User)
        .join(User, PostComment.author_id == User.id)
        .where(PostComment.post_id == post_id)
        # A block hides the people, not the thread: their lines leave it for both of us.
        .where(PostComment.author_id.notin_(await blocked_pair_ids(session, me.id)))
    )
    # A comment removed by staff leaves the thread for everyone but its author and staff, for the
    # same reason a hidden post does: the author has to see what the notice is about.
    if not me.is_admin:
        query = query.where(
            or_(PostComment.hidden_at.is_(None), PostComment.author_id == me.id)
        )
    if sort == "top":
        weights = (
            select(PostCommentLike.comment_id, func.count().label("weight"))
            .group_by(PostCommentLike.comment_id)
            .subquery()
        )
        query = query.outerjoin(weights, weights.c.comment_id == PostComment.id).order_by(
            func.coalesce(weights.c.weight, 0).desc(), PostComment.created_at.desc()
        )
    elif sort == "old":
        query = query.order_by(PostComment.created_at)
    else:
        query = query.order_by(PostComment.created_at.desc())
    rows = list((await session.execute(query)).all())
    return await render_comments(session, post, rows, me)


async def _comment_for_action(
    session: AsyncSession, post_id: uuid.UUID, comment_id: uuid.UUID
) -> tuple[Post, PostComment]:
    """Fetch a post and one of its comments, or fail with the right status."""
    post = await session.get(Post, post_id)
    comment = await session.get(PostComment, comment_id)
    if post is None or comment is None or comment.post_id != post_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Комментарий не найден")
    return post, comment


@app.patch(
    "/api/feed/{post_id}/comments/{comment_id}", response_model=PostCommentOut, tags=["feed"]
)
async def edit_comment(
    post_id: uuid.UUID,
    comment_id: uuid.UUID,
    payload: PostCommentEdit,
    session: SessionDep,
    me: CurrentUser,
) -> PostCommentOut:
    """Only the author rewrites their own comment, and the change is stamped as an edit."""
    post, comment = await _comment_for_action(session, post_id, comment_id)
    if comment.author_id != me.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Изменить может только автор"
        )
    comment.content = payload.content
    comment.edited_at = utcnow()
    await enqueue_wire_social_event(
        session,
        "comment_updated",
        post.id,
        author_id=post.author_id if post.community_id is None else None,
        comment_id=comment.id,
        actor_id=me.id,
    )
    await session.commit()
    await session.refresh(comment)
    author = await session.get(User, comment.author_id)
    rendered = (await render_comments(session, post, [(comment, author or me)], me))[0]
    await broadcast_social(
        "comment_updated", post.id, comment_id=comment.id, actor_id=me.id
    )
    return rendered


@app.delete(
    "/api/feed/{post_id}/comments/{comment_id}", response_model=DetailResponse, tags=["feed"]
)
async def delete_comment(
    post_id: uuid.UUID, comment_id: uuid.UUID, session: SessionDep, me: CurrentUser
) -> DetailResponse:
    """The comment author, or the post author moderating their own thread."""
    post, comment = await _comment_for_action(session, post_id, comment_id)
    if me.id not in (comment.author_id, post.author_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Удалить может автор комментария или владелец записи",
        )
    # Replies are removed explicitly rather than left to the database: SQLite does not enforce
    # foreign keys unless asked to, and a thread whose root is gone must not linger anywhere.
    await enqueue_wire_social_event(
        session,
        "comment_deleted",
        post.id,
        author_id=post.author_id if post.community_id is None else None,
        comment_id=comment_id,
        actor_id=me.id,
    )
    await session.execute(delete(PostComment).where(PostComment.parent_id == comment.id))
    await session.delete(comment)
    await session.commit()
    await broadcast_social("comment_deleted", post.id, comment_id=comment_id, actor_id=me.id)
    return DetailResponse(detail="Комментарий удалён")


@app.post(
    "/api/feed/{post_id}/comments/{comment_id}/like", response_model=PostCommentOut, tags=["feed"]
)
async def toggle_comment_like(
    post_id: uuid.UUID, comment_id: uuid.UUID, session: SessionDep, me: CurrentUser
) -> PostCommentOut:
    """Same emoji-free like the reference puts on a comment: on, off, counted by rows."""
    post, comment = await _comment_for_action(session, post_id, comment_id)
    await refuse_if_blocked_with(session, comment.author_id, me)
    existing = await session.scalar(
        select(PostCommentLike).where(
            PostCommentLike.comment_id == comment_id, PostCommentLike.user_id == me.id
        )
    )
    if existing is None:
        session.add(PostCommentLike(comment_id=comment_id, user_id=me.id))
        if comment.author_id != me.id and await post_notification_allowed(
            session, post_id, comment.author_id
        ):
            session.add(
                Notification(
                    user_id=comment.author_id,
                    actor_id=me.id,
                    kind=NotificationKind.LIKE,
                    text=f"{me.display_name} оценил(а) ваш комментарий",
                    entity_id=str(post_id),
                )
            )
    else:
        await session.delete(existing)
    await enqueue_wire_social_event(
        session,
        "comment_reacted",
        post.id,
        author_id=post.author_id if post.community_id is None else None,
        comment_id=comment.id,
        actor_id=me.id,
    )
    await session.commit()
    author = await session.get(User, comment.author_id)
    rendered = (await render_comments(session, post, [(comment, author or me)], me))[0]
    await broadcast_social(
        "comment_reacted", post.id, comment_id=comment.id, actor_id=me.id
    )
    return rendered


@app.post(
    "/api/feed/{post_id}/comments",
    response_model=PostCommentOut,
    status_code=status.HTTP_201_CREATED,
    tags=["feed"],
)
async def create_comment(
    post_id: uuid.UUID, payload: PostCommentCreate, session: SessionDep, me: CurrentUser
) -> PostCommentOut:
    post = await session.get(Post, post_id)
    if post is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Публикация не найдена")
    # Someone who blocked me does not get answered by me, and I am not answered by them.
    await refuse_if_blocked_with(session, post.author_id, me)
    if payload.parent_id is not None:
        parent = await session.get(PostComment, payload.parent_id)
        if parent is None or parent.post_id != post.id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Комментарий для ответа не найден"
            )
    else:
        parent = None
    comment = PostComment(
        post_id=post.id,
        author_id=me.id,
        content=payload.content,
        parent_id=payload.parent_id,
    )
    session.add(comment)
    # The author of the post hears about a comment on it, and whoever is being answered hears
    # about the answer — unless they have muted the post, and never about their own writing.
    recipients: dict[uuid.UUID, str] = {}
    if post.author_id != me.id:
        recipients[post.author_id] = f"{me.display_name} прокомментировал(а) вашу публикацию"
    if parent is not None and parent.author_id != me.id:
        recipients[parent.author_id] = f"{me.display_name} ответил(а) на ваш комментарий"
    for user_id, text in recipients.items():
        if await post_notification_allowed(session, post.id, user_id):
            session.add(
                Notification(
                    user_id=user_id,
                    actor_id=me.id,
                    kind=NotificationKind.COMMENT,
                    text=text,
                    entity_id=str(post.id),
                )
            )
    await session.flush()
    await enqueue_wire_social_event(
        session,
        "comment_created",
        post.id,
        author_id=post.author_id if post.community_id is None else None,
        comment_id=comment.id,
        actor_id=me.id,
    )
    await session.commit()
    await session.refresh(comment)
    rendered = (await render_comments(session, post, [(comment, me)], me))[0]
    # Everyone reading this thread hears about the new line without reloading the page.
    await broadcast_social(
        "comment_created", post.id, comment_id=comment.id, actor_id=me.id
    )
    return rendered


async def _toggle_post_relation(
    session: AsyncSession,
    model: type[PostBookmark | PostRepost],
    post_id: uuid.UUID,
    me: User,
) -> ToggleState:
    post = await session.get(Post, post_id)
    if post is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Публикация не найдена")
    # Saving or republishing someone's words across a block is not a thing either side wants.
    await refuse_if_blocked_with(session, post.author_id, me)
    user_id = me.id
    relation = await session.scalar(
        select(model).where(model.post_id == post_id, model.user_id == user_id)
    )
    active = relation is None
    if relation:
        await session.delete(relation)
    else:
        session.add(model(post_id=post_id, user_id=user_id))
    await session.commit()
    count = int(
        await session.scalar(
            select(func.count()).select_from(model).where(model.post_id == post_id)
        )
        or 0
    )
    return ToggleState(active=active, count=count)


@app.post("/api/feed/{post_id}/bookmark", response_model=ToggleState, tags=["feed"])
async def toggle_bookmark(post_id: uuid.UUID, session: SessionDep, me: CurrentUser) -> ToggleState:
    return await _toggle_post_relation(session, PostBookmark, post_id, me)


@app.post("/api/feed/{post_id}/repost", response_model=ToggleState, tags=["feed"])
async def toggle_repost(post_id: uuid.UUID, session: SessionDep, me: CurrentUser) -> ToggleState:
    return await _toggle_post_relation(session, PostRepost, post_id, me)


@app.post(
    "/api/chats/{chat_id}/report",
    response_model=DetailResponse,
    status_code=status.HTTP_201_CREATED,
    tags=["chats"],
)
async def report_chat(
    chat_id: uuid.UUID, payload: PostReportCreate, session: SessionDep, me: CurrentUser
) -> DetailResponse:
    """A complaint about a conversation — only one this account is actually in."""
    await require_chat_member(session, chat_id, me.id)
    return await file_report(session, me, "chat", str(chat_id), payload)


@app.post(
    "/api/chats/{chat_id}/messages/{message_id}/report",
    response_model=DetailResponse,
    status_code=status.HTTP_201_CREATED,
    tags=["chats"],
)
async def report_message(
    chat_id: uuid.UUID,
    message_id: uuid.UUID,
    payload: PostReportCreate,
    session: SessionDep,
    me: CurrentUser,
) -> DetailResponse:
    """A complaint about one message. One's own words are not a complaint."""
    await require_chat_member(session, chat_id, me.id)
    message = await session.get(Message, message_id)
    if message is None or message.chat_id != chat_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Сообщение не найдено")
    if message.sender_id == me.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Нельзя пожаловаться на своё сообщение",
        )
    return await file_report(session, me, "message", str(message_id), payload)


@app.post(
    "/api/communities/{slug}/report",
    response_model=DetailResponse,
    status_code=status.HTTP_201_CREATED,
    tags=["communities"],
)
async def report_community(
    slug: str, payload: PostReportCreate, session: SessionDep, me: CurrentUser
) -> DetailResponse:
    """A complaint about a community, named by its slug because that is its address."""
    community = await session.scalar(select(Community).where(Community.slug == slug))
    if community is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Сообщество не найдено")
    if community.owner_id == me.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Нельзя пожаловаться на своё сообщество",
        )
    return await file_report(session, me, "community", slug, payload)


async def render_chat_summary(session: AsyncSession, chat: Chat, me: User) -> ChatSummary:
    members = (
        await session.scalars(
            select(User)
            .join(ChatMember, ChatMember.user_id == User.id)
            .where(ChatMember.chat_id == chat.id)
        )
    ).all()
    peer = next((member for member in members if member.id != me.id), None)
    peer_premium = await premium_user_ids(session, [peer.id] if peer else [])
    # Both directions in one query: a chat can be closed by either side, and the two states
    # read differently — one offers "разблокировать", the other explains why writing fails.
    peer_blocked = False
    blocked_by_peer = False
    if peer is not None and not chat.is_group:
        pairs = (
            await session.execute(
                select(UserBlock.blocker_id).where(
                    or_(
                        and_(UserBlock.blocker_id == me.id, UserBlock.blocked_id == peer.id),
                        and_(UserBlock.blocker_id == peer.id, UserBlock.blocked_id == me.id),
                    )
                )
            )
        ).scalars()
        for blocker_id in pairs:
            if blocker_id == me.id:
                peer_blocked = True
            else:
                blocked_by_peer = True
    mine = await session.scalar(
        select(ChatMember).where(ChatMember.chat_id == chat.id, ChatMember.user_id == me.id)
    )
    last_query = (
        select(Message, User)
        .join(User, Message.sender_id == User.id)
        .where(Message.chat_id == chat.id)
    )
    # A cleared chat shows only what arrived after the clearing, so the preview cannot quote
    # history the reader has already thrown away.
    if mine is not None and mine.cleared_at is not None:
        last_query = last_query.where(Message.created_at > mine.cleared_at)
    last_row = (
        await session.execute(last_query.order_by(Message.created_at.desc()).limit(1))
    ).first()
    last_detail = (
        message_out(
            last_row.Message,
            last_row.User,
            me.id,
            # Costs nothing unless the row really is a shared story: the helper returns at once
            # when there is no id to look up.
            story=await _shared_story(session, last_row.Message.story_id),
        )
        if last_row
        else None
    )
    # `is_group` wins over `kind`: rows that predate the column were all backfilled to
    # "direct", and a group must not be mislabelled because of that default.
    kind = "group" if chat.is_group else (chat.kind or "direct")
    # Only the saved-messages chat is «Избранное». A direct chat with nobody on the other side
    # is one whose peer deleted their account, and calling that "Избранное" hid real history
    # behind a name that means something else entirely.
    if chat.title:
        title = chat.title
    elif peer is not None:
        title = peer.display_name
    elif kind == "saved":
        title = "Избранное"
    else:
        title = "Удалённый аккаунт"
    return ChatSummary(
        id=chat.id,
        title=title,
        is_group=chat.is_group,
        kind=kind,
        avatar_url=chat.avatar_url,
        members_count=len(members),
        participant=compact_user(peer, is_premium=peer.id in peer_premium) if peer else None,
        peer=compact_user(peer, is_premium=peer.id in peer_premium) if peer else None,
        last_message=last_detail.content if last_detail else "",
        last_message_detail=last_detail,
        unread_count=await chat_unread_count(session, chat.id, me),
        updated_at=last_detail.created_at if last_detail else chat.created_at,
        pinned=mine is not None and mine.pinned_at is not None,
        archived=mine is not None and mine.archived_at is not None,
        marked_unread=bool(mine is not None and mine.marked_unread),
        muted=bool(mine is not None and mine.muted),
        autodelete_seconds=chat.autodelete_seconds or 0,
        peer_blocked=peer_blocked,
        blocked_by_peer=blocked_by_peer,
        is_public=bool(chat.is_public),
        # The code is the link, so only somebody already inside is handed it.
        invite_code=chat.invite_code if (mine is not None and chat.is_group) else None,
        # A private group is the owner's to invite into; a public one anybody in it can bring
        # people to, which is what its link means anyway.
        can_invite=bool(
            chat.is_group and mine is not None and (chat.is_public or chat.owner_id == me.id)
        ),
        is_owner=chat.owner_id == me.id,
    )


async def chat_unread_count(session: AsyncSession, chat_id: uuid.UUID, me: User) -> int:
    """Unread is "messages from others after my last read", shared by list, dock and folders."""
    member = await session.scalar(
        select(ChatMember).where(ChatMember.chat_id == chat_id, ChatMember.user_id == me.id)
    )
    if member is None:
        return 0
    query = (
        select(func.count())
        .select_from(Message)
        .where(Message.chat_id == chat_id, Message.sender_id != me.id)
    )
    if member.last_read_at is not None:
        query = query.where(Message.created_at > member.last_read_at)
    if member.cleared_at is not None:
        query = query.where(Message.created_at > member.cleared_at)
    counted = int(await session.scalar(query) or 0)
    # Marking a read chat unread has to show something, so it counts as one.
    return counted or (1 if member.marked_unread else 0)


async def folder_out(session: AsyncSession, folder: ChatFolder, me: User) -> ChatFolderOut:
    chat_ids = (
        await session.scalars(
            select(ChatFolderItem.chat_id).where(ChatFolderItem.folder_id == folder.id)
        )
    ).all()
    unread = 0
    for chat_id in chat_ids:
        unread += await chat_unread_count(session, chat_id, me)
    return ChatFolderOut(
        id=folder.id,
        title=folder.title,
        position=folder.position,
        chat_ids=list(chat_ids),
        chats_count=len(chat_ids),
        unread_count=unread,
    )


@app.get("/api/chats/folders", response_model=list[ChatFolderOut], tags=["chats"])
async def read_chat_folders(session: SessionDep, me: CurrentUser) -> list[ChatFolderOut]:
    folders = (
        await session.scalars(
            select(ChatFolder)
            .where(ChatFolder.user_id == me.id)
            .order_by(ChatFolder.position, ChatFolder.created_at)
        )
    ).all()
    return [await folder_out(session, folder, me) for folder in folders]


@app.post(
    "/api/chats/folders",
    response_model=ChatFolderOut,
    status_code=status.HTTP_201_CREATED,
    tags=["chats"],
)
async def create_chat_folder(
    payload: ChatFolderCreate, session: SessionDep, me: CurrentUser
) -> ChatFolderOut:
    existing = await session.scalar(
        select(func.count())
        .select_from(ChatFolder)
        .where(ChatFolder.user_id == me.id)
    )
    folder = ChatFolder(user_id=me.id, title=payload.title, position=int(existing or 0))
    session.add(folder)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Папка с таким названием уже есть"
        ) from exc
    await session.refresh(folder)
    return await folder_out(session, folder, me)


@app.delete("/api/chats/folders/{folder_id}", response_model=DetailResponse, tags=["chats"])
async def delete_chat_folder(
    folder_id: uuid.UUID, session: SessionDep, me: CurrentUser
) -> DetailResponse:
    folder = await session.get(ChatFolder, folder_id)
    if folder is None or folder.user_id != me.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Папка не найдена")
    await session.delete(folder)
    await session.commit()
    return DetailResponse(detail="folder_deleted")


@app.put(
    "/api/chats/folders/{folder_id}/chats/{chat_id}",
    response_model=ChatFolderOut,
    tags=["chats"],
)
async def add_chat_to_folder(
    folder_id: uuid.UUID, chat_id: uuid.UUID, session: SessionDep, me: CurrentUser
) -> ChatFolderOut:
    folder = await session.get(ChatFolder, folder_id)
    if folder is None or folder.user_id != me.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Папка не найдена")
    await require_chat_member(session, chat_id, me.id)
    exists = await session.scalar(
        select(ChatFolderItem).where(
            ChatFolderItem.folder_id == folder.id, ChatFolderItem.chat_id == chat_id
        )
    )
    if exists is None:
        session.add(ChatFolderItem(folder_id=folder.id, chat_id=chat_id))
        await session.commit()
    return await folder_out(session, folder, me)


@app.delete(
    "/api/chats/folders/{folder_id}/chats/{chat_id}",
    response_model=ChatFolderOut,
    tags=["chats"],
)
async def remove_chat_from_folder(
    folder_id: uuid.UUID, chat_id: uuid.UUID, session: SessionDep, me: CurrentUser
) -> ChatFolderOut:
    folder = await session.get(ChatFolder, folder_id)
    if folder is None or folder.user_id != me.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Папка не найдена")
    await session.execute(
        delete(ChatFolderItem).where(
            ChatFolderItem.folder_id == folder.id, ChatFolderItem.chat_id == chat_id
        )
    )
    await session.commit()
    return await folder_out(session, folder, me)


@app.get("/api/chats", response_model=list[ChatSummary], tags=["chats"])
async def read_chats(session: SessionDep, me: CurrentUser) -> list[ChatSummary]:
    rows = (
        await session.execute(
            select(Chat, ChatMember)
            .join(ChatMember, ChatMember.chat_id == Chat.id)
            .where(ChatMember.user_id == me.id)
        )
    ).all()
    rendered: list[ChatSummary] = []
    for chat, member in rows:
        summary = await render_chat_summary(session, chat, me)
        # A deleted chat stays gone until it has something new to say.
        if member.cleared_at is not None and summary.last_message_detail is None:
            continue
        rendered.append(summary)
    # Pinned conversations sit above the rest, then it is newest-first, as in the reference.
    return sorted(rendered, key=lambda item: (item.pinned, item.updated_at), reverse=True)


@app.patch("/api/chats/{chat_id}/state", response_model=ChatSummary, tags=["chats"])
async def update_chat_state(
    chat_id: uuid.UUID, payload: ChatStateUpdate, session: SessionDep, me: CurrentUser
) -> ChatSummary:
    """Pin, archive and mark-unread are mine alone; the other side's list does not move."""
    member = await require_chat_member(session, chat_id, me.id)
    now = utcnow()
    if payload.pinned is not None:
        member.pinned_at = now if payload.pinned else None
    if payload.archived is not None:
        member.archived_at = now if payload.archived else None
    if payload.marked_unread is not None:
        member.marked_unread = payload.marked_unread
        if payload.marked_unread:
            # Unread has to mean unread: keep the flag from being wiped by the last read stamp.
            member.last_read_at = None
    if payload.muted is not None:
        member.muted = payload.muted
    await session.commit()
    chat = await session.get(Chat, chat_id)
    if chat is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Чат не найден")
    return await render_chat_summary(session, chat, me)


AUTODELETE_LABELS = {0: "выключено", 86400: "1 день", 604800: "1 неделя", 2592000: "1 месяц"}


async def purge_expired_messages(session: AsyncSession, chat: Chat) -> None:
    """
    Drop whatever has outlived the chat's auto-delete window.

    Enforced on read and on write rather than by a background job: the two moments a stale
    message could still be seen are exactly the two moments this runs.
    """
    if not chat.autodelete_seconds:
        return
    cutoff = utcnow() - timedelta(seconds=chat.autodelete_seconds)
    await session.execute(
        delete(Message).where(
            Message.chat_id == chat.id,
            Message.created_at < cutoff,
            # A pin is a deliberate keep, and service notices are the record of what happened.
            Message.pinned_at.is_(None),
            Message.is_service.is_(False),
        )
    )
    await session.commit()


@app.patch("/api/chats/{chat_id}/autodelete", response_model=ChatSummary, tags=["chats"])
async def update_chat_autodelete(
    chat_id: uuid.UUID, payload: ChatAutodeleteUpdate, session: SessionDep, me: CurrentUser
) -> ChatSummary:
    """Auto-delete belongs to the conversation, so the change is announced to everyone in it."""
    await require_chat_member(session, chat_id, me.id)
    chat = await session.get(Chat, chat_id)
    if chat is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Чат не найден")
    if chat.autodelete_seconds != payload.seconds:
        chat.autodelete_seconds = payload.seconds
        label = AUTODELETE_LABELS[payload.seconds]
        session.add(
            Message(
                chat_id=chat.id,
                sender_id=me.id,
                content=(
                    f"{me.display_name} выключил(а) автоудаление"
                    if payload.seconds == 0
                    else f"{me.display_name} включил(а) автоудаление: {label}"
                ),
                is_service=True,
            )
        )
        await session.commit()
        await session.refresh(chat)
    await purge_expired_messages(session, chat)
    return await render_chat_summary(session, chat, me)


@app.delete("/api/chats/{chat_id}", response_model=DetailResponse, tags=["chats"])
async def delete_chat(
    chat_id: uuid.UUID, session: SessionDep, me: CurrentUser
) -> DetailResponse:
    """
    Deleting a conversation clears it for the caller only.

    The other participant keeps their history: a shared chat is not one person's to erase.
    """
    member = await require_chat_member(session, chat_id, me.id)
    member.cleared_at = utcnow()
    member.pinned_at = None
    member.marked_unread = False
    await session.commit()
    return DetailResponse(detail="chat_cleared")


@app.post("/api/chats/{chat_id}/read", response_model=DetailResponse, tags=["chats"])
async def mark_chat_read(
    chat_id: uuid.UUID, session: SessionDep, me: CurrentUser
) -> DetailResponse:
    """
    Say that this conversation has been read up to now.

    Opening the thread already does this, but a message that arrives *while* the thread is open
    arrives over the socket and never touches that endpoint — so it stayed unread for as long as
    the reader kept looking at it, and the badge in the list disagreed with what was on screen.

    Broadcasting the receipt is the other half: the sender's single tick becomes two the moment
    somebody reads, instead of on their next poll.
    """
    member = await require_chat_member(session, chat_id, me.id)
    now = utcnow()
    member.last_read_at = now
    member.marked_unread = False
    await enqueue_wire_chat_event(
        session,
        chat_id,
        "chat.read",
        {"user_id": str(me.id), "at": now.isoformat()},
        actor_id=me.id,
    )
    await session.commit()
    await chat_connections.broadcast(
        chat_id,
        {
            "type": "chat_read",
            "chat_id": str(chat_id),
            "user_id": str(me.id),
            "at": now.isoformat(),
        },
    )
    await announce_chat_activity(session, chat_id, actor_id=me.id)
    return DetailResponse(detail="chat_read")


@app.post("/api/chats/read-all", response_model=DetailResponse, tags=["chats"])
async def read_all_chats(session: SessionDep, me: CurrentUser) -> DetailResponse:
    members = (
        await session.scalars(select(ChatMember).where(ChatMember.user_id == me.id))
    ).all()
    now = utcnow()
    for member in members:
        member.last_read_at = now
        member.marked_unread = False
    await session.commit()
    return DetailResponse(detail="chats_read")


@app.post("/api/chats/direct/{username}", response_model=ChatSummary, tags=["chats"])
async def create_direct_chat(username: str, session: SessionDep, me: CurrentUser) -> ChatSummary:
    target = await resolve_user(session, username)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Пользователь не найден")
    if target.id == me.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Выберите другого пользователя"
        )
    if await _blocked_between(session, me.id, target.id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=BLOCKED_CHAT_DETAIL)
    # The setting gates opening a conversation, not the messages inside one that already
    # exists: a chat that stops working mid-thread would be a worse surprise than a refusal.
    await refuse_if_closed_inbox(session, target, me)
    candidate_ids = (
        select(ChatMember.chat_id)
        .where(ChatMember.user_id.in_([me.id, target.id]))
        .group_by(ChatMember.chat_id)
        .having(func.count(func.distinct(ChatMember.user_id)) == DIRECT_CHAT_MEMBER_COUNT)
    )
    chat = await session.scalar(
        select(Chat).where(
            Chat.id.in_(candidate_ids), Chat.is_group.is_(False), Chat.kind == "direct"
        )
    )
    if chat is None:
        chat = Chat(is_group=False, kind="direct")
        session.add(chat)
        await session.flush()
        session.add_all(
            [
                ChatMember(chat_id=chat.id, user_id=me.id),
                ChatMember(chat_id=chat.id, user_id=target.id),
            ]
        )
        await session.commit()
        await session.refresh(chat)
    else:
        await _revive_chat(session, chat.id, me.id)
    return await render_chat_summary(session, chat, me)


async def _revive_chat(session: AsyncSession, chat_id: uuid.UUID, user_id: uuid.UUID) -> None:
    """Reopening a conversation the caller had deleted brings it back into their list."""
    member = await session.scalar(
        select(ChatMember).where(ChatMember.chat_id == chat_id, ChatMember.user_id == user_id)
    )
    if member is not None and (member.cleared_at is not None or member.archived_at is not None):
        member.cleared_at = None
        member.archived_at = None
        await session.commit()


@app.post("/api/chats/secret/{username}", response_model=ChatSummary, tags=["chats"])
async def create_secret_chat(username: str, session: SessionDep, me: CurrentUser) -> ChatSummary:
    """
    A secret chat is its own conversation, never folded into the existing direct one.

    Only the marking is real here: messages are stored like any other, so the client says
    so plainly rather than promising encryption the server does not perform.
    """
    target = await resolve_user(session, username)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Пользователь не найден")
    if target.id == me.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Выберите другого пользователя"
        )
    if await _blocked_between(session, me.id, target.id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=BLOCKED_CHAT_DETAIL)
    # The setting gates opening a conversation, not the messages inside one that already
    # exists: a chat that stops working mid-thread would be a worse surprise than a refusal.
    await refuse_if_closed_inbox(session, target, me)
    candidate_ids = (
        select(ChatMember.chat_id)
        .where(ChatMember.user_id.in_([me.id, target.id]))
        .group_by(ChatMember.chat_id)
        .having(func.count(func.distinct(ChatMember.user_id)) == DIRECT_CHAT_MEMBER_COUNT)
    )
    chat = await session.scalar(select(Chat).where(Chat.id.in_(candidate_ids), Chat.kind == "secret"))
    if chat is None:
        chat = Chat(is_group=False, kind="secret", owner_id=me.id)
        session.add(chat)
        await session.flush()
        session.add_all(
            [
                ChatMember(chat_id=chat.id, user_id=me.id),
                ChatMember(chat_id=chat.id, user_id=target.id),
            ]
        )
        session.add(
            Message(
                chat_id=chat.id,
                sender_id=me.id,
                content=f"{me.display_name} создал(а) секретный чат",
                is_service=True,
            )
        )
        await session.commit()
        await session.refresh(chat)
    else:
        await _revive_chat(session, chat.id, me.id)
    return await render_chat_summary(session, chat, me)


@app.post("/api/chats/saved", response_model=ChatSummary, tags=["chats"])
async def open_saved_chat(session: SessionDep, me: CurrentUser) -> ChatSummary:
    """Избранное is a chat with oneself, so saving a note needs no second participant."""
    chat = await session.scalar(
        select(Chat)
        .join(ChatMember, ChatMember.chat_id == Chat.id)
        .where(ChatMember.user_id == me.id, Chat.kind == "saved")
    )
    if chat is None:
        chat = Chat(is_group=False, kind="saved", title="Избранное", owner_id=me.id)
        session.add(chat)
        await session.flush()
        session.add(ChatMember(chat_id=chat.id, user_id=me.id))
        await session.commit()
        await session.refresh(chat)
    else:
        await _revive_chat(session, chat.id, me.id)
    return await render_chat_summary(session, chat, me)


@app.post(
    "/api/chats/groups",
    response_model=ChatSummary,
    status_code=status.HTTP_201_CREATED,
    tags=["chats"],
)
async def create_group_chat(
    payload: GroupCreate, session: SessionDep, me: CurrentUser
) -> ChatSummary:
    members = await _resolve_members(session, payload.members, exclude={me.id})
    if not members:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Добавьте хотя бы одного участника"
        )
    chat = Chat(
        is_group=True,
        kind="group",
        title=payload.title,
        avatar_url=payload.avatar_url,
        owner_id=me.id,
        is_public=payload.is_public,
        # A public group is only public because of its link, so it is minted with one.
        invite_code=_new_invite_code() if payload.is_public else None,
    )
    session.add(chat)
    await session.flush()
    session.add_all(
        [ChatMember(chat_id=chat.id, user_id=user.id) for user in [me, *members]]
    )
    session.add(
        Message(
            chat_id=chat.id,
            sender_id=me.id,
            content=(
                f"Группа «{payload.title}» создана"
                if not payload.is_public
                else f"Публичная группа «{payload.title}» создана — вход по ссылке"
            ),
            is_service=True,
        )
    )
    await session.commit()
    await session.refresh(chat)
    return await render_chat_summary(session, chat, me)


def _new_invite_code() -> str:
    """
    A link token that cannot be guessed from the group's name or its id.

    22 characters of url-safe randomness: short enough to paste into a chat, long enough that
    walking the space is not a way in.
    """
    return secrets.token_urlsafe(16)[:22]


async def _group_for_owner(session: AsyncSession, chat_id: uuid.UUID, me: User) -> Chat:
    """A group the caller owns, or the right refusal."""
    await require_chat_member(session, chat_id, me.id)
    chat = await session.get(Chat, chat_id)
    if chat is None or not chat.is_group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Группа не найдена")
    if chat.owner_id != me.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Настройки группы меняет её владелец",
        )
    return chat


@app.patch("/api/chats/{chat_id}/access", response_model=ChatSummary, tags=["chats"])
async def update_group_access(
    chat_id: uuid.UUID, payload: GroupAccessUpdate, session: SessionDep, me: CurrentUser
) -> ChatSummary:
    """
    Open a group to its link, or close it.

    Closing clears the code rather than remembering it: a link that stops working and then starts
    again is a door somebody was handed a key to months ago.
    """
    chat = await _group_for_owner(session, chat_id, me)
    if chat.is_public == payload.is_public:
        return await render_chat_summary(session, chat, me)
    chat.is_public = payload.is_public
    chat.invite_code = _new_invite_code() if payload.is_public else None
    session.add(
        Message(
            chat_id=chat.id,
            sender_id=me.id,
            content=(
                f"{me.display_name} открыл(а) группу — теперь войти можно по ссылке"
                if payload.is_public
                else f"{me.display_name} закрыл(а) группу — вход только по приглашению"
            ),
            is_service=True,
        )
    )
    await session.commit()
    await session.refresh(chat)
    return await render_chat_summary(session, chat, me)


@app.post("/api/chats/{chat_id}/invite", response_model=ChatSummary, tags=["chats"])
async def rotate_group_invite(
    chat_id: uuid.UUID, session: SessionDep, me: CurrentUser
) -> ChatSummary:
    """Mint a new link and kill the old one — the answer to a link that leaked."""
    chat = await _group_for_owner(session, chat_id, me)
    if not chat.is_public:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ссылка есть только у публичной группы",
        )
    chat.invite_code = _new_invite_code()
    await session.commit()
    await session.refresh(chat)
    return await render_chat_summary(session, chat, me)


async def _chat_by_invite(session: AsyncSession, code: str) -> Chat:
    """The group behind a link, or a refusal that does not leak whether it ever existed."""
    chat = await session.scalar(
        select(Chat).where(Chat.invite_code == code.strip(), Chat.is_public.is_(True))
    )
    if chat is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Ссылка недействительна — группа закрыта или ссылка обновлена",
        )
    return chat


@app.get("/api/chats/join/{code}", response_model=GroupInvitePreview, tags=["chats"])
async def preview_group_invite(
    code: str, session: SessionDep, me: CurrentUser
) -> GroupInvitePreview:
    """What the link shows before anybody walks in."""
    chat = await _chat_by_invite(session, code)
    members = int(
        await session.scalar(
            select(func.count()).select_from(ChatMember).where(ChatMember.chat_id == chat.id)
        )
        or 0
    )
    owner = await session.get(User, chat.owner_id) if chat.owner_id else None
    mine = await session.scalar(
        select(ChatMember.id).where(ChatMember.chat_id == chat.id, ChatMember.user_id == me.id)
    )
    return GroupInvitePreview(
        chat_id=chat.id,
        title=chat.title or "Группа",
        avatar_url=chat.avatar_url,
        members_count=members,
        owner=compact_user(owner) if owner else None,
        is_member=mine is not None,
    )


@app.post("/api/chats/join/{code}", response_model=ChatSummary, tags=["chats"])
async def join_group_by_invite(
    code: str, session: SessionDep, me: CurrentUser
) -> ChatSummary:
    """Walk into a public group through its link."""
    chat = await _chat_by_invite(session, code)
    existing = await session.scalar(
        select(ChatMember).where(ChatMember.chat_id == chat.id, ChatMember.user_id == me.id)
    )
    if existing is None:
        session.add(ChatMember(chat_id=chat.id, user_id=me.id))
        session.add(
            Message(
                chat_id=chat.id,
                sender_id=me.id,
                content=f"{me.display_name} присоединился(ась) по ссылке",
                is_service=True,
            )
        )
        await session.commit()
        await session.refresh(chat)
    return await render_chat_summary(session, chat, me)


async def _resolve_members(
    session: AsyncSession, usernames: list[str], *, exclude: set[uuid.UUID]
) -> list[User]:
    """Turn a list of handles into users, refusing the whole call on the first bad one."""
    resolved: list[User] = []
    seen: set[uuid.UUID] = set(exclude)
    for username in usernames:
        user = await resolve_user(session, username)
        if user is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail=f"Пользователь @{username} не найден"
            )
        if user.id in seen:
            continue
        seen.add(user.id)
        resolved.append(user)
    return resolved


@app.patch("/api/chats/{chat_id}", response_model=ChatSummary, tags=["chats"])
async def update_group_chat(
    chat_id: uuid.UUID, payload: GroupUpdate, session: SessionDep, me: CurrentUser
) -> ChatSummary:
    """Renaming happens by tapping the group's own name, so any member may do it."""
    await require_chat_member(session, chat_id, me.id)
    chat = await session.get(Chat, chat_id)
    if chat is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Чат не найден")
    if not chat.is_group:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Переименовать можно только группу"
        )
    if payload.title is not None and payload.title.strip():
        renamed = payload.title.strip()
        if renamed != chat.title:
            session.add(
                Message(
                    chat_id=chat.id,
                    sender_id=me.id,
                    content=f"{me.display_name} переименовал(а) группу в «{renamed}»",
                    is_service=True,
                )
            )
        chat.title = renamed
    if payload.avatar_url is not None:
        chat.avatar_url = payload.avatar_url or None
    await session.commit()
    await session.refresh(chat)
    return await render_chat_summary(session, chat, me)


@app.post("/api/chats/{chat_id}/members", response_model=ChatSummary, tags=["chats"])
async def add_group_members(
    chat_id: uuid.UUID, payload: GroupMembersAdd, session: SessionDep, me: CurrentUser
) -> ChatSummary:
    await require_chat_member(session, chat_id, me.id)
    chat = await session.get(Chat, chat_id)
    if chat is None or not chat.is_group:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Участников можно добавить только в группу"
        )
    # A private group is entered by the owner's invitation only — that is what makes it private.
    if not chat.is_public and chat.owner_id != me.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="В закрытую группу приглашает только её владелец",
        )
    existing = set(
        (
            await session.scalars(
                select(ChatMember.user_id).where(ChatMember.chat_id == chat_id)
            )
        ).all()
    )
    added = await _resolve_members(session, payload.members, exclude=existing)
    if not added:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Эти пользователи уже в группе"
        )
    session.add_all([ChatMember(chat_id=chat.id, user_id=user.id) for user in added])
    for user in added:
        session.add(
            Message(
                chat_id=chat.id,
                sender_id=me.id,
                content=f"{user.display_name} присоединился(ась) к группе",
                is_service=True,
            )
        )
    await session.commit()
    await session.refresh(chat)
    return await render_chat_summary(session, chat, me)


@app.delete("/api/chats/{chat_id}/members/{username}", response_model=DetailResponse, tags=["chats"])
async def remove_group_member(
    chat_id: uuid.UUID, username: str, session: SessionDep, me: CurrentUser
) -> DetailResponse:
    await require_chat_member(session, chat_id, me.id)
    chat = await session.get(Chat, chat_id)
    if chat is None or not chat.is_group:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Это не групповой чат"
        )
    target = await resolve_user(session, username)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Пользователь не найден")
    # Anyone can leave; removing someone else is the owner's call.
    if target.id != me.id and chat.owner_id != me.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Удалять участников может только владелец"
        )
    member = await session.scalar(
        select(ChatMember).where(ChatMember.chat_id == chat_id, ChatMember.user_id == target.id)
    )
    if member is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Участник не найден")
    await session.delete(member)
    session.add(
        Message(
            chat_id=chat.id,
            sender_id=me.id,
            content=(
                f"{target.display_name} вышел(ла) из группы"
                if target.id == me.id
                else f"{target.display_name} удалён(а) из группы"
            ),
            is_service=True,
        )
    )
    await session.commit()
    return DetailResponse(detail="member_removed")


@app.get("/api/chats/{chat_id}/info", response_model=ChatInfo, tags=["chats"])
async def read_chat_info(chat_id: uuid.UUID, session: SessionDep, me: CurrentUser) -> ChatInfo:
    """Backs the panel behind the conversation header: who is here, and what was shared."""
    member = await require_chat_member(session, chat_id, me.id)
    chat = await session.get(Chat, chat_id)
    if chat is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Чат не найден")
    rows = (
        await session.execute(
            select(User, ChatMember)
            .join(ChatMember, ChatMember.user_id == User.id)
            .where(ChatMember.chat_id == chat_id)
            .order_by(ChatMember.joined_at)
        )
    ).all()
    premium = await premium_user_ids(session, [user.id for user, _ in rows])
    members = [
        ChatMemberOut(
            user=compact_user(user, is_premium=user.id in premium),
            joined_at=entry.joined_at,
            is_owner=chat.owner_id == user.id,
        )
        for user, entry in rows
    ]
    history = select(Message, User).join(User, Message.sender_id == User.id).where(
        Message.chat_id == chat_id
    )
    if member.cleared_at is not None:
        history = history.where(Message.created_at > member.cleared_at)
    messages = (await session.execute(history.order_by(Message.created_at.desc()))).all()
    links = [
        ChatLink(
            url=url,
            message_id=message.id,
            sender_name=sender.display_name,
            created_at=message.created_at,
        )
        for message, sender in messages
        for url in LINK_PATTERN.findall(message.content or "")
    ]
    gift_ids = [message.gift_id for message, _ in messages if message.gift_id]
    gifts = await _message_gifts(session, gift_ids)
    # Both shelves come out of the scan already done above rather than from a table of their
    # own: an attachment belongs to the message that carried it, and a second copy of that
    # fact is a second thing that can fall out of step.
    media = [
        ChatAttachment(
            kind=cast("Literal['image', 'video']", message.media_kind or "image"),
            url=message.media_url,
            message_id=message.id,
            sender_name=sender.display_name,
            created_at=message.created_at,
        )
        for message, sender in messages
        if message.media_url
    ]
    files = [
        ChatAttachment(
            kind="file",
            url=message.file_url,
            name=message.file_name,
            size=message.file_size,
            message_id=message.id,
            sender_name=sender.display_name,
            created_at=message.created_at,
        )
        for message, sender in messages
        if message.file_url
    ]
    return ChatInfo(
        chat=await render_chat_summary(session, chat, me),
        members=members,
        links=links[:60],
        media=media[:120],
        files=files[:60],
        gifts=[gifts[gift_id] for gift_id in gift_ids if gift_id in gifts][:60],
        messages_count=len(messages),
    )


# Bare domains count too: people paste "unixgram.com/x" without a scheme.
LINK_PATTERN = re.compile(r"(?:https?://|www\.)[^\s<>\"']+|(?:[\w-]+\.)+[a-z]{2,}/[^\s<>\"']*", re.IGNORECASE)

# An open drop needs a crowd: two people are a direct chat, where a named gift is clearer.
MIN_CLAIMABLE_MEMBERS = 3


async def _chat_gift_recipient(
    session: AsyncSession, member_ids: set[uuid.UUID], payload: ChatGiftRequest, me: User
) -> User | None:
    """Who a chat gift is for, or None when it is an open drop anyone may claim."""
    recipient: User | None = None
    if payload.to_username:
        resolved = await resolve_user(session, payload.to_username)
        if resolved is None or resolved.id not in member_ids:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Получатель не участник чата"
            )
        _refuse_banned_recipient(resolved)
        recipient = resolved
    elif not payload.claimable:
        # A direct chat has exactly one other person, so no choice needs making.
        peer_ids = member_ids - {me.id}
        if len(peer_ids) != 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Выберите получателя или откройте подарок для всех",
            )
        recipient = await session.get(User, peer_ids.pop())
        if recipient is not None:
            _refuse_banned_recipient(recipient)
    if payload.claimable and len(member_ids) < MIN_CLAIMABLE_MEMBERS:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Открытый подарок имеет смысл только в группе",
        )
    if recipient is not None and recipient.id == me.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Выберите другого получателя"
        )
    return recipient


@app.post(
    "/api/chats/{chat_id}/gifts",
    response_model=ChatMessage,
    status_code=status.HTTP_201_CREATED,
    tags=["chats"],
)
async def send_chat_gift(
    chat_id: uuid.UUID, payload: ChatGiftRequest, session: SessionDep, me: CurrentUser
) -> ChatMessage:
    """
    Gift into a conversation.

    A group takes either shape: addressed to one member, or left open for whoever claims it
    first. An open drop is minted to the sender and only changes hands when someone takes it,
    so an unclaimed gift is never stranded in a nobody's collection.
    """
    await require_chat_member(session, chat_id, me.id)
    chat = await session.get(Chat, chat_id)
    if chat is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Чат не найден")
    model = await session.scalar(
        select(GiftModel)
        .where(func.lower(GiftModel.slug) == payload.slug.strip().lower())
        .with_for_update()
    )
    if model is None or not model.available:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Подарок не найден")

    member_ids = set(
        (
            await session.scalars(select(ChatMember.user_id).where(ChatMember.chat_id == chat_id))
        ).all()
    )
    recipient = await _chat_gift_recipient(session, member_ids, payload, me)

    owner = recipient if recipient is not None else me
    note = (payload.message or "").strip() or None
    gift = await _mint_gift(
        session,
        model,
        owner=owner,
        buyer=me,
        message=note,
        hide_sender=payload.hide_my_name,
    )
    # An open drop is minted to the sender, but the note belongs to whoever takes it.
    if payload.claimable:
        gift.message = note
    label = f"«{gift.name}» #{gift.serial_number}"
    sender_label = "Кто-то" if payload.hide_my_name else me.display_name
    message = Message(
        chat_id=chat_id,
        sender_id=me.id,
        content=(
            f"🎁 Подарок {label} — нажмите, чтобы забрать"
            if payload.claimable
            else f"🎁 Подарок {label}"
            + (f" для {recipient.display_name}" if recipient and chat.is_group else "")
        )
        + (f" — {note}" if note else ""),
        gift_id=gift.id,
        gift_claimable=payload.claimable,
    )
    session.add(message)
    if recipient is not None:
        session.add(
            Notification(
                user_id=recipient.id,
                actor_id=None if payload.hide_my_name else me.id,
                kind=NotificationKind.GIFT,
                text=f"{sender_label} подарил(а) вам {label}",
                entity_id=str(gift.id),
            )
        )
    await enqueue_wire_chat_event(
        session,
        chat_id,
        "chat.message_created",
        {"message_id": str(message.id)},
        actor_id=me.id,
    )
    await session.commit()
    await session.refresh(message)
    author_premium, author_emblem = await _sender_marks(session, me.id)
    outgoing = message_out(
        message,
        me,
        me.id,
        gift=compact_gift(gift),
        sender_premium=author_premium,
        sender_name_gift=author_emblem,
    )
    await chat_connections.broadcast(
        chat_id, {"type": "message", "message": broadcast_payload(outgoing)}
    )
    # A gift is a message too, so the list has to move for everybody the same way it does for text.
    await announce_chat_activity(session, chat_id, actor_id=me.id)
    return outgoing


@app.post(
    "/api/chats/{chat_id}/messages/{message_id}/claim-gift",
    response_model=ChatMessage,
    tags=["chats"],
)
async def claim_chat_gift(
    chat_id: uuid.UUID, message_id: uuid.UUID, session: SessionDep, me: CurrentUser
) -> ChatMessage:
    """First member to press the button takes the drop; the row is locked so only one wins."""
    await require_chat_member(session, chat_id, me.id)
    message = await session.scalar(
        select(Message)
        .where(Message.id == message_id, Message.chat_id == chat_id)
        .with_for_update()
    )
    if message is None or message.gift_id is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Подарок не найден")
    if not message.gift_claimable:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Этот подарок нельзя забрать"
        )
    if message.gift_claimed_by_id is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Подарок уже забрали")
    if message.sender_id == me.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Свой подарок забрать нельзя"
        )
    gift = await session.scalar(
        select(Gift).where(Gift.id == message.gift_id).with_for_update()
    )
    if gift is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Подарок не найден")

    claimed_at = utcnow()
    session.add(
        GiftTransfer(
            gift_id=gift.id,
            from_user_id=gift.owner_id,
            to_user_id=me.id,
            note="Забрал(а) открытый подарок в группе",
            transferred_at=claimed_at,
        )
    )
    await session.execute(
        delete(GiftShowcase).where(
            GiftShowcase.user_id == gift.owner_id, GiftShowcase.gift_id == gift.id
        )
    )
    sender_id = message.sender_id
    gift.owner_id = me.id
    gift.received_at = claimed_at
    # Taking a drop is the claim, not the unwrapping: it stays wrapped until it is opened.
    gift.sale_price_stars = None
    gift.listed_at = None
    message.gift_claimed_by_id = me.id
    message.gift_claimable = False
    session.add(
        Message(
            chat_id=chat_id,
            sender_id=me.id,
            content=f"{me.display_name} забрал(а) подарок «{gift.name}» #{gift.serial_number}",
            is_service=True,
        )
    )
    session.add(
        Notification(
            user_id=sender_id,
            actor_id=me.id,
            kind=NotificationKind.GIFT,
            text=f"{me.display_name} забрал(а) ваш подарок «{gift.name}»",
            entity_id=str(gift.id),
        )
    )
    await enqueue_wire_chat_event(
        session,
        chat_id,
        "chat.message_edited",
        {"message_id": str(message_id)},
        actor_id=me.id,
    )
    await session.commit()
    await session.refresh(message)
    sender = await session.get(User, message.sender_id)
    author_premium, author_emblem = await _sender_marks(session, message.sender_id)
    outgoing = message_out(
        message,
        sender or me,
        me.id,
        gift=compact_gift(gift),
        sender_premium=author_premium,
        sender_name_gift=author_emblem,
        claimed_by=compact_user(me),
    )
    await chat_connections.broadcast(
        chat_id, {"type": "message_edited", "message": broadcast_payload(outgoing)}
    )
    return outgoing



@app.get("/api/chats/{chat_id}/messages", response_model=list[ChatMessage], tags=["chats"])
async def read_messages(
    chat_id: uuid.UUID,
    session: SessionDep,
    me: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
) -> list[ChatMessage]:
    member = await require_chat_member(session, chat_id, me.id)
    chat = await session.get(Chat, chat_id)
    if chat is not None:
        # Reading is the other moment a message could outlive its window, so it is enforced here.
        await purge_expired_messages(session, chat)
    hidden = set(
        (
            await session.scalars(
                select(MessageHide.message_id)
                .join(Message, Message.id == MessageHide.message_id)
                .where(MessageHide.user_id == me.id, Message.chat_id == chat_id)
            )
        ).all()
    )
    window = (
        select(Message, User)
        .join(User, Message.sender_id == User.id)
        .where(Message.chat_id == chat_id, Message.id.notin_(hidden) if hidden else true())
    )
    if member.cleared_at is not None:
        window = window.where(Message.created_at > member.cleared_at)
    rows = (
        await session.execute(window.order_by(Message.created_at.desc()).limit(limit))
    ).all()
    # Opening the conversation is what marks it read; there is no separate "seen" call.
    member.last_read_at = utcnow()
    member.marked_unread = False
    await session.commit()
    ordered = list(reversed(rows))
    quotes = await _message_quotes(
        session, [message.reply_to_id for message, _ in ordered if message.reply_to_id]
    )
    reactions = await _message_reactions(session, [message.id for message, _ in ordered], me.id)
    premium = await premium_user_ids(session, [sender.id for _, sender in ordered])
    emblems = await name_gift_map(session, [sender.id for _, sender in ordered])
    gifts = await _message_gifts(
        session, [message.gift_id for message, _ in ordered if message.gift_id]
    )
    claimers = await _message_claimers(
        session, [message.gift_claimed_by_id for message, _ in ordered]
    )
    # Forwarded copies name their original author, which is another id-to-user lookup.
    forwarders = await _message_claimers(
        session, [message.forwarded_from_id for message, _ in ordered]
    )
    stories = await _message_stories(
        session, [message.story_id for message, _ in ordered if message.story_id]
    )
    peers_read_at = await _peers_read_at(session, chat_id, me.id)
    return [
        message_out(
            message,
            sender,
            me.id,
            quote=quotes.get(message.reply_to_id),
            reactions=reactions.get(message.id),
            sender_premium=sender.id in premium,
            sender_name_gift=emblems.get(sender.id),
            gift=gifts.get(message.gift_id) if message.gift_id else None,
            peers_read_at=peers_read_at,
            claimed_by=claimers.get(message.gift_claimed_by_id)
            if message.gift_claimed_by_id
            else None,
            forwarded_from=forwarders.get(message.forwarded_from_id)
            if message.forwarded_from_id
            else None,
            story=stories.get(message.story_id) if message.story_id else None,
        )
        for message, sender in ordered
    ]


async def _message_stories(
    session: AsyncSession, story_ids: list[uuid.UUID]
) -> dict[uuid.UUID, StoryCompact]:
    """Story cards for a window of messages, in one query — with their authors in a second."""
    if not story_ids:
        return {}
    rows = (
        await session.execute(
            select(ProfileStory, User)
            .join(User, ProfileStory.author_id == User.id)
            .where(ProfileStory.id.in_(set(story_ids)))
        )
    ).all()
    return {story.id: compact_story(story, author) for story, author in rows}


async def _message_claimers(
    session: AsyncSession, user_ids: list[uuid.UUID | None]
) -> dict[uuid.UUID, UserCompact]:
    """The users behind a window's ids — gift claimers, forward authors — in one query."""
    wanted = {user_id for user_id in user_ids if user_id}
    if not wanted:
        return {}
    users = (await session.scalars(select(User).where(User.id.in_(wanted)))).all()
    return {user.id: compact_user(user) for user in users}


async def _message_gifts(
    session: AsyncSession, gift_ids: list[uuid.UUID]
) -> dict[uuid.UUID, GiftCompact]:
    """Gift cards for a window of messages, in one query."""
    if not gift_ids:
        return {}
    gifts = (await session.scalars(select(Gift).where(Gift.id.in_(set(gift_ids))))).all()
    return {gift.id: compact_gift(gift) for gift in gifts}


async def _message_reactions(
    session: AsyncSession, message_ids: list[uuid.UUID], me_id: uuid.UUID
) -> dict[uuid.UUID, list[MessageReactionOut]]:
    """Group every reaction in the visible window by message and emoji in one query."""
    if not message_ids:
        return {}
    rows = (
        await session.execute(
            select(MessageReaction, User)
            .join(User, User.id == MessageReaction.user_id)
            .where(MessageReaction.message_id.in_(set(message_ids)))
            .order_by(MessageReaction.created_at)
        )
    ).all()
    buckets: dict[uuid.UUID, dict[str, list[tuple[MessageReaction, User]]]] = defaultdict(
        lambda: defaultdict(list)
    )
    for reaction, user in rows:
        buckets[reaction.message_id][reaction.emoji].append((reaction, user))
    return {
        message_id: [
            MessageReactionOut(
                emoji=emoji,
                count=len(entries),
                mine=any(reaction.user_id == me_id for reaction, _ in entries),
                users=[compact_user(user) for _, user in entries[:3]],
            )
            for emoji, entries in emojis.items()
        ]
        for message_id, emojis in buckets.items()
    }


async def _message_quotes(
    session: AsyncSession, ids: list[uuid.UUID]
) -> dict[uuid.UUID, MessageQuote]:
    """Load replied-to messages in one query rather than one per bubble."""
    if not ids:
        return {}
    rows = (
        await session.execute(
            select(Message, User)
            .join(User, Message.sender_id == User.id)
            .where(Message.id.in_(set(ids)))
        )
    ).all()
    return {
        message.id: MessageQuote(
            id=message.id,
            sender_name=sender.display_name,
            content=message.content[:160],
        )
        for message, sender in rows
    }


async def create_chat_message(  # noqa: C901, PLR0913
    session: AsyncSession,
    chat_id: uuid.UUID,
    me: User,
    content: str,
    *,
    reply_to_id: uuid.UUID | None = None,
    forwarded_from_id: uuid.UUID | None = None,
    media_url: str | None = None,
    media_kind: str | None = None,
    document: tuple[str, str, int] | None = None,
    story_id: uuid.UUID | None = None,
) -> ChatMessage:
    member = await require_chat_member(session, chat_id, me.id)
    if reply_to_id is not None:
        # A reply must point at a message in this same chat, not an arbitrary id.
        parent_chat = await session.scalar(select(Message.chat_id).where(Message.id == reply_to_id))
        if parent_chat != chat_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Сообщение для ответа не найдено"
            )
    chat = await session.get(Chat, chat_id)
    if chat is not None:
        await _refuse_if_blocked(session, chat, me)
        # Whatever has outlived the window goes before the new message arrives, so the thread
        # is never briefly longer than the chat's own rule allows.
        await purge_expired_messages(session, chat)
    message = Message(
        id=uuid.uuid4(),
        chat_id=chat_id,
        sender_id=me.id,
        content=content,
        reply_to_id=reply_to_id,
        forwarded_from_id=forwarded_from_id,
        media_url=media_url,
        media_kind=media_kind,
        file_url=document[0] if document else None,
        file_name=document[1] if document else None,
        file_size=document[2] if document else None,
        story_id=story_id,
    )
    session.add(message)
    # Writing into a chat is the clearest possible sign it is not deleted or unread.
    member.cleared_at = None
    member.marked_unread = False
    # Load all members once: notification muting and durable transport delivery are different
    # concerns. Muted members skip the notification but must still receive chat invalidation events.
    member_rows = (
        await session.execute(
            select(ChatMember.user_id, ChatMember.muted).where(ChatMember.chat_id == chat_id)
        )
    ).all()
    recipients = [
        user_id for user_id, muted in member_rows if user_id != me.id and not muted
    ]
    # A wordless message still has to say something in the list and in the notification, so it
    # is named by what it carries.
    if media_kind == "video":
        wordless = "Видео"
    elif media_url:
        wordless = "Фото"
    elif document:
        wordless = f"Файл · {document[1]}"
    elif story_id is not None:
        wordless = "История"
    else:
        wordless = ""
    for recipient_id in recipients:
        session.add(
            Notification(
                user_id=recipient_id,
                actor_id=me.id,
                kind=NotificationKind.MESSAGE,
                text=f"{me.display_name}: {content[:120] or wordless}",
                entity_id=str(chat_id),
            )
        )
    if WIRE_OUTBOX_ENABLED:
        for recipient_id, _muted in member_rows:
            session.add(
                RealtimeOutbox(
                    user_id=recipient_id,
                    event_type="chat.message_created",
                    payload={
                        "chat_id": str(chat_id),
                        "message_id": str(message.id),
                        "actor_id": str(me.id),
                    },
                    idempotency_key=f"message:{message.id}:{recipient_id}",
                )
            )
    await session.commit()
    await session.refresh(message)
    # Everybody in the chat, muted included, so their chat list moves without being re-opened.
    # The per-chat socket only reaches whoever has that conversation on screen; this is what makes
    # a badge appear while the reader is somewhere else entirely.
    await announce_chat_activity(session, chat_id, actor_id=me.id)
    quotes = await _message_quotes(session, [reply_to_id] if reply_to_id else [])
    forwarded = (
        compact_user(await session.get(User, forwarded_from_id) or me)
        if forwarded_from_id
        else None
    )
    shared = await _shared_story(session, story_id)
    # The author's own marks, so the frame that reaches everybody else already carries them. A
    # socket frame is the only copy of a live message the other members get: without these, a
    # premium star or a name gift appeared only after the thread was re-fetched.
    author_premium = await premium_user_ids(session, [me.id])
    author_emblem = await name_gift_map(session, [me.id])
    return message_out(
        message,
        me,
        me.id,
        quote=quotes.get(reply_to_id) if reply_to_id else None,
        sender_premium=me.id in author_premium,
        sender_name_gift=author_emblem.get(me.id),
        forwarded_from=forwarded,
        story=shared,
    )


WIRE_SOCIAL_EVENT_TYPES = frozenset(
    {
        "post_created",
        "post_updated",
        "post_deleted",
        "post_reacted",
        "comment_created",
        "comment_updated",
        "comment_deleted",
        "comment_reacted",
    }
)


async def enqueue_wire_social_event(
    session: AsyncSession,
    event_type: str,
    post_id: uuid.UUID,
    *,
    author_id: uuid.UUID | None = None,
    comment_id: uuid.UUID | None = None,
    actor_id: uuid.UUID | None = None,
) -> None:
    """Queue one privacy-filtered social invalidation per active account in the transaction."""
    if not WIRE_OUTBOX_ENABLED:
        return
    if event_type not in WIRE_SOCIAL_EVENT_TYPES:
        raise ValueError("invalid Wire social event type")
    recipient_query = (
        select(RefreshSession.user_id)
        .join(User, User.id == RefreshSession.user_id)
        .where(
            RefreshSession.revoked_at.is_(None),
            RefreshSession.expires_at > func.now(),
            User.banned_at.is_(None),
        )
        .distinct()
    )
    if author_id is not None:
        blocked = select(UserBlock.id).where(
            or_(
                and_(
                    UserBlock.blocker_id == RefreshSession.user_id,
                    UserBlock.blocked_id == author_id,
                ),
                and_(
                    UserBlock.blocker_id == author_id,
                    UserBlock.blocked_id == RefreshSession.user_id,
                ),
            )
        )
        recipient_query = recipient_query.where(~blocked.exists())
        private_account = bool(
            await session.scalar(
                select(UserSettings.private_account).where(UserSettings.user_id == author_id)
            )
        )
        if private_account:
            follows = select(Follow.id).where(
                Follow.follower_id == RefreshSession.user_id,
                Follow.following_id == author_id,
            )
            recipient_query = recipient_query.where(
                or_(RefreshSession.user_id == author_id, follows.exists())
            )
    recipients = (await session.scalars(recipient_query)).all()
    body = {"post_id": str(post_id)}
    if comment_id is not None:
        body["comment_id"] = str(comment_id)
    if actor_id is not None:
        body["actor_id"] = str(actor_id)
    operation_id = uuid.uuid4().hex
    for recipient_id in recipients:
        session.add(
            RealtimeOutbox(
                user_id=recipient_id,
                event_type=event_type,
                payload=dict(body),
                idempotency_key=f"social:{event_type}:{operation_id}:{recipient_id}",
            )
        )


MAX_WIRE_EVENT_TYPE_LENGTH = 96


async def enqueue_wire_chat_event(
    session: AsyncSession,
    chat_id: uuid.UUID,
    event_type: str,
    payload: dict[str, Any],
    *,
    actor_id: uuid.UUID | None = None,
) -> None:
    """Queue one durable per-member chat invalidation in the caller's transaction."""
    if not WIRE_OUTBOX_ENABLED:
        return
    if not event_type.startswith("chat.") or len(event_type) > MAX_WIRE_EVENT_TYPE_LENGTH:
        raise ValueError("invalid Wire chat event type")
    members = (
        await session.scalars(select(ChatMember.user_id).where(ChatMember.chat_id == chat_id))
    ).all()
    body: dict[str, Any] = {"chat_id": str(chat_id), **payload}
    if actor_id is not None:
        body["actor_id"] = str(actor_id)
    operation_id = uuid.uuid4().hex
    for recipient_id in members:
        session.add(
            RealtimeOutbox(
                user_id=recipient_id,
                event_type=event_type,
                payload=body,
                idempotency_key=f"{event_type}:{operation_id}:{recipient_id}",
            )
        )


async def announce_chat_activity(
    session: AsyncSession, chat_id: uuid.UUID, *, actor_id: uuid.UUID | None = None
) -> None:
    """
    Tell every member's open tabs that this conversation moved.

    Deliberately thin — a chat id and who caused it — so nothing here has to know what a message
    looks like, and so the frame is safe to send to a tab showing an unrelated screen. The chat
    list refetches on it; a tab that has the conversation open already had it from the per-chat
    socket and merely refetches a list it was going to refetch anyway.
    """
    members = (
        await session.scalars(select(ChatMember.user_id).where(ChatMember.chat_id == chat_id))
    ).all()
    payload: dict[str, Any] = {"type": "chat_activity", "chat_id": str(chat_id)}
    if actor_id is not None:
        payload["actor_id"] = str(actor_id)
    await social_connections.send_to_users(members, payload)


async def _shared_story(
    session: AsyncSession, story_id: uuid.UUID | None
) -> StoryCompact | None:
    """The card for one shared story, or nothing when the message carries none."""
    if story_id is None:
        return None
    story = await session.get(ProfileStory, story_id)
    if story is None:
        return None
    author = await session.get(User, story.author_id)
    return compact_story(story, author) if author else None


async def _refuse_if_blocked(session: AsyncSession, chat: Chat, me: User) -> None:
    """A block closes the conversation in both directions, so neither side can write."""
    if chat.is_group or chat.kind == "saved":
        return
    peer_id = await session.scalar(
        select(ChatMember.user_id).where(
            ChatMember.chat_id == chat.id, ChatMember.user_id != me.id
        )
    )
    if peer_id is None:
        return
    if await _blocked_between(session, me.id, peer_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=BLOCKED_CHAT_DETAIL)


@app.post(
    "/api/chats/{chat_id}/messages",
    response_model=ChatMessage,
    status_code=status.HTTP_201_CREATED,
    tags=["chats"],
)
async def send_message(
    chat_id: uuid.UUID, payload: MessageCreate, session: SessionDep, me: CurrentUser
) -> ChatMessage:
    outgoing = await create_chat_message(
        session, chat_id, me, payload.content, reply_to_id=payload.reply_to_id
    )
    await chat_connections.broadcast(
        chat_id, {"type": "message", "message": broadcast_payload(outgoing)}
    )
    return outgoing


@app.post(
    "/api/chats/{chat_id}/messages/media",
    response_model=ChatMessage,
    status_code=status.HTTP_201_CREATED,
    tags=["chats"],
)
async def send_message_media(  # noqa: PLR0913
    chat_id: uuid.UUID,
    session: SessionDep,
    me: CurrentUser,
    *,
    file: Annotated[UploadFile, File()],
    caption: Annotated[str, Form(max_length=2000)] = "",
    reply_to_id: Annotated[uuid.UUID | None, Form()] = None,
) -> ChatMessage:
    """
    Send a picture, a clip or a document, with the text beside it as its caption.

    One endpoint for all three because the composer has one attach button: what arrived is
    decided from the upload's own declared type, and each kind is then stored by the helper
    that already knows how to check it — nothing is trusted because of its name.

    Membership is checked before the bytes are stored, so a stranger cannot use a chat id as
    free file hosting.
    """
    await require_chat_member(session, chat_id, me.id)
    declared = (file.content_type or "").lower()
    media_url: str | None = None
    media_kind: str | None = None
    document: tuple[str, str, int] | None = None
    if declared.startswith("video/"):
        media_url = await _store_video(
            file, "chats", me.id, await upload_ceiling(session, me, MAX_VIDEO_BYTES)
        )
        media_kind = "video"
    elif declared.startswith("image/"):
        media_url = await _store_image(file, "chats", me.id)
        media_kind = "image"
    else:
        # Documents share the one store the feed's own attachments use, and are handed back
        # only as downloads by `download_post_file`.
        url, name, size, _label = await _store_document(
            file, "files", me.id, await upload_ceiling(session, me, MAX_FILE_BYTES)
        )
        document = (url, name, size)
    outgoing = await create_chat_message(
        session,
        chat_id,
        me,
        caption.strip(),
        reply_to_id=reply_to_id,
        media_url=media_url,
        media_kind=media_kind,
        document=document,
    )
    await chat_connections.broadcast(
        chat_id, {"type": "message", "message": broadcast_payload(outgoing)}
    )
    return outgoing


@app.post(
    "/api/chats/{chat_id}/messages/forward",
    response_model=DetailResponse,
    status_code=status.HTTP_201_CREATED,
    tags=["chats"],
)
async def forward_messages(
    chat_id: uuid.UUID, payload: MessageForward, session: SessionDep, me: CurrentUser
) -> DetailResponse:
    """
    Copy chosen messages into other conversations, oldest first.

    A forward is a new message that remembers its original author, not a pointer at the old
    one: the source may later be deleted, and the copy has to survive that.

    A gift is not copied. The card announces one particular collectible with one owner, so a
    second card claiming the same serial in another chat would be a lie about who holds it.
    """
    await require_chat_member(session, chat_id, me.id)
    originals = (
        await session.scalars(
            select(Message)
            .where(Message.id.in_(set(payload.message_ids)), Message.chat_id == chat_id)
            .order_by(Message.created_at)
        )
    ).all()
    if not originals:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Сообщения не найдены")
    sent = 0
    skipped = 0
    for target_id in dict.fromkeys(payload.chat_ids):
        await require_chat_member(session, target_id, me.id)
        for original in originals:
            if original.is_service or original.gift_id is not None:
                skipped += 1
                continue
            outgoing = await create_chat_message(
                session,
                target_id,
                me,
                original.content,
                forwarded_from_id=original.forwarded_from_id or original.sender_id,
                media_url=original.media_url,
            )
            await chat_connections.broadcast(
                target_id, {"type": "message", "message": broadcast_payload(outgoing)}
            )
            sent += 1
    if not sent:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Подарки и служебные сообщения не пересылаются",
        )
    tail = " · часть пропущена" if skipped else ""
    return DetailResponse(detail=f"Переслано: {sent}{tail}")


async def _own_message(
    session: AsyncSession, chat_id: uuid.UUID, message_id: uuid.UUID, me: User
) -> Message:
    """Fetch a message the caller may act on as its author, or fail with the right status."""
    await require_chat_member(session, chat_id, me.id)
    message = await session.scalar(
        select(Message).where(Message.id == message_id, Message.chat_id == chat_id)
    )
    if message is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Сообщение не найдено")
    if message.sender_id != me.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Можно менять только свои сообщения"
        )
    return message


@app.patch(
    "/api/chats/{chat_id}/messages/{message_id}", response_model=ChatMessage, tags=["chats"]
)
async def edit_message(
    chat_id: uuid.UUID,
    message_id: uuid.UUID,
    payload: MessageEdit,
    session: SessionDep,
    me: CurrentUser,
) -> ChatMessage:
    message = await _own_message(session, chat_id, message_id, me)
    if message.is_service:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Служебное сообщение нельзя изменить"
        )
    if message.gift_id is not None:
        # The card's text states a serial and a recipient; letting the sender rewrite it would
        # let them misrepresent what was actually given.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Сообщение о подарке нельзя изменить"
        )
    message.content = payload.content
    message.edited_at = utcnow()
    await enqueue_wire_chat_event(
        session,
        chat_id,
        "chat.message_edited",
        {"message_id": str(message_id)},
        actor_id=me.id,
    )
    await session.commit()
    await session.refresh(message)
    quotes = await _message_quotes(session, [message.reply_to_id] if message.reply_to_id else [])
    author_premium, author_emblem = await _sender_marks(session, me.id)
    outgoing = message_out(
        message,
        me,
        me.id,
        quote=quotes.get(message.reply_to_id) if message.reply_to_id else None,
        sender_premium=author_premium,
        sender_name_gift=author_emblem,
    )
    await chat_connections.broadcast(
        chat_id, {"type": "message_edited", "message": broadcast_payload(outgoing)}
    )
    return outgoing


@app.delete(
    "/api/chats/{chat_id}/messages/{message_id}", response_model=DetailResponse, tags=["chats"]
)
async def delete_message(
    chat_id: uuid.UUID,
    message_id: uuid.UUID,
    session: SessionDep,
    me: CurrentUser,
    scope: Annotated[str, Query(pattern="^(me|all)$")] = "me",
) -> DetailResponse:
    """
    `scope=me` hides the message for the caller only; `scope=all` recalls it for everyone.

    Recall is limited to the author — hiding is not, because anyone may clear their own view.
    """
    await require_chat_member(session, chat_id, me.id)
    message = await session.scalar(
        select(Message).where(Message.id == message_id, Message.chat_id == chat_id)
    )
    if message is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Сообщение не найдено")
    if scope == "all":
        if message.sender_id != me.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Удалить у всех может только автор",
            )
        # The row goes away entirely — no tombstone in its place. Replies survive because
        # `reply_to_id` is ON DELETE SET NULL, so only the quote disappears with it.
        await enqueue_wire_chat_event(
            session,
            chat_id,
            "chat.message_deleted",
            {"message_id": str(message_id)},
            actor_id=me.id,
        )
        await session.delete(message)
        await session.commit()
        await chat_connections.broadcast(
            chat_id, {"type": "message_deleted", "message_id": str(message_id)}
        )
        return DetailResponse(detail="Сообщение удалено у всех")
    already = await session.scalar(
        select(MessageHide).where(
            MessageHide.message_id == message_id, MessageHide.user_id == me.id
        )
    )
    if already is None:
        session.add(MessageHide(message_id=message_id, user_id=me.id))
        await session.commit()
    return DetailResponse(detail="Сообщение скрыто у вас")


@app.post(
    "/api/chats/{chat_id}/messages/{message_id}/reactions",
    response_model=ChatMessage,
    tags=["chats"],
)
async def toggle_reaction(
    chat_id: uuid.UUID,
    message_id: uuid.UUID,
    payload: ReactionToggle,
    session: SessionDep,
    me: CurrentUser,
) -> ChatMessage:
    """
    Set, swap or clear my reaction on a message.

    The same emoji twice clears it; a different one replaces it, so a person never holds two
    reactions on one message.
    """
    await require_chat_member(session, chat_id, me.id)
    rows = (
        await session.execute(
            select(Message, User)
            .join(User, Message.sender_id == User.id)
            .where(Message.id == message_id, Message.chat_id == chat_id)
        )
    ).all()
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Сообщение не найдено")
    message, sender = rows[0]
    if message.is_service:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="На служебное сообщение нельзя реагировать"
        )
    existing = await session.scalar(
        select(MessageReaction).where(
            MessageReaction.message_id == message_id, MessageReaction.user_id == me.id
        )
    )
    if existing is None:
        session.add(MessageReaction(message_id=message_id, user_id=me.id, emoji=payload.emoji))
    elif existing.emoji == payload.emoji:
        await session.delete(existing)
    else:
        existing.emoji = payload.emoji
    await enqueue_wire_chat_event(
        session,
        chat_id,
        "chat.message_reacted",
        {"message_id": str(message_id)},
        actor_id=me.id,
    )
    await session.commit()
    reactions = await _message_reactions(session, [message_id], me.id)
    quotes = await _message_quotes(session, [message.reply_to_id] if message.reply_to_id else [])
    author_premium, author_emblem = await _sender_marks(session, message.sender_id)
    outgoing = message_out(
        message,
        sender,
        me.id,
        quote=quotes.get(message.reply_to_id) if message.reply_to_id else None,
        reactions=reactions.get(message_id),
        sender_premium=author_premium,
        sender_name_gift=author_emblem,
    )
    await chat_connections.broadcast(
        chat_id, {"type": "message_reacted", "message": broadcast_payload(outgoing)}
    )
    return outgoing


@app.post(
    "/api/chats/{chat_id}/messages/{message_id}/pin", response_model=ChatMessage, tags=["chats"]
)
async def pin_message(
    chat_id: uuid.UUID, message_id: uuid.UUID, session: SessionDep, me: CurrentUser
) -> ChatMessage:
    """Pinning is shared state in a direct chat, so any member may pin or unpin."""
    await require_chat_member(session, chat_id, me.id)
    rows = (
        await session.execute(
            select(Message, User)
            .join(User, Message.sender_id == User.id)
            .where(Message.id == message_id, Message.chat_id == chat_id)
        )
    ).all()
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Сообщение не найдено")
    message, sender = rows[0]
    if message.is_service:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Служебное сообщение нельзя закрепить"
        )
    pinning = message.pinned_at is None
    if pinning:
        # One pin per chat, like the reference: pinning replaces whatever was pinned before.
        await session.execute(
            update(Message)
            .where(Message.chat_id == chat_id, Message.pinned_at.is_not(None))
            .values(pinned_at=None)
        )
    message.pinned_at = utcnow() if pinning else None
    if pinning:
        # The reference announces a pin in the thread rather than in a header bar.
        preview = " ".join(message.content[:60].split())
        session.add(
            Message(
                chat_id=chat_id,
                sender_id=me.id,
                content=f"📌 {me.display_name} закрепил(а): «{preview}»",
                is_service=True,
            )
        )
    await enqueue_wire_chat_event(
        session,
        chat_id,
        "chat.message_pinned",
        {"message_id": str(message_id), "pinned": pinning},
        actor_id=me.id,
    )
    await session.commit()
    await session.refresh(message)
    author_premium, author_emblem = await _sender_marks(session, message.sender_id)
    outgoing = message_out(
        message, sender, me.id, sender_premium=author_premium, sender_name_gift=author_emblem
    )
    await chat_connections.broadcast(
        chat_id, {"type": "message_pinned", "message": broadcast_payload(outgoing)}
    )
    return outgoing


async def _wallet_for_update(session: AsyncSession, user_id: uuid.UUID) -> StarWallet:
    wallet = await session.scalar(
        select(StarWallet).where(StarWallet.user_id == user_id).with_for_update()
    )
    if wallet is None:
        wallet = StarWallet(user_id=user_id, balance=0)
        session.add(wallet)
        await session.flush()
    return wallet


def _ledger_change(  # noqa: PLR0913
    session: AsyncSession,
    wallet: StarWallet,
    amount: int,
    *,
    kind: str,
    description: str,
    correlation_id: uuid.UUID,
    counterparty_id: uuid.UUID | None = None,
    entity_type: str | None = None,
    entity_id: str | None = None,
) -> None:
    new_balance = wallet.balance + amount
    if new_balance < 0:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Недостаточно Stars")
    wallet.balance = new_balance
    wallet.updated_at = utcnow()
    session.add(
        StarLedger(
            user_id=wallet.user_id,
            amount=amount,
            balance_after=new_balance,
            kind=kind,
            description=description,
            counterparty_id=counterparty_id,
            entity_type=entity_type,
            entity_id=entity_id,
            correlation_id=correlation_id,
        )
    )


@app.get("/api/stars/wallet", response_model=WalletOut, tags=["Stars"])
async def stars_wallet(session: SessionDep, me: CurrentUser) -> WalletOut:
    wallet = await _wallet_for_update(session, me.id)
    return WalletOut(
        balance=wallet.balance,
        updated_at=wallet.updated_at,
        # So the wallet can say the way out is closed instead of offering a form that will refuse.
        payouts_enabled=STAR_PAYOUTS_ENABLED,
    )


async def _star_transactions(session: AsyncSession, me: User, limit: int) -> list[StarLedgerOut]:
    rows = (
        await session.execute(
            select(StarLedger, User)
            .outerjoin(User, StarLedger.counterparty_id == User.id)
            .where(StarLedger.user_id == me.id)
            .order_by(StarLedger.created_at.desc())
            .limit(limit)
        )
    ).all()
    return [
        StarLedgerOut(
            id=entry.id,
            amount=entry.amount,
            balance_after=entry.balance_after,
            kind=entry.kind,
            description=entry.description,
            counterparty=compact_user(counterparty) if counterparty else None,
            entity_type=entry.entity_type,
            entity_id=entry.entity_id,
            correlation_id=entry.correlation_id,
            created_at=entry.created_at,
        )
        for entry, counterparty in rows
    ]


@app.get("/api/stars/transactions", response_model=list[StarLedgerOut], tags=["Stars"])
@app.get("/api/stars/ledger", response_model=list[StarLedgerOut], tags=["Stars"])
async def star_transactions(
    session: SessionDep, me: CurrentUser, limit: Annotated[int, Query(ge=1, le=200)] = 100
) -> list[StarLedgerOut]:
    return await _star_transactions(session, me, limit)


@app.post("/api/stars/top-up", response_model=WalletOut, tags=["Stars"])
async def top_up_stars(
    payload: StarTopUpRequest, session: SessionDep, me: CurrentUser
) -> WalletOut:
    if not ENABLE_INTERNAL_LEDGER_TOPUPS:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Подключите платёжного провайдера для пополнений",
        )
    wallet = await _wallet_for_update(session, me.id)
    _ledger_change(
        session,
        wallet,
        payload.amount,
        kind="top_up",
        description="Пополнение Stars через внутренний баланс аккаунта",
        correlation_id=uuid.uuid4(),
    )
    await session.commit()
    return WalletOut(balance=wallet.balance, updated_at=wallet.updated_at)


# The shop. 100 stars for 5 Telegram Stars is the base rate — twenty of ours for one of theirs —
# and a bigger pack buys them cheaper, which is the only honest reason to offer one.
STAR_PACKAGES: tuple[tuple[str, int, int], ...] = (
    ("starter", 100, 5),
    ("plus", 250, 12),
    ("crew", 500, 23),
    ("pro", 1000, 44),
    ("patron", 2500, 105),
    ("legend", 5000, 200),
    ("whale", 10_000, 380),
)
BASE_STARS_PER_XTR = STAR_PACKAGES[0][1] / STAR_PACKAGES[0][2]


def _package_out(slug: str, stars: int, price_xtr: int) -> StarPackageOut:
    rate = stars / price_xtr
    return StarPackageOut(
        slug=slug,
        stars=stars,
        price_xtr=price_xtr,
        per_xtr=int(rate),
        bonus_percent=round(rate / BASE_STARS_PER_XTR * 100) - 100,
        # One star, one unit of fiat: 5 ★ is 5 ₴. The two rails therefore cost about the same and
        # neither is the cheap way in — a crypto discount would be an arbitrage, not a feature.
        price_fiat=float(stars),
        fiat_currency=CRYPTO_PRICE_CURRENCY,
    )


def _bot_deep_link(payload: str) -> str:
    """The link that opens our bot with this order already chosen."""
    return f"https://t.me/{TELEGRAM_BOT_USERNAME}?start={payload}"


def _order_expired(order: StarPurchase) -> bool:
    """An unpaid order stops being openable so a stale link cannot be revived later."""
    if order.status != "pending":
        return False
    return _as_utc(order.created_at) + timedelta(minutes=STAR_ORDER_TTL_MINUTES) < utcnow()


def _refund_out(refund: StarRefund) -> StarRefundOut:
    return StarRefundOut(
        id=refund.id,
        purchase_id=refund.purchase_id,
        status=cast(
            "Literal['pending', 'approved', 'declined', 'failed']", refund.status
        ),
        reason=refund.reason,
        admin_note=refund.admin_note,
        requested_at=refund.requested_at,
        decided_at=refund.decided_at,
    )


def _refund_block(  # noqa: PLR0911 - one refusal per condition reads better than a nested tree
    order: StarPurchase, balance: int, refund: StarRefund | None
) -> str | None:
    """
    Why this payment cannot be handed back — or None when it can.

    Three conditions, and each is a sentence a buyer can act on. The balance one is the honest
    version of "unused": stars are fungible, so the only thing anybody can say for certain is
    whether the credited amount is still there.
    """
    if order.status == "refunded":
        return "Этот платёж уже возвращён"
    if order.status == "paid_out":
        return "Этот платёж уже использован для вывода звёзд"
    if order.status != "paid" or order.paid_at is None:
        return "Возврат возможен только для оплаченного заказа"
    if refund is not None and refund.status == "pending":
        return "Заявка уже отправлена — ждёт решения администратора"
    if refund is not None and refund.status == "approved":
        return "Возврат уже одобрен"
    deadline = _as_utc(order.paid_at) + timedelta(days=REFUND_WINDOW_DAYS)
    if deadline < utcnow():
        return f"Срок возврата истёк — он составляет {REFUND_WINDOW_DAYS} дней с оплаты"
    if balance < order.stars:
        return (
            f"Звёзды уже израсходованы: для возврата на балансе должно остаться "
            f"не меньше {order.stars} ★, сейчас {balance} ★"
        )
    return None


def _purchase_out(
    order: StarPurchase, *, balance: int | None = None, refund: StarRefund | None = None
) -> StarPurchaseOut:
    blocked = (
        "Возврат оформляется в чеке операции"
        if balance is None
        else _refund_block(order, balance, refund)
    )
    return StarPurchaseOut(
        id=order.id,
        package_slug=order.package_slug,
        stars=order.stars,
        price_xtr=order.price_xtr,
        status=cast(
            "Literal['pending', 'paid', 'cancelled', 'expired', 'refunded', 'paid_out']",
            "expired" if _order_expired(order) else order.status,
        ),
        bot_url=_bot_deep_link(order.payload),
        created_at=order.created_at,
        paid_at=order.paid_at,
        telegram_charge_id=order.telegram_charge_id,
        refundable=balance is not None and blocked is None,
        refund_blocked_reason=blocked,
        refund=_refund_out(refund) if refund else None,
    )


async def _purchase_refund(session: AsyncSession, order_id: uuid.UUID) -> StarRefund | None:
    """The refund that matters for an order: the newest one, whatever came of it."""
    return await session.scalar(
        select(StarRefund)
        .where(StarRefund.purchase_id == order_id)
        .order_by(StarRefund.requested_at.desc())
        .limit(1)
    )


@app.get("/api/stars/packages", response_model=list[StarPackageOut], tags=["Stars"])
async def read_star_packages(me: CurrentUser) -> list[StarPackageOut]:
    """What a top-up costs in Telegram Stars. Prices are ours, the charge is Telegram's."""
    del me
    return [_package_out(*package) for package in STAR_PACKAGES]


@app.post(
    "/api/stars/orders",
    response_model=StarPurchaseOut,
    status_code=status.HTTP_201_CREATED,
    tags=["Stars"],
)
async def create_star_order(
    payload: StarPurchaseCreate, session: SessionDep, me: CurrentUser
) -> StarPurchaseOut:
    """
    Open an order and hand back the link that pays for it.

    Nothing is credited here. The row is a promise the bot can verify: it carries the amount, the
    price and a token nobody can guess, so what the buyer sees in Telegram cannot disagree with
    what the site will grant.

    A second tap on the same pack reuses the order that is already open rather than littering the
    list with links that all mean the same thing.
    """
    package = next((item for item in STAR_PACKAGES if item[0] == payload.package), None)
    if package is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Такого набора нет")
    slug, stars, price_xtr = package
    open_orders = (
        await session.scalars(
            select(StarPurchase)
            .where(
                StarPurchase.user_id == me.id,
                StarPurchase.package_slug == slug,
                StarPurchase.status == "pending",
            )
            .order_by(StarPurchase.created_at.desc())
        )
    ).all()
    for existing in open_orders:
        if not _order_expired(existing):
            return _purchase_out(existing)
    order = StarPurchase(
        user_id=me.id,
        package_slug=slug,
        stars=stars,
        price_xtr=price_xtr,
        payload=secrets.token_urlsafe(18)[:24],
    )
    session.add(order)
    await session.commit()
    await session.refresh(order)
    return _purchase_out(order)


@app.get("/api/stars/orders", response_model=list[StarPurchaseOut], tags=["Stars"])
async def read_star_orders(
    session: SessionDep, me: CurrentUser, limit: Annotated[int, Query(ge=1, le=50)] = 10
) -> list[StarPurchaseOut]:
    """This account's recent orders, newest first — where an unfinished payment is picked up."""
    orders = (
        await session.scalars(
            select(StarPurchase)
            .where(StarPurchase.user_id == me.id)
            .order_by(StarPurchase.created_at.desc())
            .limit(limit)
        )
    ).all()
    refunds = await _refunds_for(session, [order.id for order in orders])
    balance = await _wallet_balance(session, me.id)
    return [
        _purchase_out(order, balance=balance, refund=refunds.get(order.id)) for order in orders
    ]


async def _wallet_balance(session: AsyncSession, user_id: uuid.UUID) -> int:
    return int(
        await session.scalar(select(StarWallet.balance).where(StarWallet.user_id == user_id)) or 0
    )


async def _refunds_for(
    session: AsyncSession, order_ids: list[uuid.UUID]
) -> dict[uuid.UUID, StarRefund]:
    """The newest refund per order, in one query rather than one per row."""
    if not order_ids:
        return {}
    rows = (
        await session.scalars(
            select(StarRefund)
            .where(StarRefund.purchase_id.in_(set(order_ids)))
            .order_by(StarRefund.requested_at)
        )
    ).all()
    # Ascending order, so the last write per purchase wins and the newest one survives.
    return {refund.purchase_id: refund for refund in rows}


@app.get("/api/stars/orders/{order_id}", response_model=StarPurchaseOut, tags=["Stars"])
async def read_star_order(
    order_id: uuid.UUID, session: SessionDep, me: CurrentUser
) -> StarPurchaseOut:
    """One order: polled while the buyer pays, and read again by its receipt afterwards."""
    order = await session.get(StarPurchase, order_id)
    if order is None or order.user_id != me.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Заказ не найден")
    return _purchase_out(
        order,
        balance=await _wallet_balance(session, me.id),
        refund=await _purchase_refund(session, order.id),
    )


@app.post(
    "/api/stars/orders/{order_id}/refund",
    response_model=StarPurchaseOut,
    status_code=status.HTTP_201_CREATED,
    tags=["Stars"],
)
async def request_star_refund(
    order_id: uuid.UUID, payload: StarRefundRequest, session: SessionDep, me: CurrentUser
) -> StarPurchaseOut:
    """
    Ask for a payment back.

    Nothing is decided here and nothing moves: the request goes to an admin in Telegram with the
    buyer's own reason attached. The conditions are checked now *and* again when the admin answers,
    because a two-week window closes and a balance can be spent in between.
    """
    order = await session.scalar(
        select(StarPurchase).where(StarPurchase.id == order_id).with_for_update()
    )
    if order is None or order.user_id != me.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Заказ не найден")
    balance = await _wallet_balance(session, me.id)
    existing = await _purchase_refund(session, order.id)
    blocked = _refund_block(order, balance, existing)
    if blocked is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=blocked)
    refund = StarRefund(purchase_id=order.id, user_id=me.id, reason=payload.reason)
    session.add(refund)
    await session.commit()
    await session.refresh(refund)
    await session.refresh(order)
    return _purchase_out(order, balance=balance, refund=refund)


@app.delete("/api/stars/orders/{order_id}", response_model=DetailResponse, tags=["Stars"])
async def cancel_star_order(
    order_id: uuid.UUID, session: SessionDep, me: CurrentUser
) -> DetailResponse:
    """Close an order the buyer walked away from, so its link stops working at once."""
    order = await session.scalar(
        select(StarPurchase).where(StarPurchase.id == order_id).with_for_update()
    )
    if order is None or order.user_id != me.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Заказ не найден")
    if order.status == "paid":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Этот заказ уже оплачен"
        )
    order.status = "cancelled"
    await session.commit()
    return DetailResponse(detail="Заказ отменён")


async def require_bot(
    secret: Annotated[str | None, Header(alias="X-Bot-Secret")] = None,
) -> None:
    """
    The bot's own credential.

    A shared secret rather than a session: the bot acts for Telegram's payment, not for a
    signed-in reader, and it must be able to credit an account nobody is currently logged into.
    """
    if not secret or not secrets.compare_digest(secret, BOT_API_SECRET):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Бот не авторизован"
        )


BotAuth = Annotated[None, Depends(require_bot)]


@app.get("/api/bot/orders/{payload}", response_model=BotOrderOut, tags=["Stars"])
async def bot_read_order(payload: str, session: SessionDep, _: BotAuth) -> BotOrderOut:
    """What the bot needs before it sends an invoice: the amount, the price and who is buying."""
    order = await session.scalar(
        select(StarPurchase).where(StarPurchase.payload == payload.strip())
    )
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Заказ не найден")
    buyer = await session.get(User, order.user_id)
    if buyer is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Покупатель не найден")
    return BotOrderOut(
        payload=order.payload,
        stars=order.stars,
        price_xtr=order.price_xtr,
        status="expired" if _order_expired(order) else order.status,
        buyer_username=buyer.username,
        buyer_display_name=buyer.display_name,
    )


@app.post("/api/bot/orders/{payload}/paid", response_model=DetailResponse, tags=["Stars"])
async def bot_report_payment(
    payload: str, body: BotPaymentReport, session: SessionDep, _: BotAuth
) -> DetailResponse:
    """
    Credit an order Telegram has charged for.

    Idempotent on the charge id, because Telegram re-delivers a successful payment when it is not
    sure the bot saw it, and paying once must credit once.
    """
    order = await session.scalar(
        select(StarPurchase).where(StarPurchase.payload == payload.strip()).with_for_update()
    )
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Заказ не найден")
    if order.telegram_charge_id == body.telegram_charge_id:
        return DetailResponse(detail="already_credited")
    if order.status == "paid":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Заказ уже оплачен другим платежом"
        )
    if order.status != "pending" or _order_expired(order):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Заказ закрыт — оформите новый"
        )
    if body.amount_xtr != order.price_xtr:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Оплачено {body.amount_xtr} XTR вместо {order.price_xtr}",
        )
    wallet = await _wallet_for_update(session, order.user_id)
    _ledger_change(
        session,
        wallet,
        order.stars,
        kind="stars_telegram",
        description=f"Покупка {order.stars} ★ за {order.price_xtr} Telegram Stars",
        correlation_id=uuid.uuid4(),
        entity_type="star_purchase",
        entity_id=str(order.id),
    )
    order.status = "paid"
    order.paid_at = utcnow()
    order.telegram_user_id = body.telegram_user_id
    order.telegram_charge_id = body.telegram_charge_id
    session.add(
        Notification(
            user_id=order.user_id,
            kind=NotificationKind.STARS,
            text=f"Зачислено {order.stars} ★ — оплата {order.price_xtr} Telegram Stars",
            entity_id=str(order.id),
        )
    )
    await session.commit()
    return DetailResponse(detail="credited")


def _bot_refund_out(refund: StarRefund, order: StarPurchase, buyer: User) -> BotRefundOut:
    return BotRefundOut(
        id=refund.id,
        purchase_id=order.id,
        stars=order.stars,
        price_xtr=order.price_xtr,
        reason=refund.reason,
        buyer_username=buyer.username,
        buyer_display_name=buyer.display_name,
        telegram_user_id=order.telegram_user_id,
        telegram_charge_id=order.telegram_charge_id,
        requested_at=refund.requested_at,
    )


async def _refund_rows(
    session: AsyncSession, *, unannounced_only: bool
) -> list[tuple[StarRefund, StarPurchase, User]]:
    query = (
        select(StarRefund, StarPurchase, User)
        .join(StarPurchase, StarPurchase.id == StarRefund.purchase_id)
        .join(User, User.id == StarRefund.user_id)
        .where(StarRefund.status == "pending")
        .order_by(StarRefund.requested_at)
    )
    if unannounced_only:
        query = query.where(StarRefund.notified_at.is_(None))
    return [tuple(row) for row in (await session.execute(query)).all()]


@app.get("/api/bot/refunds/pending", response_model=list[BotRefundOut], tags=["Stars"])
async def bot_pending_refunds(session: SessionDep, _: BotAuth) -> list[BotRefundOut]:
    """
    Requests no admin has been shown yet.

    Handing one out stamps it as announced, so a bot polling every few seconds asks an admin once
    rather than every few seconds. `/api/bot/refunds/open` is the list that does not stamp, for the
    bot's own `/refunds` command.
    """
    rows = await _refund_rows(session, unannounced_only=True)
    now = utcnow()
    for refund, _order, _buyer in rows:
        refund.notified_at = now
    await session.commit()
    return [_bot_refund_out(refund, order, buyer) for refund, order, buyer in rows]


@app.get("/api/bot/refunds/open", response_model=list[BotRefundOut], tags=["Stars"])
async def bot_open_refunds(session: SessionDep, _: BotAuth) -> list[BotRefundOut]:
    """Everything still waiting for an answer, announced or not."""
    rows = await _refund_rows(session, unannounced_only=False)
    return [_bot_refund_out(refund, order, buyer) for refund, order, buyer in rows]


async def _apply_refund_decision(  # noqa: PLR0913
    session: AsyncSession,
    refund_id: uuid.UUID,
    *,
    approved: bool,
    note: str,
    admin: User | None = None,
    admin_telegram_id: int | None = None,
) -> tuple[StarRefund, StarPurchase, BotRefundApplied]:
    """
    Apply one refund decision, wherever it was taken.

    The order matters and is the same from either side: the site debits first and Telegram refunds
    second. Refunding in Telegram first would leave a buyer holding both halves whenever the debit
    turns out to be impossible — and it can, because the balance is checked again right here, at
    the moment of the decision rather than at the moment of the request.

    Nothing is committed here. The caller adds its own audit line and commits once, so a decision
    and its record cannot come apart.
    """
    refund = await session.scalar(
        select(StarRefund).where(StarRefund.id == refund_id).with_for_update()
    )
    if refund is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Заявка не найдена")
    if refund.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="По этой заявке уже есть решение"
        )
    order = await session.scalar(
        select(StarPurchase).where(StarPurchase.id == refund.purchase_id).with_for_update()
    )
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Заказ не найден")
    refund.decided_at = utcnow()
    refund.decided_by_telegram_id = admin_telegram_id
    refund.admin_note = note.strip()[:240] or None

    if not approved:
        refund.status = "declined"
        session.add(
            Notification(
                user_id=refund.user_id,
                actor_id=admin.id if admin else None,
                kind=NotificationKind.STARS,
                text=(
                    f"Возврат {order.stars} ★ отклонён"
                    + (f": {refund.admin_note}" if refund.admin_note else "")
                ),
                entity_id=str(order.id),
            )
        )
        return (
            refund,
            order,
            BotRefundApplied(
                status="declined",
                stars=order.stars,
                price_xtr=order.price_xtr,
                telegram_user_id=order.telegram_user_id,
                telegram_charge_id=order.telegram_charge_id,
            ),
        )

    balance = await _wallet_balance(session, order.user_id)
    blocked = _refund_block(order, balance, None)
    if blocked is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=blocked)
    wallet = await _wallet_for_update(session, order.user_id)
    _ledger_change(
        session,
        wallet,
        -order.stars,
        kind="stars_refund",
        description=f"Возврат {order.stars} ★ за {order.price_xtr} Telegram Stars",
        correlation_id=uuid.uuid4(),
        entity_type="star_purchase",
        entity_id=str(order.id),
    )
    order.status = "refunded"
    refund.status = "approved"
    session.add(
        Notification(
            user_id=refund.user_id,
            actor_id=admin.id if admin else None,
            kind=NotificationKind.STARS,
            text=(
                f"Возврат одобрен: {order.price_xtr} Telegram Stars вернутся в Telegram, "
                f"{order.stars} ★ списаны с баланса"
            ),
            entity_id=str(order.id),
        )
    )
    return (
        refund,
        order,
        BotRefundApplied(
            status="approved",
            stars=order.stars,
            price_xtr=order.price_xtr,
            telegram_user_id=order.telegram_user_id,
            telegram_charge_id=order.telegram_charge_id,
        ),
    )


@app.post(
    "/api/bot/refunds/{refund_id}/decision", response_model=BotRefundApplied, tags=["Stars"]
)
async def bot_decide_refund(
    refund_id: uuid.UUID, body: BotRefundDecision, session: SessionDep, _: BotAuth
) -> BotRefundApplied:
    """
    An admin's answer taken on the bot's buttons.

    The site moves the stars here and hands back the charge, which the bot then gives to Telegram;
    `/settled` closes the loop so no approval is refunded twice.
    """
    refund, order, applied = await _apply_refund_decision(
        session,
        refund_id,
        approved=body.approved,
        note=body.note,
        admin_telegram_id=body.admin_telegram_id,
    )
    session.add(
        AdminAction(
            action="refund_approved" if body.approved else "refund_declined",
            target_type="refund",
            target_id=str(refund.id),
            target_label=f"{order.stars} ★ / {order.price_xtr} XTR",
            reason=refund.admin_note,
            details={"telegram_admin_id": body.admin_telegram_id, "source": "bot"},
        )
    )
    await session.commit()
    return applied


@app.post("/api/bot/refunds/{refund_id}/failed", response_model=DetailResponse, tags=["Stars"])
async def bot_refund_failed(
    refund_id: uuid.UUID,
    session: SessionDep,
    _: BotAuth,
    note: Annotated[str, Query(max_length=240)] = "",
) -> DetailResponse:
    """
    Telegram refused the refund after the site had already debited for it.

    The compensation exists because the two halves cannot be atomic: the stars go back on the
    balance, the order returns to paid, and both the buyer and the admin are told the truth.
    """
    refund = await session.scalar(
        select(StarRefund).where(StarRefund.id == refund_id).with_for_update()
    )
    if refund is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Заявка не найдена")
    if refund.status != "approved":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Эта заявка не была одобрена"
        )
    order = await session.scalar(
        select(StarPurchase).where(StarPurchase.id == refund.purchase_id).with_for_update()
    )
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Заказ не найден")
    wallet = await _wallet_for_update(session, order.user_id)
    _ledger_change(
        session,
        wallet,
        order.stars,
        kind="stars_refund_reversed",
        description=f"Возврат не прошёл — {order.stars} ★ снова на балансе",
        correlation_id=uuid.uuid4(),
        entity_type="star_purchase",
        entity_id=str(order.id),
    )
    order.status = "paid"
    refund.status = "failed"
    refund.admin_note = (note.strip() or "Telegram отказал в возврате")[:240]
    session.add(
        Notification(
            user_id=refund.user_id,
            kind=NotificationKind.STARS,
            text=f"Возврат не прошёл: {refund.admin_note}. {order.stars} ★ остались на балансе",
            entity_id=str(order.id),
        )
    )
    await session.commit()
    return DetailResponse(detail="reversed")


# ---------------------------------------------------------------------------------------------
# Crypto top-ups (NOWPayments).
#
# The second rail into the wallet, priced from the same packs: one site star costs one unit of
# `CRYPTO_PRICE_CURRENCY`, so 100 ★ is 100 ₴ whichever way it is paid. Three rules run through all
# of it:
#
#   1. A credit is never decided by a callback. An IPN is a nudge; the decision is our own
#      authenticated read of the payment. So the flow works with no IPN secret configured, and a
#      forged callback cannot move a balance.
#   2. A credit happens at most once, latched by `credited_at` under a row lock. A provider may
#      report `finished` to a callback, to the buyer's open tab and to an admin's refresh in the
#      same second.
#   3. A coin is only offered when the provider's live minimum allows the chosen amount. Those
#      minimums differ by two orders of magnitude between chains, so a fixed coin list sells
#      payments that cannot be made.
# ---------------------------------------------------------------------------------------------
CRYPTO_COIN_LABELS = {coin: (asset, network) for coin, asset, network in CRYPTO_COINS}


def _crypto_labels(currency: str) -> tuple[str, str]:
    """The asset and network we show for a provider ticker, or the ticker itself if unknown."""
    return CRYPTO_COIN_LABELS.get(currency, (currency.upper(), ""))


def _crypto_invoice_out(invoice: CryptoInvoice) -> CryptoInvoiceOut:
    asset, network = _crypto_labels(invoice.pay_currency)
    return CryptoInvoiceOut(
        id=invoice.id,
        package_slug=invoice.package_slug,
        stars=invoice.stars,
        price_amount=invoice.price_amount,
        price_currency=invoice.price_currency,
        pay_currency=invoice.pay_currency,
        asset_label=asset,
        network_label=invoice.network_label or network,
        pay_amount=invoice.pay_amount,
        pay_address=invoice.pay_address,
        payin_extra_id=invoice.payin_extra_id,
        status=cast(
            "Literal['pending', 'paid', 'expired', 'cancelled', 'underpaid', 'failed']",
            invoice.status,
        ),
        provider_status=invoice.provider_status,
        actually_paid=invoice.actually_paid,
        provider_note=invoice.provider_note,
        created_at=invoice.created_at,
        expires_at=_as_utc(invoice.created_at)
        + timedelta(minutes=CRYPTO_INVOICE_TTL_MINUTES),
        credited_at=invoice.credited_at,
        cancellable=invoice.status == "pending",
    )


def _crypto_invoice_expired(invoice: CryptoInvoice) -> bool:
    """A pending invoice whose window has closed. The address may still work, but we stop waiting."""
    if invoice.status != "pending":
        return False
    deadline = _as_utc(invoice.created_at) + timedelta(minutes=CRYPTO_INVOICE_TTL_MINUTES)
    return deadline < utcnow()


def _require_crypto() -> None:
    if not nowpayments.configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Оплата криптовалютой сейчас недоступна",
        )


async def _quote_coins(amount: float) -> list[CryptoCoinOut]:
    """
    Every configured coin, priced for this amount, with the ones that cannot pay it marked.

    One `estimate` and one `min-amount` per coin, run concurrently — twenty coins done serially is
    twenty round trips and a visibly slow sheet. A coin whose lookup fails is reported as
    unavailable rather than omitted: silence would look like a shorter list, not like a problem.
    """
    async def one(currency: str, asset: str, network: str) -> CryptoCoinOut:
        try:
            quote, floor = await asyncio.gather(
                nowpayments.estimate(amount, CRYPTO_PRICE_CURRENCY, currency),
                nowpayments.minimum(currency),
            )
        except nowpayments.NowPaymentsError as exc:
            return CryptoCoinOut(
                currency=currency,
                asset=asset,
                network=network,
                available=False,
                unavailable_reason=str(exc),
            )
        enough = quote.estimated_amount >= floor.min_amount
        return CryptoCoinOut(
            currency=currency,
            asset=asset,
            network=network,
            available=enough,
            estimated_amount=quote.estimated_amount,
            min_amount=floor.min_amount,
            unavailable_reason=(
                None
                if enough
                else f"Минимум для этой сети — {floor.min_amount:g} {asset}"
            ),
        )

    results = await asyncio.gather(
        *(one(currency, asset, network) for currency, asset, network in CRYPTO_COINS)
    )
    # Payable coins first, each group keeping the configured order — the cheapest networks are
    # listed first on purpose, and a person should not have to scroll past dead options.
    return sorted(results, key=lambda coin: not coin.available)


@app.get("/api/crypto/status", response_model=CryptoStatusOut, tags=["Stars"])
async def read_crypto_status(me: CurrentUser) -> CryptoStatusOut:
    """Whether crypto is switched on, and what it is priced in. Cheap enough to call on mount."""
    del me
    return CryptoStatusOut(
        enabled=nowpayments.configured(),
        price_currency=CRYPTO_PRICE_CURRENCY,
        min_payout_stars=MIN_PAYOUT_STARS,
    )


@app.get("/api/crypto/coins", response_model=list[CryptoCoinOut], tags=["Stars"])
async def read_crypto_coins(
    me: CurrentUser,
    package: Annotated[str | None, Query(max_length=32)] = None,
    stars: Annotated[int | None, Query(ge=1, le=1_000_000)] = None,
) -> list[CryptoCoinOut]:
    """
    Which coins can pay for this pack, quoted right now.

    Either a pack slug or a bare star amount — the top-up sheet has a pack, the payout sheet has an
    amount, and both need the same "can this coin move this much" answer.
    """
    del me
    _require_crypto()
    if package is not None:
        found = next((item for item in STAR_PACKAGES if item[0] == package), None)
        if found is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Такого набора нет")
        amount = float(found[1])
    elif stars is not None:
        amount = float(stars)
    else:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Укажите набор или сумму",
        )
    return await _quote_coins(amount)


@app.post(
    "/api/crypto/invoices",
    response_model=CryptoInvoiceOut,
    status_code=status.HTTP_201_CREATED,
    tags=["Stars"],
)
async def create_crypto_invoice(
    payload: CryptoInvoiceCreate, session: SessionDep, me: CurrentUser
) -> CryptoInvoiceOut:
    """
    Open a crypto payment and hand back the address to send to.

    Nothing is credited here. A second attempt at the same pack *in the same coin* returns the open
    invoice rather than a new address — a person watching two addresses for one purchase is a person
    about to pay the wrong one.
    """
    _require_crypto()
    package = next((item for item in STAR_PACKAGES if item[0] == payload.package), None)
    if package is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Такого набора нет")
    if payload.currency not in CRYPTO_COIN_LABELS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Эта монета не поддерживается",
        )
    slug, stars, _price_xtr = package
    price_amount = float(stars)

    open_rows = (
        await session.scalars(
            select(CryptoInvoice)
            .where(
                CryptoInvoice.user_id == me.id,
                CryptoInvoice.package_slug == slug,
                CryptoInvoice.pay_currency == payload.currency,
                CryptoInvoice.status == "pending",
            )
            .order_by(CryptoInvoice.created_at.desc())
        )
    ).all()
    for existing in open_rows:
        if not _crypto_invoice_expired(existing):
            return _crypto_invoice_out(existing)

    asset, network = _crypto_labels(payload.currency)
    order_id = f"gram-{uuid.uuid4().hex[:20]}"
    try:
        created = await nowpayments.create_payment(
            price_amount=price_amount,
            price_currency=CRYPTO_PRICE_CURRENCY,
            pay_currency=payload.currency,
            order_id=order_id,
            order_description=f"GRAM {stars} ★ ({slug})",
            ipn_callback_url=f"{SITE_PUBLIC_URL.rstrip('/')}/api/crypto/webhook",
        )
    except nowpayments.NowPaymentsError as exc:
        # The provider's own refusal is the most useful thing we can say. `AMOUNT_MINIMAL_ERROR` is
        # the common one and means this coin cannot move a sum this small.
        detail = (
            f"{asset} на сети «{network}» не подходит для этой суммы: {exc}"
            if exc.code == "AMOUNT_MINIMAL_ERROR"
            else str(exc)
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=detail
        ) from exc

    invoice = CryptoInvoice(
        user_id=me.id,
        package_slug=slug,
        stars=stars,
        price_amount=price_amount,
        price_currency=CRYPTO_PRICE_CURRENCY,
        pay_currency=payload.currency,
        pay_amount=created.pay_amount,
        pay_address=created.pay_address,
        payin_extra_id=created.payin_extra_id,
        network_label=network,
        order_id=order_id,
        provider_payment_id=created.payment_id,
        provider_status=created.payment_status,
    )
    session.add(invoice)
    await session.commit()
    await session.refresh(invoice)
    return _crypto_invoice_out(invoice)


async def _settle_crypto_invoice(
    session: AsyncSession, invoice_id: uuid.UUID
) -> CryptoInvoice:
    """
    Ask the provider what happened to one invoice, and credit it if it is really paid.

    This is the only place a crypto top-up credits a wallet, and every route into it — the buyer's
    poll, an IPN, an admin's refresh — goes through here. The row is locked and `credited_at` is
    checked inside that lock, so concurrent callers cannot both credit.
    """
    invoice = await session.scalar(
        select(CryptoInvoice).where(CryptoInvoice.id == invoice_id).with_for_update()
    )
    if invoice is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Счёт не найден")
    if invoice.credited_at is not None or invoice.status in {"cancelled", "expired"}:
        return invoice
    if invoice.provider_payment_id is None:
        return invoice

    try:
        remote = await nowpayments.payment(invoice.provider_payment_id)
    except nowpayments.NowPaymentsError as exc:
        # A provider outage must not mark a real payment failed. The invoice keeps waiting and the
        # note tells an admin why nothing is moving.
        invoice.provider_note = str(exc)[:400]
        await session.commit()
        return invoice

    invoice.provider_status = remote.payment_status
    invoice.actually_paid = remote.actually_paid
    if remote.pay_amount:
        invoice.pay_amount = remote.pay_amount

    if remote.is_paid:
        wallet = await _wallet_for_update(session, invoice.user_id)
        _ledger_change(
            session,
            wallet,
            invoice.stars,
            kind="crypto_top_up",
            description=(
                f"Пополнение {invoice.stars} ★ — "
                f"{invoice.pay_amount:g} {_crypto_labels(invoice.pay_currency)[0]}"
            ),
            correlation_id=uuid.uuid4(),
            entity_type="crypto_invoice",
            entity_id=str(invoice.id),
        )
        invoice.status = "paid"
        invoice.credited_at = utcnow()
        invoice.provider_note = None
        session.add(
            Notification(
                user_id=invoice.user_id,
                kind=NotificationKind.STARS,
                text=f"Крипто-оплата прошла: +{invoice.stars} ★",
                entity_id=str(invoice.id),
            )
        )
    elif remote.needs_attention:
        # A real underpayment. Crediting a fraction silently would be a lie either way, so it goes
        # to a human with the numbers attached.
        invoice.status = "underpaid"
        invoice.provider_note = (
            f"Пришло {remote.actually_paid:g} из {remote.pay_amount:g} "
            f"{_crypto_labels(invoice.pay_currency)[0]} — нужна проверка администратора"
        )
        await _notify_admins(
            session,
            f"Крипто-платёж недоплачен: {invoice.order_id} — "
            f"{remote.actually_paid:g}/{remote.pay_amount:g}",
            entity_id=str(invoice.id),
        )
    elif remote.is_dead:
        invoice.status = "failed" if remote.payment_status == "failed" else "expired"
        invoice.provider_note = f"Провайдер: {remote.payment_status}"

    await session.commit()
    await session.refresh(invoice)
    return invoice


@app.get("/api/crypto/invoices", response_model=list[CryptoInvoiceOut], tags=["Stars"])
async def read_crypto_invoices(
    session: SessionDep, me: CurrentUser, limit: Annotated[int, Query(ge=1, le=50)] = 10
) -> list[CryptoInvoiceOut]:
    """This account's crypto top-ups, newest first, with stale ones retired as they are read."""
    rows = (
        await session.scalars(
            select(CryptoInvoice)
            .where(CryptoInvoice.user_id == me.id)
            .order_by(CryptoInvoice.created_at.desc())
            .limit(limit)
        )
    ).all()
    changed = False
    for row in rows:
        if _crypto_invoice_expired(row):
            row.status = "expired"
            changed = True
    if changed:
        await session.commit()
    return [_crypto_invoice_out(row) for row in rows]


@app.get("/api/crypto/invoices/{invoice_id}", response_model=CryptoInvoiceOut, tags=["Stars"])
async def read_crypto_invoice(
    invoice_id: uuid.UUID, session: SessionDep, me: CurrentUser
) -> CryptoInvoiceOut:
    """
    One invoice, re-checked against the provider.

    This is what the payment sheet polls. Checking on read rather than only on callback is what
    makes the flow work at all without an IPN secret, and what makes it survive a lost callback.
    """
    owned = await session.get(CryptoInvoice, invoice_id)
    if owned is None or owned.user_id != me.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Счёт не найден")
    if _crypto_invoice_expired(owned):
        owned.status = "expired"
        await session.commit()
        await session.refresh(owned)
        return _crypto_invoice_out(owned)
    if owned.status == "pending" and nowpayments.configured():
        owned = await _settle_crypto_invoice(session, invoice_id)
    return _crypto_invoice_out(owned)


@app.delete("/api/crypto/invoices/{invoice_id}", response_model=CryptoInvoiceOut, tags=["Stars"])
async def cancel_crypto_invoice(
    invoice_id: uuid.UUID, session: SessionDep, me: CurrentUser
) -> CryptoInvoiceOut:
    """
    Abandon an invoice nobody has paid.

    Deliberately re-checks with the provider first: cancelling something that has just been paid
    would throw the money away, so a paid invoice refuses to be cancelled and credits instead.
    """
    owned = await session.get(CryptoInvoice, invoice_id)
    if owned is None or owned.user_id != me.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Счёт не найден")
    if owned.status == "pending" and nowpayments.configured():
        owned = await _settle_crypto_invoice(session, invoice_id)
    if owned.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Этот счёт уже нельзя отменить",
        )
    invoice = await session.scalar(
        select(CryptoInvoice).where(CryptoInvoice.id == invoice_id).with_for_update()
    )
    if invoice is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Счёт не найден")
    invoice.status = "cancelled"
    await session.commit()
    await session.refresh(invoice)
    return _crypto_invoice_out(invoice)


@app.post("/api/crypto/webhook", response_model=DetailResponse, tags=["Stars"])
async def crypto_webhook(request: Request, session: SessionDep) -> DetailResponse:
    """
    The provider's callback. A nudge, never a credit.

    Unauthenticated by necessity — NOWPayments calls it — and harmless for exactly that reason:
    the body is used only to find which invoice to re-check, and the re-check is an authenticated
    call of ours. When an IPN secret is configured the signature is verified as well and a bad one
    is refused outright; without a secret an unsigned callback still cannot do more than make us
    ask the provider a question we were going to ask anyway.
    """
    raw = await request.body()
    signature = request.headers.get("x-nowpayments-sig")
    if NOWPAYMENTS_IPN_SECRET and not nowpayments.verify_ipn(raw, signature):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Подпись не совпадает"
        )
    try:
        body = json.loads(raw or b"{}")
    except ValueError:
        body = {}
    order_id = str(body.get("order_id") or "") or None
    payment_id = str(body.get("payment_id") or "") or None
    invoice: CryptoInvoice | None = None
    if order_id:
        invoice = await session.scalar(
            select(CryptoInvoice).where(CryptoInvoice.order_id == order_id)
        )
    if invoice is None and payment_id:
        invoice = await session.scalar(
            select(CryptoInvoice).where(CryptoInvoice.provider_payment_id == payment_id)
        )
    if invoice is None:
        # Not ours, or already cleaned up. Answering 200 stops the provider from retrying forever.
        return DetailResponse(detail="ignored")
    await _settle_crypto_invoice(session, invoice.id)
    return DetailResponse(detail="ok")


# ---------------------------------------------------------------------------------------------
# Taking stars out.
#
# The shop read backwards, at the same rate: twenty of ours for one of theirs, so 100 ★ leave as
# the 5 Telegram Stars they cost. One thing makes this not a mirror image — Telegram has no API
# for *sending* Stars to a person. Only a human can do the last step, which is why every payout
# waits for an admin and why the site does the part it can do first: the stars leave the balance
# at the moment of the request, so the same stars cannot be spent while their payout is queued.
#
# Crypto withdrawals join the same queue. The destination differs — an address, a coin and a
# network instead of a Telegram handle — and so does who sends it, but the money moves in the same
# order for the same reason: the stars are withheld first, an admin decides second, and a refusal
# or a failure puts them back.
# ---------------------------------------------------------------------------------------------
PAYOUT_STARS_PER_XTR = int(BASE_STARS_PER_XTR)
MIN_PAYOUT_STARS = STAR_PACKAGES[0][1]
# Somebody with five open requests is not withdrawing, they are queueing. Held stars are real
# money out of circulation, so the queue has an end.
MAX_OPEN_PAYOUTS = 3
OPEN_PAYOUT_STATUSES = ("pending", "approved")


def _crypto_details_out(details: CryptoPayoutDetails) -> CryptoPayoutDetailsOut:
    return CryptoPayoutDetailsOut(
        currency=details.currency,
        asset_label=details.asset_label or _crypto_labels(details.currency)[0],
        network_label=details.network_label or _crypto_labels(details.currency)[1],
        address=details.address,
        extra_id=details.extra_id,
        fiat_amount=details.fiat_amount,
        fiat_currency=details.fiat_currency,
        quoted_amount=details.quoted_amount,
        quoted_at=details.quoted_at,
        tx_hash=details.tx_hash,
    )


def _payout_out(
    payout: StarPayout, crypto: CryptoPayoutDetails | None = None
) -> StarPayoutOut:
    return StarPayoutOut(
        id=payout.id,
        stars=payout.stars,
        price_xtr=payout.price_xtr,
        status=cast(
            "Literal['pending', 'approved', 'paid', 'declined', 'failed', 'cancelled']",
            payout.status,
        ),
        # Derived from the details rather than stored twice, so the rail and the destination can
        # never disagree.
        method="crypto" if crypto is not None else "telegram",
        telegram_user_id=payout.telegram_user_id,
        telegram_username=payout.telegram_username,
        crypto=_crypto_details_out(crypto) if crypto else None,
        admin_note=payout.admin_note,
        requested_at=payout.requested_at,
        decided_at=payout.decided_at,
        paid_at=payout.paid_at,
        cancellable=payout.status == "pending",
    )


async def _crypto_details_for(
    session: AsyncSession, payout_ids: list[uuid.UUID]
) -> dict[uuid.UUID, CryptoPayoutDetails]:
    """Crypto destinations for a batch of payouts, in one query rather than one per row."""
    if not payout_ids:
        return {}
    rows = (
        await session.scalars(
            select(CryptoPayoutDetails).where(
                CryptoPayoutDetails.payout_id.in_(set(payout_ids))
            )
        )
    ).all()
    return {row.payout_id: row for row in rows}


async def _known_telegram_id(session: AsyncSession, user_id: uuid.UUID) -> int | None:
    """
    The Telegram account this one has paid from.

    A payout should land where the money came from, and this is the only link the site has that
    nobody typed: the bot reported it with a charge Telegram itself confirmed.
    """
    return await session.scalar(
        select(StarPurchase.telegram_user_id)
        .where(
            StarPurchase.user_id == user_id,
            StarPurchase.telegram_user_id.is_not(None),
            # Every state a real charge can end up in. What happened to the payment afterwards —
            # refunded, or spent on a payout — does not change which Telegram account paid it.
            StarPurchase.status.in_(("paid", "refunded", "paid_out")),
        )
        .order_by(StarPurchase.created_at.desc())
        .limit(1)
    )


@app.get("/api/stars/payouts", response_model=list[StarPayoutOut], tags=["Stars"])
async def read_star_payouts(
    session: SessionDep, me: CurrentUser, limit: Annotated[int, Query(ge=1, le=50)] = 20
) -> list[StarPayoutOut]:
    """This account's withdrawal requests, newest first."""
    rows = (
        await session.scalars(
            select(StarPayout)
            .where(StarPayout.user_id == me.id)
            .order_by(StarPayout.requested_at.desc())
            .limit(limit)
        )
    ).all()
    crypto = await _crypto_details_for(session, [row.id for row in rows])
    return [_payout_out(row, crypto.get(row.id)) for row in rows]


@app.get("/api/stars/payouts/coins", response_model=list[CryptoCoinOut], tags=["Stars"])
async def read_payout_coins(
    me: CurrentUser, stars: Annotated[int, Query(ge=1, le=1_000_000)]
) -> list[CryptoCoinOut]:
    """
    Which coins can carry a withdrawal of this size, and what each one would send.

    The same minimum problem as a top-up, in the other direction: a network whose floor is above
    the withdrawal is a network that cannot deliver it, and finding that out after an admin has
    approved the request wastes everybody's time.
    """
    del me
    _require_crypto()
    return await _quote_coins(float(stars))


@app.post(
    "/api/stars/payouts",
    response_model=StarPayoutOut,
    status_code=status.HTTP_201_CREATED,
    tags=["Stars"],
)
async def request_star_payout(
    payload: StarPayoutCreate, session: SessionDep, me: CurrentUser
) -> StarPayoutOut:
    """
    Ask to take stars out — into Telegram, or into a crypto wallet.

    The stars are withheld here, before anybody has agreed to anything. That is deliberate: an
    admin confirming a payout an hour later must not find the balance already spent, and a person
    watching their own wallet should see the amount leave when they ask for it rather than at some
    later moment they cannot predict. A refusal, a cancellation or a failure puts it all back.

    A crypto destination is validated against the provider *before* the stars move: a bad checksum
    is a typo, and a payout that cannot be delivered should be refused while it is still a form and
    not a queued obligation.
    """
    # Closed for now, and said plainly. Refusing here rather than at the form means a request cannot
    # be queued while there is nobody to settle it: the Telegram half is done by a person, and a
    # queue that does not move is worse than a button that admits it is shut.
    if not STAR_PAYOUTS_ENABLED:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Вывод звёзд временно недоступен",
        )
    if payload.stars < MIN_PAYOUT_STARS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Минимальная сумма вывода — {MIN_PAYOUT_STARS} ★",
        )
    if payload.stars % PAYOUT_STARS_PER_XTR:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                f"Сумма должна быть кратна {PAYOUT_STARS_PER_XTR} ★ — "
                f"это ровно 1 Telegram Star"
            ),
        )
    open_requests = int(
        await session.scalar(
            select(func.count())
            .select_from(StarPayout)
            .where(
                StarPayout.user_id == me.id,
                StarPayout.status.in_(OPEN_PAYOUT_STATUSES),
            )
        )
        or 0
    )
    if open_requests >= MAX_OPEN_PAYOUTS:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Уже {open_requests} заявки в работе — дождитесь решения по ним, "
                "прежде чем открывать новую"
            ),
        )

    telegram_user_id: int | None = None
    crypto_quote: tuple[str, str, str, float] | None = None
    if payload.method == "crypto":
        _require_crypto()
        currency = payload.crypto_currency or ""
        if currency not in CRYPTO_COIN_LABELS:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Эта монета не поддерживается для вывода",
            )
        asset, network = _crypto_labels(currency)
        address = payload.crypto_address or ""
        complaint = await nowpayments.validate_address(
            address, currency, payload.crypto_extra_id
        )
        if complaint:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=(
                    f"Адрес не подходит для {asset} ({network}). "
                    "Проверьте сеть и сам адрес."
                ),
            )
        try:
            quote = await nowpayments.estimate(
                float(payload.stars), CRYPTO_PRICE_CURRENCY, currency
            )
            floor = await nowpayments.minimum(currency)
        except nowpayments.NowPaymentsError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"Не удалось рассчитать сумму вывода: {exc}",
            ) from exc
        if quote.estimated_amount < floor.min_amount:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=(
                    f"Для сети «{network}» минимум {floor.min_amount:g} {asset}, "
                    f"а {payload.stars} ★ — это {quote.estimated_amount:g} {asset}. "
                    "Выберите другую сеть или увеличьте сумму."
                ),
            )
        crypto_quote = (currency, asset, network, quote.estimated_amount)
    else:
        telegram_user_id = await _known_telegram_id(session, me.id)
        if telegram_user_id is None and not payload.telegram_username:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=(
                    "Мы не знаем ваш Telegram: укажите юзернейм или один раз купите звёзды "
                    "через бота — тогда вывод пойдёт на тот же аккаунт"
                ),
            )

    wallet = await _wallet_for_update(session, me.id)
    if wallet.balance < payload.stars:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"На балансе {wallet.balance} ★, а для вывода нужно {payload.stars} ★",
        )
    price_xtr = payload.stars // PAYOUT_STARS_PER_XTR
    payout = StarPayout(
        user_id=me.id,
        stars=payload.stars,
        price_xtr=price_xtr,
        telegram_user_id=telegram_user_id,
        telegram_username=payload.telegram_username if payload.method == "telegram" else None,
    )
    session.add(payout)
    await session.flush()

    details: CryptoPayoutDetails | None = None
    if crypto_quote is not None:
        currency, asset, network, amount = crypto_quote
        details = CryptoPayoutDetails(
            payout_id=payout.id,
            currency=currency,
            asset_label=asset,
            network_label=network,
            address=payload.crypto_address or "",
            extra_id=payload.crypto_extra_id,
            fiat_amount=float(payload.stars),
            fiat_currency=CRYPTO_PRICE_CURRENCY,
            quoted_amount=amount,
        )
        session.add(details)

    destination = (
        f"{crypto_quote[3]:g} {crypto_quote[1]} ({crypto_quote[2]})"
        if crypto_quote
        else f"{price_xtr} Telegram Stars"
    )
    _ledger_change(
        session,
        wallet,
        -payload.stars,
        kind="payout_hold",
        description=f"Заявка на вывод {payload.stars} ★ → {destination}",
        correlation_id=uuid.uuid4(),
        entity_type="star_payout",
        entity_id=str(payout.id),
    )
    await _notify_admins(
        session,
        f"Заявка на вывод: @{me.username} — {payload.stars} ★ → {destination}",
        entity_id=str(payout.id),
    )
    await session.commit()
    await session.refresh(payout)
    if details is not None:
        await session.refresh(details)
    return _payout_out(payout, details)


@app.delete("/api/stars/payouts/{payout_id}", response_model=StarPayoutOut, tags=["Stars"])
async def cancel_star_payout(
    payout_id: uuid.UUID, session: SessionDep, me: CurrentUser
) -> StarPayoutOut:
    """Take the request back while it is still waiting. The held stars return immediately."""
    payout = await session.scalar(
        select(StarPayout).where(StarPayout.id == payout_id).with_for_update()
    )
    if payout is None or payout.user_id != me.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Заявка не найдена")
    if payout.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Отменить можно только заявку, по которой ещё нет решения",
        )
    wallet = await _wallet_for_update(session, me.id)
    _ledger_change(
        session,
        wallet,
        payout.stars,
        kind="payout_cancelled",
        description=f"Заявка на вывод {payout.stars} ★ отменена",
        correlation_id=uuid.uuid4(),
        entity_type="star_payout",
        entity_id=str(payout.id),
    )
    payout.status = "cancelled"
    payout.decided_at = utcnow()
    await session.commit()
    await session.refresh(payout)
    details = await session.get(CryptoPayoutDetails, payout.id)
    return _payout_out(payout, details)


def _bot_payout_out(
    payout: StarPayout, user: User, charge: StarPurchase | None = None
) -> BotPayoutOut:
    return BotPayoutOut(
        id=payout.id,
        stars=payout.stars,
        price_xtr=payout.price_xtr,
        telegram_user_id=payout.telegram_user_id,
        telegram_username=payout.telegram_username,
        username=user.username,
        display_name=user.display_name,
        decided_at=payout.decided_at,
        auto_purchase_id=charge.id if charge else None,
        auto_charge_id=charge.telegram_charge_id if charge else None,
    )


async def _auto_payout_charge(
    session: AsyncSession, payout: StarPayout
) -> StarPurchase | None:
    """
    A charge this account paid us that is worth exactly what the payout owes.

    This is the whole trick behind an automatic withdrawal. Telegram has no call that sends Stars
    to a person, but `refundStarPayment` gives a charge back — and a charge given back is Stars
    arriving in the same account that paid them. So a payout of 5 XTR can be carried out by handing
    back a 5 XTR purchase, with nobody in the loop.

    Exactly one charge, never a combination: two refunds cannot fail as one, and a half-finished
    payout is worse than one that waits for a person. Anything without a match falls back to the
    manual path, which is why this returning None is not an error.
    """
    spoken_for = select(StarRefund.purchase_id).where(
        StarRefund.status.in_(("pending", "approved"))
    )
    return await session.scalar(
        select(StarPurchase)
        .where(
            StarPurchase.user_id == payout.user_id,
            StarPurchase.status == "paid",
            StarPurchase.price_xtr == payout.price_xtr,
            StarPurchase.telegram_charge_id.is_not(None),
            StarPurchase.payout_id.is_(None),
            StarPurchase.id.not_in(spoken_for),
        )
        # Newest first: the more recent a charge, the likelier Telegram still lets it be refunded.
        .order_by(StarPurchase.paid_at.desc())
        .limit(1)
    )


async def _approved_payout_rows(
    session: AsyncSession, *, unannounced_only: bool
) -> list[tuple[StarPayout, User]]:
    query = (
        select(StarPayout, User)
        .join(User, User.id == StarPayout.user_id)
        .where(StarPayout.status == "approved")
        .order_by(StarPayout.decided_at)
    )
    if unannounced_only:
        query = query.where(StarPayout.notified_at.is_(None))
    return [(row[0], row[1]) for row in (await session.execute(query)).all()]


@app.get("/api/bot/payouts/approved", response_model=list[BotPayoutOut], tags=["Stars"])
async def bot_approved_payouts(session: SessionDep, _: BotAuth) -> list[BotPayoutOut]:
    """
    Payouts an admin has confirmed on the site and nobody has been shown in Telegram yet.

    Handing one over stamps it, so the bot asks once instead of once per poll. Each row carries the
    charge that can carry it out on its own, when one exists: then the bot refunds that charge and
    nobody has to send anything by hand. Without one the message is an instruction to a person,
    because Telegram has no call that sends Stars to somebody.
    """
    rows = await _approved_payout_rows(session, unannounced_only=True)
    charges = {payout.id: await _auto_payout_charge(session, payout) for payout, _user in rows}
    now = utcnow()
    for payout, _user in rows:
        payout.notified_at = now
    await session.commit()
    return [_bot_payout_out(payout, user, charges.get(payout.id)) for payout, user in rows]


@app.get("/api/bot/payouts/open", response_model=list[BotPayoutOut], tags=["Stars"])
async def bot_open_payouts(session: SessionDep, _: BotAuth) -> list[BotPayoutOut]:
    """Every confirmed payout still waiting to be sent, announced or not."""
    rows = await _approved_payout_rows(session, unannounced_only=False)
    return [
        _bot_payout_out(payout, user, await _auto_payout_charge(session, payout))
        for payout, user in rows
    ]


async def _consume_charge(
    session: AsyncSession, payout: StarPayout, purchase_id: uuid.UUID
) -> None:
    """
    Mark the charge that carried out a payout as spent.

    The order matters as much here as it does in a refund: the bot has already asked Telegram for
    the money by the time this runs, so what is recorded is a fact rather than an intention. A
    charge that does not belong to this account, or is not worth what the payout owed, is refused —
    that would be a different payment being given away.
    """
    charge = await session.scalar(
        select(StarPurchase).where(StarPurchase.id == purchase_id).with_for_update()
    )
    if charge is None or charge.user_id != payout.user_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Платёж не найден у этого аккаунта"
        )
    if charge.price_xtr != payout.price_xtr:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Платёж на {charge.price_xtr} XTR не закрывает вывод "
                f"на {payout.price_xtr} XTR"
            ),
        )
    if charge.payout_id is not None or charge.status != "paid":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Этот платёж уже использован"
        )
    charge.status = "paid_out"
    charge.payout_id = payout.id


async def _settle_payout(  # noqa: PLR0913
    session: AsyncSession,
    payout_id: uuid.UUID,
    *,
    sent: bool,
    note: str,
    admin: User | None = None,
    admin_telegram_id: int | None = None,
    purchase_id: uuid.UUID | None = None,
) -> StarPayout:
    """
    The last step of a payout, from Telegram or from the panel.

    Sent is the end of it: the stars left the balance when the request was made and they are gone
    for good now. A failure is the compensation — the same amount goes back, because the site took
    it on the promise of a transfer that did not happen.

    `purchase_id` is how the bot says it settled this by handing back a charge. That charge is spent
    from then on: it is marked `paid_out`, so the refund flow can never give the same money back a
    second time.
    """
    payout = await session.scalar(
        select(StarPayout).where(StarPayout.id == payout_id).with_for_update()
    )
    if payout is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Заявка не найдена")
    if payout.status != "approved":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Отметить отправленным можно только подтверждённую заявку",
        )
    cleaned = note.strip()[:240]
    payout.admin_note = cleaned or payout.admin_note
    if admin is not None:
        payout.decided_by_id = admin.id
    if admin_telegram_id is not None:
        payout.decided_by_telegram_id = admin_telegram_id
    if sent:
        payout.status = "paid"
        payout.paid_at = utcnow()
        if purchase_id is not None:
            await _consume_charge(session, payout, purchase_id)
        session.add(
            Notification(
                user_id=payout.user_id,
                actor_id=admin.id if admin else None,
                kind=NotificationKind.STARS,
                text=f"Вывод исполнен: {payout.price_xtr} Telegram Stars отправлены"
                + (f". {cleaned}" if cleaned else ""),
                entity_id=str(payout.id),
            )
        )
    else:
        wallet = await _wallet_for_update(session, payout.user_id)
        _ledger_change(
            session,
            wallet,
            payout.stars,
            kind="payout_failed",
            description=f"Вывод не прошёл — {payout.stars} ★ снова на балансе",
            correlation_id=uuid.uuid4(),
            entity_type="star_payout",
            entity_id=str(payout.id),
        )
        payout.status = "failed"
        payout.admin_note = (cleaned or "Не удалось отправить Telegram Stars")[:240]
        session.add(
            Notification(
                user_id=payout.user_id,
                actor_id=admin.id if admin else None,
                kind=NotificationKind.STARS,
                text=(
                    f"Вывод не прошёл: {payout.admin_note}. "
                    f"{payout.stars} ★ вернулись на баланс"
                ),
                entity_id=str(payout.id),
            )
        )
    return payout


@app.post("/api/bot/payouts/{payout_id}/paid", response_model=DetailResponse, tags=["Stars"])
async def bot_payout_paid(
    payout_id: uuid.UUID, body: BotPayoutSettle, session: SessionDep, _: BotAuth
) -> DetailResponse:
    """
    The payout is out: either an admin sent the Stars by hand, or the bot handed a charge back.

    `purchase_id` distinguishes the two, and it is the automatic case that needs it — that charge
    is spent from now on and must never be refundable again.
    """
    payout = await _settle_payout(
        session,
        payout_id,
        sent=True,
        note=body.note,
        admin_telegram_id=body.admin_telegram_id,
        purchase_id=body.purchase_id,
    )
    session.add(
        AdminAction(
            action="payout_paid",
            target_type="payout",
            target_id=str(payout.id),
            target_label=f"{payout.stars} ★ → {payout.price_xtr} XTR",
            reason=payout.admin_note,
            details={
                "telegram_admin_id": body.admin_telegram_id,
                "source": "bot-auto" if body.purchase_id else "bot",
                "charge_returned": str(body.purchase_id) if body.purchase_id else None,
            },
        )
    )
    await session.commit()
    return DetailResponse(detail="paid")


@app.post("/api/bot/payouts/{payout_id}/failed", response_model=DetailResponse, tags=["Stars"])
async def bot_payout_failed(
    payout_id: uuid.UUID, body: BotPayoutSettle, session: SessionDep, _: BotAuth
) -> DetailResponse:
    """It did not go through, so the stars go back and the request says why."""
    payout = await _settle_payout(
        session,
        payout_id,
        sent=False,
        note=body.note,
        admin_telegram_id=body.admin_telegram_id,
    )
    session.add(
        AdminAction(
            action="payout_failed",
            target_type="payout",
            target_id=str(payout.id),
            target_label=f"{payout.stars} ★ → {payout.price_xtr} XTR",
            reason=payout.admin_note,
            details={"telegram_admin_id": body.admin_telegram_id, "source": "bot"},
        )
    )
    await session.commit()
    return DetailResponse(detail="reversed")


@app.get("/api/bot/refunds/approved", response_model=list[BotRefundOut], tags=["Stars"])
async def bot_approved_refunds(session: SessionDep, _: BotAuth) -> list[BotRefundOut]:
    """
    Refunds the site has already debited for and Telegram has not been asked about yet.

    This is what makes an approval in the admin panel reach Telegram at all: the panel can move
    stars, only the bot can call `refundStarPayment`. Rows leave this list when the bot reports
    back — settled on success, failed on refusal — so neither answer refunds twice.
    """
    rows = (
        await session.execute(
            select(StarRefund, StarPurchase, User)
            .join(StarPurchase, StarPurchase.id == StarRefund.purchase_id)
            .join(User, User.id == StarRefund.user_id)
            .where(
                StarRefund.status == "approved",
                StarRefund.telegram_done_at.is_(None),
                StarPurchase.telegram_charge_id.is_not(None),
            )
            .order_by(StarRefund.decided_at)
        )
    ).all()
    return [_bot_refund_out(refund, order, buyer) for refund, order, buyer in rows]


@app.post("/api/bot/refunds/{refund_id}/settled", response_model=DetailResponse, tags=["Stars"])
async def bot_refund_settled(
    refund_id: uuid.UUID,
    session: SessionDep,
    _: BotAuth,
) -> DetailResponse:
    """Telegram gave the payment back. Stamped so it is never asked for twice."""
    refund = await session.scalar(
        select(StarRefund).where(StarRefund.id == refund_id).with_for_update()
    )
    if refund is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Заявка не найдена")
    if refund.status != "approved":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Эта заявка не была одобрена"
        )
    if refund.telegram_done_at is None:
        refund.telegram_done_at = utcnow()
        await session.commit()
    return DetailResponse(detail="settled")


@app.post("/api/stars/send", response_model=StarTransferReceipt, tags=["Stars"])
async def send_stars(
    payload: StarSendRequest, session: SessionDep, me: CurrentUser
) -> StarTransferReceipt:
    recipient = await resolve_user(session, payload.to_username)
    if recipient is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Получатель не найден")
    if recipient.id == me.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Нельзя отправить Stars себе"
        )
    await refuse_if_blocked_with(session, recipient.id, me)
    post = await session.get(Post, payload.post_id) if payload.post_id else None
    if payload.post_id is not None and (post is None or post.author_id != recipient.id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Публикация не найдена или принадлежит другому автору",
        )
    wallets = (
        await session.scalars(
            select(StarWallet)
            .where(StarWallet.user_id.in_([me.id, recipient.id]))
            .order_by(StarWallet.user_id)
            .with_for_update()
        )
    ).all()
    by_user = {wallet.user_id: wallet for wallet in wallets}
    sender_wallet = by_user.get(me.id) or await _wallet_for_update(session, me.id)
    recipient_wallet = by_user.get(recipient.id) or await _wallet_for_update(session, recipient.id)
    transfer_id = uuid.uuid4()
    description = payload.message or (
        "Поддержка публикации" if post else f"Перевод для @{recipient.username}"
    )
    entity = {"entity_type": "post", "entity_id": str(post.id)} if post else {}
    _ledger_change(
        session,
        sender_wallet,
        -payload.amount,
        kind="transfer_sent",
        description=description,
        correlation_id=transfer_id,
        counterparty_id=recipient.id,
        **entity,
    )
    _ledger_change(
        session,
        recipient_wallet,
        payload.amount,
        kind="transfer_received",
        description=description,
        correlation_id=transfer_id,
        counterparty_id=me.id,
        **entity,
    )
    session.add(
        Notification(
            user_id=recipient.id,
            actor_id=me.id,
            kind=NotificationKind.STARS,
            text=(
                f"{me.display_name} поддержал(а) вашу публикацию: {payload.amount} Stars"
                if post
                else f"{me.display_name} отправил(а) вам {payload.amount} Stars"
            ),
            # A notice about support for a post opens that post; a plain transfer has only
            # the transfer to point at.
            entity_id=str(post.id) if post else str(transfer_id),
        )
    )
    await session.commit()
    return StarTransferReceipt(
        transfer_id=transfer_id,
        amount=payload.amount,
        balance=sender_wallet.balance,
        recipient=compact_user(recipient),
    )


async def render_subscription(
    session: AsyncSession, subscription: CreatorSubscription
) -> SubscriptionOut:
    subscriber = await session.get(User, subscription.subscriber_id)
    creator = await session.get(User, subscription.creator_id)
    if subscriber is None or creator is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Профиль подписки не найден"
        )
    return SubscriptionOut(
        id=subscription.id,
        subscriber=compact_user(subscriber),
        creator=compact_user(creator),
        price_stars=subscription.price_stars,
        active=subscription.active,
        started_at=subscription.started_at,
        current_period_ends=subscription.current_period_ends,
        cancelled_at=subscription.cancelled_at,
    )


@app.post("/api/users/{username}/subscribe", response_model=SubscriptionOut, tags=["subscriptions"])
async def subscribe_to_creator(
    username: str, payload: SubscriptionCreate, session: SessionDep, me: CurrentUser
) -> SubscriptionOut:
    creator = await resolve_user(session, username)
    if creator is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Автор не найден")
    if creator.id == me.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Нельзя подписаться на себя"
        )
    # Taking money for access that the block denies would be the worst kind of dead end.
    if await session.scalar(
        select(UserBlock.id).where(
            UserBlock.blocker_id == creator.id, UserBlock.blocked_id == me.id
        )
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"@{creator.username} заблокировал(а) вас",
        )
    creator_settings = await session.get(CreatorSettings, creator.id)
    if creator_settings and not creator_settings.paid_subscription_enabled:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Автор не включил платную подписку"
        )
    price = creator_settings.monthly_price if creator_settings else payload.price_stars
    subscription = await session.scalar(
        select(CreatorSubscription)
        .where(
            CreatorSubscription.subscriber_id == me.id, CreatorSubscription.creator_id == creator.id
        )
        .with_for_update()
    )
    if subscription and subscription.active:
        return await render_subscription(session, subscription)
    wallets = (
        await session.scalars(
            select(StarWallet)
            .where(StarWallet.user_id.in_([me.id, creator.id]))
            .order_by(StarWallet.user_id)
            .with_for_update()
        )
    ).all()
    by_user = {wallet.user_id: wallet for wallet in wallets}
    subscriber_wallet = by_user.get(me.id) or await _wallet_for_update(session, me.id)
    creator_wallet = by_user.get(creator.id) or await _wallet_for_update(session, creator.id)
    correlation = uuid.uuid4()
    _ledger_change(
        session,
        subscriber_wallet,
        -price,
        kind="subscription",
        description=f"Подписка на @{creator.username}",
        correlation_id=correlation,
        counterparty_id=creator.id,
        entity_type="creator",
        entity_id=str(creator.id),
    )
    _ledger_change(
        session,
        creator_wallet,
        price,
        kind="subscription_income",
        description=f"Подписка от @{me.username}",
        correlation_id=correlation,
        counterparty_id=me.id,
        entity_type="subscriber",
        entity_id=str(me.id),
    )
    now = utcnow()
    if subscription is None:
        subscription = CreatorSubscription(
            subscriber_id=me.id,
            creator_id=creator.id,
            price_stars=price,
            active=True,
            started_at=now,
            current_period_ends=now + timedelta(days=30),
        )
        session.add(subscription)
    else:
        subscription.price_stars = price
        subscription.active = True
        subscription.started_at = now
        subscription.current_period_ends = now + timedelta(days=30)
        subscription.cancelled_at = None
    session.add(
        Notification(
            user_id=creator.id,
            actor_id=me.id,
            kind=NotificationKind.SUBSCRIPTION,
            text=f"{me.display_name} оформил(а) подписку",
            entity_id=str(subscription.id),
        )
    )
    await session.commit()
    await session.refresh(subscription)
    return await render_subscription(session, subscription)


@app.delete(
    "/api/users/{username}/subscribe", response_model=SubscriptionOut, tags=["subscriptions"]
)
async def cancel_subscription(
    username: str, session: SessionDep, me: CurrentUser
) -> SubscriptionOut:
    creator = await resolve_user(session, username)
    if creator is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Автор не найден")
    subscription = await session.scalar(
        select(CreatorSubscription).where(
            CreatorSubscription.subscriber_id == me.id, CreatorSubscription.creator_id == creator.id
        )
    )
    if subscription is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Подписка не найдена")
    subscription.active = False
    subscription.cancelled_at = utcnow()
    await session.commit()
    return await render_subscription(session, subscription)


PREMIUM_PRICE_STARS = 750
PREMIUM_PRICE_FIAT = 103.99
PREMIUM_FIAT_CURRENCY = "UAH"
PREMIUM_PERIOD_DAYS = 30

# ---------------------------------------------------------------------------------------------
# What Premium actually changes.
#
# Gathered here so the sheet and the endpoints cannot disagree — a benefit list that promises
# what nothing enforces is worse than a shorter one. Two rules hold throughout:
#
# * Additive only. Every number a free account had before Premium existed is still its number;
#   Premium raises the ceiling. Nobody loses anything by somebody else paying.
# * Written, not shown. Choosing a name colour or an emoji status needs Premium; a colour already
#   chosen keeps working if the subscription lapses. Taking decoration back off a profile would be
#   a punishment, and the point of the subscription is what it lets you do.
# ---------------------------------------------------------------------------------------------
# The composer allowed 560 characters before any of this existed, so a free account gains room
# here rather than losing it, and Premium is four times that.
FREE_POST_LENGTH = 1000
PREMIUM_POST_LENGTH = 4000
FREE_POST_IMAGES = MAX_POST_IMAGES
PREMIUM_POST_IMAGES = 10
FREE_BIO_LENGTH = 280
PREMIUM_BIO_LENGTH = 560
# The cover holds four gift showcases; one of them is anyone's. `COVER_SLOTS` below names them.
COVER_SLOT_COUNT = 4
# Uploads: the same files, four times the ceiling. Nothing is transcoded here, so this is purely
# how much a reader may be asked to pull down.
PREMIUM_UPLOAD_FACTOR = 4
# How far ahead a publication may be queued.
SCHEDULE_HORIZON_DAYS = 365


async def has_premium(session: AsyncSession, user_id: uuid.UUID) -> bool:
    """One account's subscription state. The plural form exists for lists; this is the single."""
    return user_id in await premium_user_ids(session, [user_id])


async def premium_or_staff(session: AsyncSession, user: User) -> bool:
    """
    Premium, or the people who cannot buy it.

    Staff and the platform account are marked differently and are not customers of the shop, so
    gating their personalisation behind a purchase would be theatre.
    """
    return (
        user.is_admin
        or user.username.lower() == OFFICIAL_USERNAME
        or await has_premium(session, user.id)
    )


async def _require_premium(
    session: AsyncSession, user: User, detail: str, *, staff_pass: bool = True
) -> None:
    """Refuse with the reason and the price, which is what a person can act on."""
    allowed = (
        await premium_or_staff(session, user) if staff_pass else await has_premium(session, user.id)
    )
    if not allowed:
        raise HTTPException(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail=detail)


async def upload_ceiling(session: AsyncSession, user: User, base_bytes: int) -> int:
    """How large a file this account may send. Premium lifts every media ceiling by one factor."""
    return base_bytes * PREMIUM_UPLOAD_FACTOR if await has_premium(session, user.id) else base_bytes

PREMIUM_BENEFITS: tuple[tuple[str, str, str, str, bool], ...] = (
    ("subscription", "Подписка GRAM Premium", "Ежемесячная подписка: поддержка GRAM и все возможности ниже.", "crown", False),
    ("name-color", "Цвет ника", "Премиум-палитра имени в профиле, ленте и чатах. Выбранный цвет остаётся с вами и после окончания подписки.", "palette", False),
    ("premium-badge", "Premium-значок", "Фирменная звезда рядом с ником и до 7 особых галочек.", "badge-check", False),
    ("emoji-status", "Эмодзи-статус", "Эмодзи рядом с именем в профиле, ленте и чатах.", "sparkles", False),
    ("double-limits", "Расширенные лимиты", "Длиннее посты и описание, больше фото в одной публикации. Сравнение ниже.", "gauge", False),
    ("scheduled-posts", "Отложенные публикации", "Пишите сейчас — выйдет в выбранное время. Своя очередь запланированного в профиле.", "clock", False),
    ("large-files", "Большие файлы", "Вчетверо больший размер видео, документов и вложений в чатах.", "upload", False),
    ("gift-showcase", "Витрина подарков", "Подарок рядом с именем и три дополнительных места в шапке профиля.", "gift", False),
    ("streak-protection", "Защита серии", "Один пропущенный день не обнуляет серию посещений — защита применяется автоматически.", "flame", False),
    ("voice-to-text", "Голос в текст", "Расшифровка голосовых сообщений одним касанием.", "audio-lines", True),
    ("realtime-translation", "Перевод в реальном времени", "Авто-перевод постов и переписки на твой язык.", "languages", True),
    ("custom-emoji", "Кастом-эмодзи в тексте", "Анимированные и кастомные эмодзи в сообщениях и профиле.", "smile-plus", True),
    ("stories-priority", "Сторис: приоритет и невидимка", "Приоритетная загрузка, скрытый просмотр и расширенные лимиты сторис.", "video", True),
    ("chat-wallpapers", "Премиум-обои чата", "Эксклюзивные фоны Midnight, Neon и Constellation поверх обычной коллекции.", "image", False),
)

# The comparison table. Every row here is checked by an endpoint — see the constants above and
# `_require_premium` at each write — because a table nobody enforces is a false advertisement.
PREMIUM_LIMITS: tuple[tuple[str, str, int, int], ...] = (
    ("post-length", "Длина поста", FREE_POST_LENGTH, PREMIUM_POST_LENGTH),
    ("post-photos", "Фото в посте", FREE_POST_IMAGES, PREMIUM_POST_IMAGES),
    ("bio-length", "Описание профиля", FREE_BIO_LENGTH, PREMIUM_BIO_LENGTH),
    ("special-marks", "Особые галочки", FREE_BADGE_SLOTS, PREMIUM_BADGE_SLOTS),
    ("cover-gifts", "Витрины в шапке", 1, COVER_SLOT_COUNT),
    ("streak-freeze", "Защита серии, дней", 0, 1),
    (
        "video-size",
        "Видео, МБ",
        MAX_VIDEO_BYTES // (1024 * 1024),
        MAX_VIDEO_BYTES * PREMIUM_UPLOAD_FACTOR // (1024 * 1024),
    ),
    (
        "file-size",
        "Файлы, МБ",
        MAX_FILE_BYTES // (1024 * 1024),
        MAX_FILE_BYTES * PREMIUM_UPLOAD_FACTOR // (1024 * 1024),
    ),
)

PREMIUM_PAYMENT_METHODS: tuple[tuple[str, str, str, str, bool, tuple[str, ...]], ...] = (
    ("stars", "Звёзды GRAM", "Списание с внутреннего баланса — работает сразу.", "stars", True, ()),
    ("card", "Банковская карта", "Официальный карточный чекаут.", "card", False, ("Apple Pay", "Google Pay", "Visa", "MC")),
    ("crypto", "Криптовалюта", "Оплата в стейблкоинах и монетах.", "crypto", False, ("USDT TRC20", "USDT ERC20", "USDT TON", "TON", "BTC", "ETH")),
)


@app.get("/api/premium/plan", response_model=PremiumPlanOut, tags=["premium"])
async def read_premium_plan(session: SessionDep, me: CurrentUser) -> PremiumPlanOut:
    """Pricing, benefits, limits and payment options behind the Premium sheet."""
    entitlement = await session.scalar(
        select(PremiumEntitlement)
        .where(
            PremiumEntitlement.user_id == me.id,
            PremiumEntitlement.active.is_(True),
            PremiumEntitlement.expires_at > utcnow(),
        )
        .order_by(PremiumEntitlement.expires_at.desc())
    )
    wallet = await session.get(StarWallet, me.id)
    return PremiumPlanOut(
        plan="monthly",
        period_days=PREMIUM_PERIOD_DAYS,
        price_stars=PREMIUM_PRICE_STARS,
        price_fiat=PREMIUM_PRICE_FIAT,
        fiat_currency=PREMIUM_FIAT_CURRENCY,
        benefits=[
            PremiumBenefit(slug=slug, title=title, description=description, icon=icon, soon=soon)
            for slug, title, description, icon, soon in PREMIUM_BENEFITS
        ],
        limits=[
            PremiumLimit(slug=slug, title=title, free=free, premium=premium)
            for slug, title, free, premium in PREMIUM_LIMITS
        ],
        payment_methods=[
            PremiumPaymentMethod(
                slug=slug,
                title=title,
                subtitle=subtitle,
                kind=kind,
                available=available,
                badges=list(badges),
            )
            for slug, title, subtitle, kind, available, badges in PREMIUM_PAYMENT_METHODS
        ],
        # Through the helper, so a recipient sees who gave it to them here too — this sheet is
        # where somebody who was just given Premium goes looking.
        entitlement=await premium_out(session, entitlement) if entitlement else None,
        stars_balance=wallet.balance if wallet else 0,
    )


RU_MONTHS = (
    "января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря",
)


def ru_date(moment: datetime) -> str:
    """`3 сентября` — for error text a person reads, not an ISO stamp they have to decode."""
    return f"{moment.day} {RU_MONTHS[moment.month - 1]}"


async def premium_out(
    session: AsyncSession, entitlement: PremiumEntitlement
) -> PremiumEntitlementOut:
    """Entitlement plus whoever paid for it, when that was somebody else."""
    out = PremiumEntitlementOut.model_validate(entitlement)
    if entitlement.gifted_by_id:
        sender = await session.get(User, entitlement.gifted_by_id)
        if sender:
            out.gifted_by = compact_user(sender)
    return out


async def active_premium(
    session: AsyncSession, user_id: uuid.UUID, plan: str = "monthly"
) -> PremiumEntitlement | None:
    """The live entitlement for a person, or nothing. Shared by reading, buying and gifting."""
    return await session.scalar(
        select(PremiumEntitlement)
        .where(
            PremiumEntitlement.user_id == user_id,
            PremiumEntitlement.plan == plan,
            PremiumEntitlement.active.is_(True),
            PremiumEntitlement.expires_at > utcnow(),
        )
        .order_by(PremiumEntitlement.expires_at.desc())
    )


@app.get("/api/premium", response_model=PremiumEntitlementOut | None, tags=["premium"])
async def read_premium(session: SessionDep, me: CurrentUser) -> PremiumEntitlementOut | None:
    entitlement = await active_premium(session, me.id)
    return await premium_out(session, entitlement) if entitlement else None


@app.post("/api/premium/purchase", response_model=PremiumEntitlementOut, tags=["premium"])
async def purchase_premium(
    payload: PremiumPurchaseRequest, session: SessionDep, me: CurrentUser
) -> PremiumEntitlementOut:
    price = PREMIUM_PRICE_STARS
    wallet = await _wallet_for_update(session, me.id)
    _ledger_change(
        session,
        wallet,
        -price,
        kind="premium_purchase",
        description=f"GRAM Premium на {PREMIUM_PERIOD_DAYS} дней",
        correlation_id=uuid.uuid4(),
        entity_type="premium",
        entity_id=payload.plan,
    )
    now = utcnow()
    entitlement = await session.scalar(
        select(PremiumEntitlement)
        .where(PremiumEntitlement.user_id == me.id, PremiumEntitlement.plan == payload.plan)
        .with_for_update()
    )
    if entitlement and entitlement.active and _as_utc(entitlement.expires_at) > now:
        entitlement.expires_at = _as_utc(entitlement.expires_at) + timedelta(
            days=PREMIUM_PERIOD_DAYS
        )
        entitlement.cancelled_at = None
    else:
        entitlement = PremiumEntitlement(
            user_id=me.id,
            plan=payload.plan,
            price_stars=price,
            active=True,
            started_at=now,
            expires_at=now + timedelta(days=PREMIUM_PERIOD_DAYS),
            cancelled_at=None,
        )
        session.add(entitlement)
    await session.commit()
    return await premium_out(session, entitlement)


@app.post("/api/premium/gift", response_model=PremiumEntitlementOut, tags=["premium"])
async def gift_premium(
    payload: PremiumGiftRequest, session: SessionDep, me: CurrentUser
) -> PremiumEntitlementOut:
    """
    Premium bought for somebody else.

    Every refusal names what is wrong and what to do about it: a bare "не получилось" makes
    the sender guess whether they are broke, whether the handle is wrong, or whether the
    present would have been wasted because the recipient already pays for Premium.
    """
    recipient = await resolve_user(session, payload.username)
    if recipient is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Пользователя @{payload.username.strip().lstrip('@')} нет в GRAM",
        )
    if recipient.id == me.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Себе Premium не дарят — купите его обычной кнопкой",
        )
    existing = await active_premium(session, recipient.id, payload.plan)
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"У @{recipient.username} уже есть Premium до {ru_date(existing.expires_at)}",
        )
    price = PREMIUM_PRICE_STARS
    wallet = await _wallet_for_update(session, me.id)
    if wallet.balance < price:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail=f"Не хватает {price - wallet.balance} ★ — пополните кошелёк",
        )
    now = utcnow()
    correlation = uuid.uuid4()
    _ledger_change(
        session,
        wallet,
        -price,
        kind="premium_gift",
        description=f"GRAM Premium в подарок @{recipient.username}",
        correlation_id=correlation,
        counterparty_id=recipient.id,
        entity_type="premium",
        entity_id=payload.plan,
    )
    # A lapsed row is reused rather than duplicated: the unique pair is (user, plan).
    entitlement = await session.scalar(
        select(PremiumEntitlement)
        .where(
            PremiumEntitlement.user_id == recipient.id,
            PremiumEntitlement.plan == payload.plan,
        )
        .with_for_update()
    )
    if entitlement is None:
        entitlement = PremiumEntitlement(user_id=recipient.id, plan=payload.plan)
        session.add(entitlement)
    entitlement.price_stars = price
    entitlement.active = True
    entitlement.started_at = now
    entitlement.expires_at = now + timedelta(days=PREMIUM_PERIOD_DAYS)
    entitlement.cancelled_at = None
    entitlement.gifted_by_id = me.id
    session.add(
        Notification(
            user_id=recipient.id,
            actor_id=me.id,
            # `system` rather than a new enum value: the kind column is a checked varchar, and
            # `_add_missing_columns` cannot widen a CHECK, so a fresh value would reject inserts
            # on databases that already exist.
            kind=NotificationKind.SYSTEM,
            text=f"{me.display_name} подарил(а) вам GRAM Premium на {PREMIUM_PERIOD_DAYS} дней",
            entity_id=str(entitlement.id),
        )
    )
    await session.commit()
    return await premium_out(session, entitlement)


@app.get("/api/creator/settings", response_model=CreatorSettingsOut, tags=["creator"])
async def creator_settings(session: SessionDep, me: CurrentUser) -> CreatorSettingsOut:
    settings = await session.get(CreatorSettings, me.id)
    if settings is None:
        settings = CreatorSettings(user_id=me.id)
        session.add(settings)
        await session.commit()
    return CreatorSettingsOut(
        paid_subscription_enabled=settings.paid_subscription_enabled,
        monthly_price=settings.monthly_price,
    )


@app.patch("/api/creator/settings", response_model=CreatorSettingsOut, tags=["creator"])
async def update_creator_settings(
    payload: CreatorSettingsUpdate, session: SessionDep, me: CurrentUser
) -> CreatorSettingsOut:
    settings = await session.get(CreatorSettings, me.id)
    if settings is None:
        settings = CreatorSettings(user_id=me.id)
        session.add(settings)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(settings, field, value)
    await session.commit()
    return CreatorSettingsOut(
        paid_subscription_enabled=settings.paid_subscription_enabled,
        monthly_price=settings.monthly_price,
    )


@app.get("/api/creator/analytics", response_model=CreatorAnalyticsOut, tags=["creator"])
async def creator_analytics(
    session: SessionDep, me: CurrentUser, period_days: Annotated[int, Query(ge=7, le=365)] = 30
) -> CreatorAnalyticsOut:
    posts = (
        await session.scalars(
            select(Post).where(Post.author_id == me.id).order_by(Post.created_at.desc())
        )
    ).all()
    rendered = [await render_post(session, post, me, me) for post in posts]
    rendered.sort(key=lambda item: item.views_count, reverse=True)
    wallet = await _wallet_for_update(session, me.id)
    since = utcnow() - timedelta(days=period_days)
    earned = int(
        await session.scalar(
            select(func.coalesce(func.sum(StarLedger.amount), 0)).where(
                StarLedger.user_id == me.id,
                StarLedger.created_at >= since,
                StarLedger.amount > 0,
                StarLedger.kind.in_(["subscription_income", "gift_sale", "username_sale"]),
            )
        )
        or 0
    )
    views = sum(post.views_count for post in rendered)
    interactions = sum(
        post.likes_count + post.comments_count + post.reposts_count for post in rendered
    )
    points: list[CreatorSeriesPoint] = []
    for offset in range(6, -1, -1):
        point_date = datetime.now(UTC).date() - timedelta(days=offset)
        points.append(
            CreatorSeriesPoint(
                date=point_date.isoformat(),
                views=max(0, views // 7 + (6 - offset) * 17),
                followers=max(0, me.followers_count // 30 + (6 - offset) * 2),
                stars=max(0, earned // 7),
            )
        )
    sponsors = int(
        await session.scalar(
            select(func.count())
            .select_from(CreatorSubscription)
            .where(CreatorSubscription.creator_id == me.id, CreatorSubscription.active.is_(True))
        )
        or 0
    )
    return CreatorAnalyticsOut(
        period_days=period_days,
        balance=wallet.balance,
        views=views,
        followers=me.followers_count,
        earned=earned,
        engagement=round(interactions / views * 100, 2) if views else 0.0,
        posts=len(posts),
        sponsors=sponsors,
        series=points,
        top_posts=rendered[:3],
    )


async def render_community(session: AsyncSession, community: Community, me: User) -> CommunityOut:
    owner = await session.get(User, community.owner_id)
    if owner is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Владелец сообщества не найден"
        )
    # Every handle pointing here, the channel's own address first.
    handles = list(
        (
            await session.scalars(
                select(UsernameAsset.username)
                .where(UsernameAsset.community_id == community.id)
                .order_by(UsernameAsset.created_at)
            )
        ).all()
    )
    usernames = [community.slug, *[handle for handle in handles if handle != community.slug]]
    member = await session.scalar(
        select(CommunityMember).where(
            CommunityMember.community_id == community.id, CommunityMember.user_id == me.id
        )
    )
    posts_count = int(
        await session.scalar(
            select(func.count())
            .select_from(Post)
            .where(Post.community_id == community.id)
        )
        or 0
    )
    return CommunityOut(
        id=community.id,
        slug=community.slug,
        title=community.title,
        name=community.title,
        description=community.description,
        avatar_url=community.avatar_url,
        cover_url=community.cover_url,
        owner=compact_user(owner),
        category=community.category,
        location=community.location,
        website_url=community.website_url,
        is_private=community.is_private,
        is_verified=community.is_verified,
        members_count=community.members_count,
        is_member=member is not None,
        is_owner=community.owner_id == me.id,
        role=member.role if member else None,
        posts_count=posts_count,
        is_paid=False,
        monthly_price=0,
        usernames=usernames,
        created_at=community.created_at,
    )


@app.patch(
    "/api/communities/{slug}/verification", response_model=CommunityOut, tags=["communities"]
)
async def verify_community(
    slug: str, payload: CommunityVerification, session: SessionDep, me: CurrentUser
) -> CommunityOut:
    """
    Grant or withdraw a channel's tick.

    Staff only, like a person's verification: an owner who could tick their own channel would be
    ticking nothing. The refusal says so rather than pretending the route does not exist.
    """
    if not me.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Галочку выдаёт только команда GRAM",
        )
    community = await _resolve_community(session, slug)
    if community is not None:
        await session.refresh(community, with_for_update=True)
    if community is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Сообщество не найдено")
    community.is_verified = payload.verified
    await session.commit()
    await session.refresh(community)
    return await render_community(session, community, me)


@app.get("/api/communities", response_model=list[CommunityOut], tags=["communities"])
async def read_communities(
    session: SessionDep, me: CurrentUser, *, mine: bool = False
) -> list[CommunityOut]:
    """
    Every community worth showing this reader, or only the ones they own.

    `mine` is what the profile's own community picker asks for: you may put your community on
    your page, so the picker offers exactly those and nothing else.
    """
    query = select(Community).order_by(
        Community.members_count.desc(), Community.created_at.desc()
    )
    if mine:
        query = query.where(Community.owner_id == me.id)
    communities = (await session.scalars(query)).all()
    rendered: list[CommunityOut] = []
    for community in communities:
        item = await render_community(session, community, me)
        if not community.is_private or item.is_member:
            rendered.append(item)
    return rendered


@app.post(
    "/api/communities",
    response_model=CommunityOut,
    status_code=status.HTTP_201_CREATED,
    tags=["communities"],
)
async def create_community(
    payload: CommunityCreate, session: SessionDep, me: CurrentUser
) -> CommunityOut:
    # A channel's address is a handle like any other, so it cannot already be an account, another
    # channel or somebody else's collectible.
    await _refuse_taken_handle(session, payload.slug, user_id=me.id)
    community = Community(
        slug=payload.slug,
        title=payload.title.strip(),
        description=payload.description.strip(),
        category=payload.category,
        location=payload.location,
        website_url=payload.website_url,
        owner_id=me.id,
        is_private=payload.is_private,
        members_count=1,
    )
    session.add(community)
    await session.flush()
    session.add(CommunityMember(community_id=community.id, user_id=me.id, role="owner"))
    await _claim_community_handle(session, community, payload.slug, me)
    await session.commit()
    await session.refresh(community)
    return await render_community(session, community, me)


@app.get("/api/communities/{slug}", response_model=CommunityOut, tags=["communities"])
async def read_community(slug: str, session: SessionDep, me: CurrentUser) -> CommunityOut:
    community = await _resolve_community(session, slug)
    if community is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Сообщество не найдено")
    rendered = await render_community(session, community, me)
    if community.is_private and not rendered.is_member:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Это закрытое сообщество")
    return rendered


async def _resolve_community(session: AsyncSession, slug: str) -> Community | None:
    """
    A channel by its address — or by any handle pointing at it.

    An extra handle is a real address, not a decoration: a link that uses one has to open the
    channel, the same way its own slug does. The payload always names the canonical slug, so a
    page opened this way still knows where it really lives.
    """
    wanted = slug.strip().removeprefix("@").lower()
    community = await session.scalar(
        select(Community).where(func.lower(Community.slug) == wanted)
    )
    if community is not None:
        return community
    attached = await session.scalar(
        select(UsernameAsset.community_id).where(
            func.lower(UsernameAsset.username) == wanted, UsernameAsset.community_id.is_not(None)
        )
    )
    return await session.get(Community, attached) if attached else None


async def _owned_community(session: AsyncSession, slug: str, me: User) -> Community:
    """A channel the caller owns, or the right refusal."""
    community = await _resolve_community(session, slug)
    if community is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Сообщество не найдено")
    if community.owner_id != me.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Адресами канала распоряжается владелец"
        )
    return community


async def _claim_community_handle(
    session: AsyncSession, community: Community, handle: str, owner: User
) -> UsernameAsset | None:
    """
    Make sure a channel's address exists as a handle pointing at it.

    Returns nothing for an address that cannot be a handle at all: slugs may carry dashes and run
    to 48 characters, and one of those is not a username anybody could hold.
    """
    wanted = handle.strip().lower()
    if not HANDLE_SHAPE.fullmatch(wanted):
        return None
    asset = await session.scalar(
        select(UsernameAsset).where(func.lower(UsernameAsset.username) == wanted)
    )
    if asset is None:
        asset = UsernameAsset(
            username=wanted,
            owner_id=owner.id,
            community_id=community.id,
            status=UsernameStatus.RESERVED,
            currency="STARS",
            reserved_at=utcnow(),
        )
        session.add(asset)
        await session.flush()
    else:
        asset.owner_id = asset.owner_id or owner.id
        asset.community_id = community.id
        asset.status = UsernameStatus.RESERVED
        asset.price = None
        asset.listed_at = None
    session.add(
        UsernameOwnershipEvent(
            asset_id=asset.id, to_user_id=owner.id, action="community_username"
        )
    )
    return asset


@app.post(
    "/api/communities/{slug}/usernames",
    response_model=CommunityOut,
    status_code=status.HTTP_201_CREATED,
    tags=["communities"],
)
async def attach_community_username(
    slug: str, payload: CommunityUsernameAttach, session: SessionDep, me: CurrentUser
) -> CommunityOut:
    """
    Point one of my own handles at one of my own channels.

    This is the part of the market a channel takes part in: a handle bought on it can become a
    channel's address without anybody renaming anything, and it goes back to being a plain
    collectible the moment it is taken off.
    """
    community = await _owned_community(session, slug, me)
    wanted = payload.username.lower()
    asset = await session.scalar(
        select(UsernameAsset)
        .where(func.lower(UsernameAsset.username) == wanted)
        .with_for_update()
    )
    if asset is None or asset.owner_id != me.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"@{wanted} вам не принадлежит — займите или купите его на маркете",
        )
    if asset.community_id == community.id:
        return await render_community(session, community, me)
    if asset.community_id is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"@{wanted} уже указывает на другое сообщество",
        )
    if asset.status == UsernameStatus.LISTED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Снимите имя с продажи, прежде чем отдавать его каналу",
        )
    if asset.username.lower() == me.username.lower():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"@{wanted} — ваш основной юзернейм, канал не может его занять",
        )
    asset.community_id = community.id
    session.add(
        UsernameOwnershipEvent(
            asset_id=asset.id, from_user_id=me.id, to_user_id=me.id, action="community_username"
        )
    )
    await session.commit()
    await session.refresh(community)
    return await render_community(session, community, me)


@app.delete(
    "/api/communities/{slug}/usernames/{asset_id}",
    response_model=CommunityOut,
    tags=["communities"],
)
async def detach_community_username(
    slug: str, asset_id: uuid.UUID, session: SessionDep, me: CurrentUser
) -> CommunityOut:
    """Take an extra handle back. A channel's own address cannot be taken from under it."""
    community = await _owned_community(session, slug, me)
    asset = await session.scalar(
        select(UsernameAsset).where(UsernameAsset.id == asset_id).with_for_update()
    )
    if asset is None or asset.community_id != community.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Имя не найдено")
    if asset.username.lower() == community.slug.lower():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Это адрес канала — сначала сделайте основным другое имя",
        )
    asset.community_id = None
    session.add(
        UsernameOwnershipEvent(
            asset_id=asset.id, from_user_id=me.id, to_user_id=me.id, action="community_released"
        )
    )
    await session.commit()
    await session.refresh(community)
    return await render_community(session, community, me)


@app.post(
    "/api/communities/{slug}/usernames/{asset_id}/primary",
    response_model=CommunityOut,
    tags=["communities"],
)
async def set_community_primary_username(
    slug: str, asset_id: uuid.UUID, session: SessionDep, me: CurrentUser
) -> CommunityOut:
    """
    Swap which of a channel's handles is its address.

    The previous address stays attached, so links that used it keep opening the channel — unless
    it is one of those legacy slugs that also belongs to an account, in which case keeping it
    would keep the very collision this is here to end.
    """
    community = await _owned_community(session, slug, me)
    asset = await session.scalar(
        select(UsernameAsset).where(UsernameAsset.id == asset_id).with_for_update()
    )
    if asset is None or asset.owner_id != me.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Имя не найдено")
    if asset.community_id not in {None, community.id}:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Имя занято другим сообществом"
        )
    if asset.status == UsernameStatus.LISTED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Снимите имя с продажи"
        )
    previous = community.slug
    if previous.lower() == asset.username.lower():
        return await render_community(session, community, me)
    community.slug = asset.username.lower()
    asset.community_id = community.id
    if await _handle_conflict(session, previous, user_id=me.id, community_id=community.id) is None:
        await _claim_community_handle(session, community, previous, me)
    session.add(
        UsernameOwnershipEvent(
            asset_id=asset.id, from_user_id=me.id, to_user_id=me.id, action="community_primary"
        )
    )
    await session.commit()
    await session.refresh(community)
    return await render_community(session, community, me)


@app.patch("/api/communities/{slug}", response_model=CommunityOut, tags=["communities"])
async def update_community(
    slug: str, payload: CommunityUpdate, session: SessionDep, me: CurrentUser
) -> CommunityOut:
    """
    The owner's own settings for their channel.

    The slug stays fixed: it is the channel's address, and links already point at it.
    """
    community = await _resolve_community(session, slug)
    if community is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Сообщество не найдено")
    if community.owner_id != me.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Настройки канала доступны владельцу"
        )
    # Only the optional columns accept NULL; `title` and `description` are not nullable, so an
    # emptied description stays an empty string rather than breaking the row.
    nullable = {"category", "location", "website_url", "avatar_url", "cover_url"}
    for field, value in payload.model_dump(exclude_unset=True).items():
        if value == "" and field in nullable:
            setattr(community, field, None)
        elif value is not None:
            setattr(community, field, value)
    await session.commit()
    await session.refresh(community)
    return await render_community(session, community, me)


@app.post("/api/communities/{slug}/join", response_model=CommunityOut, tags=["communities"])
async def join_community(slug: str, session: SessionDep, me: CurrentUser) -> CommunityOut:
    community = await _resolve_community(session, slug)
    if community is not None:
        await session.refresh(community, with_for_update=True)
    if community is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Сообщество не найдено")
    if community.is_private:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Для закрытого сообщества нужно приглашение",
        )
    member = await session.scalar(
        select(CommunityMember).where(
            CommunityMember.community_id == community.id, CommunityMember.user_id == me.id
        )
    )
    if member is None:
        session.add(CommunityMember(community_id=community.id, user_id=me.id))
        community.members_count += 1
        await session.commit()
    return await render_community(session, community, me)


@app.delete("/api/communities/{slug}/leave", response_model=CommunityOut, tags=["communities"])
async def leave_community(slug: str, session: SessionDep, me: CurrentUser) -> CommunityOut:
    community = await _resolve_community(session, slug)
    if community is not None:
        await session.refresh(community, with_for_update=True)
    if community is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Сообщество не найдено")
    if community.owner_id == me.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Владелец не может покинуть сообщество"
        )
    member = await session.scalar(
        select(CommunityMember).where(
            CommunityMember.community_id == community.id, CommunityMember.user_id == me.id
        )
    )
    if member:
        await session.delete(member)
        community.members_count = max(1, community.members_count - 1)
        await session.commit()
    return await render_community(session, community, me)


@app.get("/api/communities/{slug}/posts", response_model=list[FeedPost], tags=["communities"])
async def community_posts(slug: str, session: SessionDep, me: CurrentUser) -> list[FeedPost]:
    """
    A channel's posts, on the same contract as every other post.

    They used to be their own thin shape — no likes, no comments, no views — which meant a
    channel's readers could not answer anything it said. Pinned first, then newest.
    """
    community = await _resolve_community(session, slug)
    if community is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Сообщество не найдено")
    rendered = await render_community(session, community, me)
    if community.is_private and not rendered.is_member:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Это закрытое сообщество")
    rows = (
        await session.execute(
            select(Post, User)
            .join(User, Post.author_id == User.id)
            .where(Post.community_id == community.id)
            # A queued channel post is nobody's to read yet, the author included.
            .where(or_(Post.publish_at.is_(None), Post.publish_at <= utcnow()))
            .order_by(
                Post.pinned_at.is_(None),
                Post.pinned_at.desc(),
                func.coalesce(Post.publish_at, Post.created_at).desc(),
            )
        )
    ).all()
    author_ids = [author.id for _, author in rows]
    premium = await premium_user_ids(session, author_ids)
    hidden = await presence_hidden_ids(session, author_ids)
    emblems = await name_gift_map(session, author_ids)
    return [
        await render_post(
            session,
            post,
            author,
            me,
            premium=premium,
            presence_hidden=hidden,
            name_gifts=emblems,
            community=community,
        )
        for post, author in rows
    ]


@app.get(
    "/api/communities/{slug}/stories", response_model=list[ProfileStoryOut], tags=["communities"]
)
async def read_community_stories(
    slug: str, session: SessionDep, me: CurrentUser
) -> list[ProfileStoryOut]:
    """Stories the channel itself published, newest first, expired ones left out."""
    del me
    community = await _resolve_community(session, slug)
    if community is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Сообщество не найдено")
    rows = (
        await session.execute(
            select(ProfileStory, User)
            .join(User, ProfileStory.author_id == User.id)
            .where(
                ProfileStory.community_id == community.id,
                or_(ProfileStory.expires_at.is_(None), ProfileStory.expires_at > utcnow()),
            )
            .order_by(ProfileStory.highlight.desc(), ProfileStory.created_at.desc())
        )
    ).all()
    return [profile_story_out(story, author) for story, author in rows]


@app.post(
    "/api/communities/{slug}/posts",
    response_model=FeedPost,
    status_code=status.HTTP_201_CREATED,
    tags=["communities"],
)
async def create_community_post(
    slug: str, payload: PostCreate, session: SessionDep, me: CurrentUser
) -> FeedPost:
    """
    Publish into a channel.

    The payload is the same as a personal post's — pictures, a link card, a pasted music link —
    because a channel post is a post. Only its owner writes in it: members read, subscribe and
    gift, and the reference offers them no composer at all.
    """
    community = await _resolve_community(session, slug)
    if community is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Сообщество не найдено")
    if community.owner_id != me.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Публиковать в сообществе может только владелец",
        )
    await _check_post_size(session, me, payload.content, payload.image_urls)
    publish_at = await _resolve_publish_at(session, me, payload.publish_at)
    gallery = [url for url in (payload.image_urls or []) if url][:PREMIUM_POST_IMAGES]
    post = Post(
        author_id=me.id,
        community_id=community.id,
        content=payload.content,
        image_url=gallery[0] if gallery else payload.image_url,
        image_urls=gallery or ([payload.image_url] if payload.image_url else None),
        video_url=payload.video_url,
        poll_options=_poll_options(payload),
        file_url=payload.file_url,
        file_name=payload.file_name,
        file_size=payload.file_size,
        sensitive=payload.sensitive,
        link_url=payload.link_url,
        link_title=(payload.link_title or None),
        music=await resolve_post_music(payload.content),
        publish_at=publish_at,
    )
    session.add(post)
    await session.commit()
    await session.refresh(post)
    return await render_post(session, post, me, me, community=community)


async def _owned_username_count(session: AsyncSession, user_id: uuid.UUID) -> int:
    """
    How many personal handles this account holds.

    Channel addresses are excluded: those belong to a community and are governed by whoever owns it,
    so counting them would let a person's own collection be squeezed out by their own channels.
    """
    return int(
        await session.scalar(
            select(func.count())
            .select_from(UsernameAsset)
            .where(
                UsernameAsset.owner_id == user_id,
                UsernameAsset.community_id.is_(None),
            )
        )
        or 0
    )


async def _refuse_username_overflow(
    session: AsyncSession, user_id: uuid.UUID, *, handle: str
) -> None:
    """
    Refuse a handle that would take an account past its cap.

    Checked before anything is written, and re-checked by every route that can add one — reserving,
    buying and accepting a transfer are three different ways to end up holding twenty-one names.
    A handle the account already owns is free: re-reserving something you hold changes nothing.
    """
    already = await session.scalar(
        select(UsernameAsset.id).where(
            func.lower(UsernameAsset.username) == handle.lower(),
            UsernameAsset.owner_id == user_id,
        )
    )
    if already is not None:
        return
    if await _owned_username_count(session, user_id) >= MAX_OWNED_USERNAMES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Больше {MAX_OWNED_USERNAMES} юзернеймов на аккаунт нельзя — "
                "освободите один из своих, чтобы занять новый"
            ),
        )


@app.get("/api/usernames", response_model=list[UsernameAssetOut], tags=["usernames"])
async def read_usernames(
    session: SessionDep,
    me: CurrentUser,
    status_filter: Annotated[UsernameStatus | None, Query(alias="status")] = None,
) -> list[UsernameAssetOut]:
    query = (
        select(UsernameAsset, User)
        .outerjoin(User, UsernameAsset.owner_id == User.id)
        .order_by(UsernameAsset.status, UsernameAsset.username)
    )
    if status_filter is not None:
        query = query.where(UsernameAsset.status == status_filter)
    rows = (await session.execute(query)).all()
    return [await render_username(session, asset, owner, me) for asset, owner in rows]


@app.post(
    "/api/usernames/reserve",
    response_model=UsernameAssetOut,
    status_code=status.HTTP_201_CREATED,
    tags=["usernames"],
)
async def reserve_username(
    payload: UsernameReserve, session: SessionDep, me: CurrentUser
) -> UsernameAssetOut:
    wanted = payload.username.lower().removeprefix("@")
    # Accounts, channels and collectibles are one namespace, and this is the gate for all three.
    await _refuse_taken_handle(session, wanted, user_id=me.id)
    # And a collection has a ceiling, checked before the row is written.
    await _refuse_username_overflow(session, me.id, handle=wanted)
    asset = await session.scalar(
        select(UsernameAsset).where(func.lower(UsernameAsset.username) == wanted).with_for_update()
    )
    if asset is not None and asset.owner_id is not None and asset.owner_id != me.id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Это имя уже занято")
    now = utcnow()
    if asset is None:
        asset = UsernameAsset(
            username=wanted,
            owner_id=me.id,
            status=UsernameStatus.RESERVED,
            currency="STARS",
            reserved_at=now,
        )
        session.add(asset)
        await session.flush()
    else:
        asset.owner_id = me.id
        asset.status = UsernameStatus.RESERVED
        asset.reserved_at = now
        asset.listed_at = None
        asset.price = None
    session.add(UsernameOwnershipEvent(asset_id=asset.id, to_user_id=me.id, action="reserved"))
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Это имя уже занято"
        ) from exc
    await session.refresh(asset)
    return await render_username(session, asset, me, me)


@app.patch("/api/usernames/{asset_id}/listing", response_model=UsernameAssetOut, tags=["usernames"])
async def update_username_listing(
    asset_id: uuid.UUID, payload: UsernameListingUpdate, session: SessionDep, me: CurrentUser
) -> UsernameAssetOut:
    asset = await session.scalar(
        select(UsernameAsset).where(UsernameAsset.id == asset_id).with_for_update()
    )
    if asset is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Имя не найдено")
    if asset.owner_id != me.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Вы не владеете этим именем"
        )
    if payload.for_sale and payload.price is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Укажите цену"
        )
    if payload.for_sale:
        # A sold handle changes hands, so what is still in use cannot be sold: the buyer would
        # own a name the seller keeps answering to.
        if asset.username.lower() == me.username.lower():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"@{asset.username} — ваш основной юзернейм. "
                "Сделайте основным другое имя, прежде чем продавать это",
            )
        community = (
            await session.get(Community, asset.community_id) if asset.community_id else None
        )
        if community is not None and community.slug.lower() == asset.username.lower():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"@{asset.username} — адрес канала «{community.title}». "
                "Сделайте основным другое имя канала, прежде чем продавать это",
            )
    asset.status = UsernameStatus.LISTED if payload.for_sale else UsernameStatus.RESERVED
    asset.price = payload.price if payload.for_sale else None
    asset.currency = "STARS"
    asset.listed_at = utcnow() if payload.for_sale else None
    # Putting a handle up for sale is a change of mind about being asked at all.
    if payload.for_sale:
        asset.offers_disabled = False
    session.add(
        UsernameOwnershipEvent(
            asset_id=asset.id,
            from_user_id=me.id,
            to_user_id=me.id,
            action="listed" if payload.for_sale else "unlisted",
            price_stars=payload.price,
        )
    )
    await session.commit()
    await session.refresh(asset)
    return await render_username(session, asset, me, me)


@app.patch("/api/usernames/{asset_id}/offers", response_model=UsernameAssetOut, tags=["usernames"])
async def update_username_offers(
    asset_id: uuid.UUID, payload: OffersToggle, session: SessionDep, me: CurrentUser
) -> UsernameAssetOut:
    """
    Say once that a handle is not for sale.

    Marking it takes the handle off the market as well: "keeping it" and "listed for sale"
    cannot both be true, and leaving a price on a handle nobody may buy invites the offers the
    owner just refused.
    """
    asset = await session.scalar(
        select(UsernameAsset).where(UsernameAsset.id == asset_id).with_for_update()
    )
    if asset is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Имя не найдено")
    if asset.owner_id != me.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Вы не владеете этим именем"
        )
    asset.offers_disabled = payload.offers_disabled
    if payload.offers_disabled:
        # Refusing offers means refusing the ones already standing, and their stars go back.
        await _release_offers(session, asset, reason="declined")
    if payload.offers_disabled and asset.status == UsernameStatus.LISTED:
        asset.status = UsernameStatus.RESERVED
        asset.price = None
        asset.listed_at = None
        session.add(
            UsernameOwnershipEvent(
                asset_id=asset.id,
                from_user_id=me.id,
                to_user_id=me.id,
                action="unlisted",
                price_stars=None,
            )
        )
    await session.commit()
    await session.refresh(asset)
    return await render_username(session, asset, me, me)


@app.post("/api/usernames/{asset_id}/acquire", response_model=UsernameAssetOut, tags=["usernames"])
@app.post("/api/usernames/{asset_id}/purchase", response_model=UsernameAssetOut, tags=["usernames"])
async def acquire_username(
    asset_id: uuid.UUID, session: SessionDep, me: CurrentUser
) -> UsernameAssetOut:
    asset = await session.scalar(
        select(UsernameAsset).where(UsernameAsset.id == asset_id).with_for_update()
    )
    if asset is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Имя не найдено")
    if asset.owner_id == me.id:
        return await render_username(session, asset, me, me)
    if asset.status != UsernameStatus.LISTED or asset.owner_id is None or asset.price is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Имя не выставлено на продажу"
        )
    seller = await session.get(User, asset.owner_id)
    if seller is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Владелец недоступен")
    # A listing written before addresses and handles became one namespace can still name a handle
    # its owner is using; the sale is refused rather than sold out from under an address.
    await _refuse_unsellable(session, asset, seller)
    # Refused before the stars move: a buyer at their ceiling must not pay for a name they cannot
    # be given.
    await _refuse_username_overflow(session, me.id, handle=asset.username)
    price = int(asset.price)
    handle = asset.username
    await _settle_username_sale(
        session, asset, seller=seller, buyer=me, price=price, action="acquired"
    )
    # Everyone else's standing bid is released: the handle they were bidding on is gone.
    await _release_offers(session, asset, reason="cancelled")
    _notify_market(
        session,
        seller.id,
        f"@{handle} продан за {price} ★ — покупатель {me.display_name}",
        actor_id=me.id,
        entity_id=str(asset.id),
    )
    await session.commit()
    await session.refresh(asset)
    return await render_username(session, asset, me, me)


async def _refuse_unsellable(session: AsyncSession, asset: UsernameAsset, seller: User) -> None:
    """A handle still serving as somebody's address cannot change hands."""
    if asset.username.lower() == seller.username.lower():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"@{asset.username} — основной юзернейм владельца, он не продаётся",
        )
    community = await session.get(Community, asset.community_id) if asset.community_id else None
    if community is not None and community.slug.lower() == asset.username.lower():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"@{asset.username} — адрес канала «{community.title}», он не продаётся",
        )


async def _settle_username_sale(  # noqa: PLR0913
    session: AsyncSession,
    asset: UsernameAsset,
    *,
    seller: User,
    buyer: User,
    price: int,
    action: str,
    held: bool = False,
) -> None:
    """
    Move a handle and its money in one go.

    `held` says the buyer's stars were already taken when they bid, so only the seller's side of
    the ledger is written — otherwise the same offer would be paid for twice.
    """
    correlation = uuid.uuid4()
    if not held:
        buyer_wallet = await _wallet_for_update(session, buyer.id)
        _ledger_change(
            session,
            buyer_wallet,
            -price,
            kind="username_purchase",
            description=f"Покупка @{asset.username}",
            correlation_id=correlation,
            counterparty_id=seller.id,
            entity_type="username",
            entity_id=str(asset.id),
        )
    seller_wallet = await _wallet_for_update(session, seller.id)
    _ledger_change(
        session,
        seller_wallet,
        price,
        kind="username_sale",
        description=f"Продажа @{asset.username}",
        correlation_id=correlation,
        counterparty_id=buyer.id,
        entity_type="username",
        entity_id=str(asset.id),
    )
    _move_username(
        session, asset, to_user=buyer, from_user_id=seller.id, action=action, price_stars=price
    )


def _move_username(  # noqa: PLR0913
    session: AsyncSession,
    asset: UsernameAsset,
    *,
    to_user: User,
    from_user_id: uuid.UUID | None,
    action: str,
    price_stars: int | None = None,
) -> None:
    """
    Hand a handle to its new owner.

    It stops pointing at the seller's channel on the way out: an address sitting in somebody
    else's collection is not one that channel can go on using.
    """
    asset.owner_id = to_user.id
    asset.community_id = None
    asset.status = UsernameStatus.RESERVED
    asset.price = None
    asset.listed_at = None
    asset.reserved_at = utcnow()
    asset.offers_disabled = False
    session.add(
        UsernameOwnershipEvent(
            asset_id=asset.id,
            from_user_id=from_user_id,
            to_user_id=to_user.id,
            action=action,
            price_stars=price_stars,
        )
    )


def _notify_market(
    session: AsyncSession,
    user_id: uuid.UUID,
    text: str,
    *,
    actor_id: uuid.UUID | None = None,
    entity_id: str | None = None,
) -> None:
    """A market event, under the kind the bell already draws for handles."""
    session.add(
        Notification(
            user_id=user_id,
            actor_id=actor_id,
            kind=NotificationKind.USERNAME,
            text=text[:240],
            entity_id=entity_id,
        )
    )


async def _release_offers(
    session: AsyncSession,
    asset: UsernameAsset,
    *,
    reason: str,
    keep_offer_id: uuid.UUID | None = None,
) -> None:
    """
    Give every standing bid its stars back.

    A bid holds real money, so it cannot simply be forgotten when the handle is sold, taken off
    the market or handed to somebody: each bidder is refunded and told why.
    """
    offers = (
        await session.scalars(
            select(UsernameOffer)
            .where(UsernameOffer.asset_id == asset.id, UsernameOffer.status == "pending")
            .with_for_update()
        )
    ).all()
    for offer in offers:
        if keep_offer_id is not None and offer.id == keep_offer_id:
            continue
        wallet = await _wallet_for_update(session, offer.bidder_id)
        _ledger_change(
            session,
            wallet,
            offer.amount_stars,
            kind="username_offer_refund",
            description=f"Возврат ставки на @{asset.username}",
            correlation_id=uuid.uuid4(),
            entity_type="username",
            entity_id=str(asset.id),
        )
        offer.status = reason
        offer.responded_at = utcnow()
        _notify_market(
            session,
            offer.bidder_id,
            f"Ставка {offer.amount_stars} ★ на @{asset.username} отменена — звёзды вернулись",
            entity_id=str(asset.id),
        )


@app.get("/api/usernames/lookup", response_model=UsernameAssetOut, tags=["usernames"])
async def lookup_username(
    session: SessionDep,
    me: CurrentUser,
    username: Annotated[str, Query(min_length=1, max_length=32)],
) -> UsernameAssetOut:
    """Ownership card for a handle, shown when a profile's `@name` is tapped."""
    wanted = username.strip().removeprefix("@").lower()
    asset = await session.scalar(
        select(UsernameAsset).where(func.lower(UsernameAsset.username) == wanted)
    )
    if asset is None:
        holder = await session.scalar(select(User).where(func.lower(User.username) == wanted))
        if holder is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Имя не найдено")
        # A handle that was never traded still belongs to its account.
        return UsernameAssetOut(
            id=uuid.uuid5(uuid.NAMESPACE_URL, f"gram:handle:{wanted}"),
            username=wanted,
            owner=compact_user(holder),
            owner_username=holder.username,
            status=UsernameStatus.RESERVED,
            rarity="common",
            price=None,
            currency="STARS",
            is_owned_by_me=holder.id == me.id,
            created_at=holder.joined_at,
            acquired_at=holder.joined_at,
            last_action="registered",
            last_action_at=holder.joined_at,
            is_primary_handle=True,
        )
    owner = await session.get(User, asset.owner_id) if asset.owner_id else None
    return await render_username(session, asset, owner, me)


@app.post("/api/usernames/{asset_id}/activate", response_model=UserProfile, tags=["usernames"])
async def activate_username(
    asset_id: uuid.UUID, session: SessionDep, me: CurrentUser
) -> UserProfile:
    """Promote an owned collectible username to the account's primary handle."""
    asset = await session.scalar(
        select(UsernameAsset).where(UsernameAsset.id == asset_id).with_for_update()
    )
    if asset is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Имя не найдено")
    if asset.owner_id != me.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Вы не владеете этим именем"
        )
    if asset.status == UsernameStatus.LISTED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Снимите имя с продажи, прежде чем сделать его основным",
        )
    if asset.community_id is not None:
        community = await session.get(Community, asset.community_id)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"@{asset.username} занят каналом «{community.title if community else ''}» — "
            "сначала отвяжите имя от канала",
        )
    if asset.username.lower() == me.username.lower():
        return await render_profile(session, me, me)
    await _refuse_taken_handle(session, asset.username, user_id=me.id)
    previous_handle = me.username
    kept = await session.scalar(
        select(UsernameAsset).where(func.lower(UsernameAsset.username) == previous_handle.lower())
    )
    if kept is None:
        kept = UsernameAsset(
            username=previous_handle,
            owner_id=me.id,
            status=UsernameStatus.RESERVED,
            currency="STARS",
            reserved_at=utcnow(),
        )
        session.add(kept)
        await session.flush()
    else:
        kept.owner_id = me.id
        kept.status = UsernameStatus.RESERVED
        kept.price = None
        kept.listed_at = None
    me.username = asset.username.lower()
    asset.status = UsernameStatus.RESERVED
    asset.price = None
    asset.listed_at = None
    session.add_all(
        [
            UsernameOwnershipEvent(asset_id=asset.id, to_user_id=me.id, action="profile_username"),
            UsernameOwnershipEvent(asset_id=kept.id, to_user_id=me.id, action="released_handle"),
        ]
    )
    await session.commit()
    await session.refresh(me)
    return await render_profile(session, me, me)


@app.get(
    "/api/usernames/{asset_id}/history", response_model=list[UsernameHistoryOut], tags=["usernames"]
)
async def username_history(
    asset_id: uuid.UUID, session: SessionDep, me: CurrentUser
) -> list[UsernameHistoryOut]:
    del me
    from_user = aliased(User)
    to_user = aliased(User)
    rows = (
        await session.execute(
            select(UsernameOwnershipEvent, from_user, to_user)
            .outerjoin(from_user, UsernameOwnershipEvent.from_user_id == from_user.id)
            .outerjoin(to_user, UsernameOwnershipEvent.to_user_id == to_user.id)
            .where(UsernameOwnershipEvent.asset_id == asset_id)
            .order_by(UsernameOwnershipEvent.created_at.desc())
        )
    ).all()
    return [
        UsernameHistoryOut(
            id=event.id,
            action=event.action,
            from_user=compact_user(source) if source else None,
            to_user=compact_user(destination) if destination else None,
            price_stars=event.price_stars,
            created_at=event.created_at,
        )
        for event, source, destination in rows
    ]


def _offer_out(
    offer: UsernameOffer, bidder: User, handle: str, me_id: uuid.UUID
) -> UsernameOfferOut:
    return UsernameOfferOut(
        id=offer.id,
        asset_id=offer.asset_id,
        username=handle,
        bidder=compact_user(bidder),
        amount_stars=offer.amount_stars,
        status=cast(
            "Literal['pending', 'accepted', 'declined', 'withdrawn', 'cancelled']", offer.status
        ),
        created_at=offer.created_at,
        responded_at=offer.responded_at,
        is_mine=offer.bidder_id == me_id,
    )


# Declared before `/api/usernames/{asset_id}/offers`: routes are matched in order, and "me" would
# otherwise be read as an id and fail as one.
@app.get("/api/usernames/me/offers", response_model=list[UsernameOfferOut], tags=["usernames"])
async def read_my_username_offers(
    session: SessionDep, me: CurrentUser
) -> list[UsernameOfferOut]:
    """Every bid this account has made, standing or settled."""
    rows = (
        await session.execute(
            select(UsernameOffer, UsernameAsset)
            .join(UsernameAsset, UsernameAsset.id == UsernameOffer.asset_id)
            .where(UsernameOffer.bidder_id == me.id)
            .order_by(UsernameOffer.created_at.desc())
        )
    ).all()
    return [_offer_out(offer, me, asset.username, me.id) for offer, asset in rows]


@app.get(
    "/api/usernames/{asset_id}/offers", response_model=list[UsernameOfferOut], tags=["usernames"]
)
async def read_username_offers(
    asset_id: uuid.UUID, session: SessionDep, me: CurrentUser
) -> list[UsernameOfferOut]:
    """Bids on a handle: its owner sees all of them, anybody else only their own."""
    asset = await session.get(UsernameAsset, asset_id)
    if asset is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Имя не найдено")
    query = (
        select(UsernameOffer, User)
        .join(User, User.id == UsernameOffer.bidder_id)
        .where(UsernameOffer.asset_id == asset.id)
        .order_by(UsernameOffer.amount_stars.desc(), UsernameOffer.created_at)
    )
    if asset.owner_id != me.id:
        query = query.where(UsernameOffer.bidder_id == me.id)
    rows = (await session.execute(query)).all()
    return [_offer_out(offer, bidder, asset.username, me.id) for offer, bidder in rows]


@app.post(
    "/api/usernames/{asset_id}/offers",
    response_model=UsernameOfferOut,
    status_code=status.HTTP_201_CREATED,
    tags=["usernames"],
)
async def make_username_offer(
    asset_id: uuid.UUID,
    payload: UsernameOfferCreate,
    session: SessionDep,
    me: CurrentUser,
) -> UsernameOfferOut:
    """
    Bid on a handle somebody owns, with the stars held until they answer.

    Held, not promised: an accepted bid that cannot be paid is worse for a seller than no bid at
    all, so the amount leaves the wallet now and comes back if the bid does not become a sale.
    """
    asset = await session.scalar(
        select(UsernameAsset).where(UsernameAsset.id == asset_id).with_for_update()
    )
    if asset is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Имя не найдено")
    if asset.owner_id is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Имя свободно — его не нужно выкупать, займите его",
        )
    if asset.owner_id == me.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Это имя уже ваше"
        )
    if asset.offers_disabled:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Владелец @{asset.username} не принимает предложения",
        )
    owner = await session.get(User, asset.owner_id)
    if owner is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Владелец недоступен")
    await _refuse_unsellable(session, asset, owner)
    standing = await session.scalar(
        select(UsernameOffer.id).where(
            UsernameOffer.asset_id == asset.id,
            UsernameOffer.bidder_id == me.id,
            UsernameOffer.status == "pending",
        )
    )
    if standing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ваша ставка уже стоит — отзовите её, чтобы предложить другую цену",
        )
    wallet = await _wallet_for_update(session, me.id)
    if wallet.balance < payload.amount:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail=f"Не хватает {payload.amount - wallet.balance} ★ — пополните кошелёк",
        )
    _ledger_change(
        session,
        wallet,
        -payload.amount,
        kind="username_offer_hold",
        description=f"Ставка на @{asset.username}",
        correlation_id=uuid.uuid4(),
        counterparty_id=owner.id,
        entity_type="username",
        entity_id=str(asset.id),
    )
    offer = UsernameOffer(asset_id=asset.id, bidder_id=me.id, amount_stars=payload.amount)
    session.add(offer)
    _notify_market(
        session,
        owner.id,
        f"Ставка {payload.amount} ★ на @{asset.username} от {me.display_name}",
        actor_id=me.id,
        entity_id=str(asset.id),
    )
    await session.commit()
    await session.refresh(offer)
    return _offer_out(offer, me, asset.username, me.id)


async def _pending_offer(
    session: AsyncSession, offer_id: uuid.UUID
) -> tuple[UsernameOffer, UsernameAsset]:
    """One standing bid with its handle, locked for the decision about to be made."""
    offer = await session.scalar(
        select(UsernameOffer).where(UsernameOffer.id == offer_id).with_for_update()
    )
    if offer is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ставка не найдена")
    if offer.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Эта ставка больше не актуальна"
        )
    asset = await session.scalar(
        select(UsernameAsset).where(UsernameAsset.id == offer.asset_id).with_for_update()
    )
    if asset is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Имя не найдено")
    return offer, asset


@app.post(
    "/api/usernames/offers/{offer_id}/accept",
    response_model=UsernameAssetOut,
    tags=["usernames"],
)
async def accept_username_offer(
    offer_id: uuid.UUID, session: SessionDep, me: CurrentUser
) -> UsernameAssetOut:
    """Take a bid. The stars are already held, so this is the seller's half plus the handover."""
    offer, asset = await _pending_offer(session, offer_id)
    if asset.owner_id != me.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Вы не владеете этим именем"
        )
    bidder = await session.get(User, offer.bidder_id)
    if bidder is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Покупатель недоступен")
    await _refuse_unsellable(session, asset, me)
    handle = asset.username
    offer.status = "accepted"
    offer.responded_at = utcnow()
    await _settle_username_sale(
        session,
        asset,
        seller=me,
        buyer=bidder,
        price=offer.amount_stars,
        action="offer_accepted",
        held=True,
    )
    await _release_offers(session, asset, reason="cancelled", keep_offer_id=offer.id)
    _notify_market(
        session,
        bidder.id,
        f"Ставка принята: @{handle} теперь ваш за {offer.amount_stars} ★",
        actor_id=me.id,
        entity_id=str(asset.id),
    )
    await session.commit()
    await session.refresh(asset)
    # Rendered with its new owner: the card the seller gets back is the truth about the handle
    # now, not about who was holding it a moment ago.
    return await render_username(session, asset, bidder, me)


@app.post(
    "/api/usernames/offers/{offer_id}/decline",
    response_model=UsernameOfferOut,
    tags=["usernames"],
)
async def decline_username_offer(
    offer_id: uuid.UUID, session: SessionDep, me: CurrentUser
) -> UsernameOfferOut:
    """Refuse a bid and give the stars back the same moment."""
    offer, asset = await _pending_offer(session, offer_id)
    if asset.owner_id != me.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Вы не владеете этим именем"
        )
    bidder = await session.get(User, offer.bidder_id)
    wallet = await _wallet_for_update(session, offer.bidder_id)
    _ledger_change(
        session,
        wallet,
        offer.amount_stars,
        kind="username_offer_refund",
        description=f"Возврат ставки на @{asset.username}",
        correlation_id=uuid.uuid4(),
        counterparty_id=me.id,
        entity_type="username",
        entity_id=str(asset.id),
    )
    offer.status = "declined"
    offer.responded_at = utcnow()
    _notify_market(
        session,
        offer.bidder_id,
        f"Ставка {offer.amount_stars} ★ на @{asset.username} отклонена — звёзды вернулись",
        actor_id=me.id,
        entity_id=str(asset.id),
    )
    await session.commit()
    await session.refresh(offer)
    return _offer_out(offer, bidder or me, asset.username, me.id)


@app.delete(
    "/api/usernames/offers/{offer_id}", response_model=DetailResponse, tags=["usernames"]
)
async def withdraw_username_offer(
    offer_id: uuid.UUID, session: SessionDep, me: CurrentUser
) -> DetailResponse:
    """Take my own bid back."""
    offer, asset = await _pending_offer(session, offer_id)
    if offer.bidder_id != me.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Это чужая ставка"
        )
    wallet = await _wallet_for_update(session, me.id)
    _ledger_change(
        session,
        wallet,
        offer.amount_stars,
        kind="username_offer_refund",
        description=f"Отзыв ставки на @{asset.username}",
        correlation_id=uuid.uuid4(),
        entity_type="username",
        entity_id=str(asset.id),
    )
    offer.status = "withdrawn"
    offer.responded_at = utcnow()
    await session.commit()
    return DetailResponse(detail=f"Ставка на @{asset.username} отозвана")


@app.post(
    "/api/usernames/{asset_id}/transfer", response_model=UsernameAssetOut, tags=["usernames"]
)
async def transfer_username(
    asset_id: uuid.UUID, payload: UsernameTransfer, session: SessionDep, me: CurrentUser
) -> UsernameAssetOut:
    """
    Hand a handle to somebody without a price.

    Standing bids are refunded on the way out: they were bids for something its owner has just
    given away, and holding somebody's stars for a handle they can no longer win is theft.
    """
    asset = await session.scalar(
        select(UsernameAsset).where(UsernameAsset.id == asset_id).with_for_update()
    )
    if asset is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Имя не найдено")
    if asset.owner_id != me.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Вы не владеете этим именем"
        )
    await _refuse_unsellable(session, asset, me)
    recipient = await resolve_user(session, payload.to_username)
    if recipient is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Такого пользователя нет")
    if recipient.id == me.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Это имя и так ваше"
        )
    _refuse_banned_recipient(recipient)
    await _refuse_closed_inbox(session, recipient, gift=False)
    # Somebody at their ceiling cannot be handed another name — a gift that overflows a collection is
    # a gift that cannot be accepted, and refusing here is kinder than failing after the transfer.
    await _refuse_username_overflow(session, recipient.id, handle=asset.username)
    handle = asset.username
    await _release_offers(session, asset, reason="cancelled")
    _move_username(session, asset, to_user=recipient, from_user_id=me.id, action="transferred")
    _notify_market(
        session,
        recipient.id,
        f"@{handle} передан вам — {me.display_name}",
        actor_id=me.id,
        entity_id=str(asset.id),
    )
    await session.commit()
    await session.refresh(asset)
    return await render_username(session, asset, recipient, me)


@app.delete("/api/usernames/{asset_id}", response_model=UsernameAssetOut, tags=["usernames"])
async def release_username(
    asset_id: uuid.UUID, session: SessionDep, me: CurrentUser
) -> UsernameAssetOut:
    """
    Give a handle up. It leaves the collection and goes back on the shelf for anyone to register.

    The counterpart of reserving one, and the only way out that does not need a willing recipient:
    a transfer needs somebody to hand the name to, and a listing needs somebody to pay for it, so
    without this a handle nobody wants is stuck in a collection forever — and it is the collection's
    twenty places that make that matter.

    The row itself survives, with its whole ownership history: a released name is meant to be found
    and taken again, and the history is what tells the next holder where it has been. Standing bids
    are refunded on the way out for the same reason a transfer refunds them — nobody's stars may be
    held for a name its owner no longer has. The profile stops advertising it because the strip only
    lists handles the account still holds.
    """
    asset = await session.scalar(
        select(UsernameAsset).where(UsernameAsset.id == asset_id).with_for_update()
    )
    if asset is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Имя не найдено")
    if asset.owner_id != me.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Вы не владеете этим именем"
        )
    # The same two names that cannot be sold cannot be dropped either: one is how this account is
    # reached, the other is how its channel is, and freeing either would strand it.
    await _refuse_unsellable(session, asset, me)
    handle = asset.username
    await _release_offers(session, asset, reason="cancelled")
    asset.owner_id = None
    asset.community_id = None
    asset.status = UsernameStatus.AVAILABLE
    asset.price = None
    asset.listed_at = None
    asset.reserved_at = None
    asset.offers_disabled = False
    session.add(
        UsernameOwnershipEvent(asset_id=asset.id, from_user_id=me.id, action="released")
    )
    # Taken off the profile as well: the list is the owner's, and a name they no longer hold is not
    # theirs to advertise. Dropping it here means the strip does not depend on the read-time filter
    # alone, and the edit sheet opens on a list that matches what the profile shows.
    if me.related_usernames:
        me.related_usernames = [
            item
            for item in me.related_usernames
            if item.strip().removeprefix("@").lower() != handle.lower()
        ]
    await session.commit()
    await session.refresh(asset)
    return await render_username(session, asset, None, me)


async def catalog_metrics(session: AsyncSession) -> tuple[dict[str, int], dict[str, list[int]]]:
    """
    Minted counts and resale asking prices per design.

    Two queries for the whole storefront rather than two per row: a 52-design shelf used to
    mean 52 round-trips before the first tile could be drawn.
    """
    minted: dict[str, int] = defaultdict(int)
    for slug in (await session.scalars(select(Gift.slug))).all():
        minted[design_slug(slug)] += 1
    resale: dict[str, list[int]] = defaultdict(list)
    listed = (
        await session.execute(
            select(Gift.slug, Gift.sale_price_stars).where(Gift.sale_price_stars.is_not(None))
        )
    ).all()
    for slug, price in listed:
        resale[design_slug(slug)].append(int(price))
    return minted, resale


def gift_model_out(
    model: GiftModel, minted: dict[str, int], resale: dict[str, list[int]]
) -> GiftModelOut:
    made = minted.get(model.slug, 0)
    remaining = max(0, model.edition_size - made)
    prices = resale.get(model.slug, [])
    pools = (
        list(model.models_pool or []),
        list(model.backdrops_pool or []),
        list(model.symbols_pool or []),
    )
    return GiftModelOut(
        id=model.id,
        slug=model.slug,
        name=model.name,
        description=model.description,
        image_url=model.image_url,
        accent=model.accent,
        rarity=model.rarity,
        price_stars=model.price_stars,
        upgrade_price_stars=(
            DESIGN_BY_SLUG[model.slug].upgrade_price_stars
            if model.slug in DESIGN_BY_SLUG
            else max(25, round(model.price_stars / 4 / 5) * 5)
        ),
        edition_size=model.edition_size,
        minted=made,
        remaining=remaining,
        limited=model.limited,
        on_market=model.on_market,
        sold_out=remaining == 0,
        art=model.art or "orb",
        pattern=model.symbol or "star",
        backdrop_edge=model.backdrop_edge or "#08080a",
        category=model.category or "classic",
        category_label=CATEGORY_LABELS.get(model.category or "", "Классика"),
        models_count=len(pools[0]),
        backdrops_count=len(pools[1]),
        symbols_count=len(pools[2]),
        resale_count=len(prices),
        resale_floor_stars=min(prices) if prices else None,
    )


RARITY_RANK = {"legendary": 0, "epic": 1, "rare": 2}


def sort_catalog(rows: list[GiftModelOut], sort: str) -> list[GiftModelOut]:
    """Storefront order. Applied in Python because rarity is a word, not a number, in SQL."""
    if sort == "price-asc":
        return sorted(rows, key=lambda row: (row.price_stars, row.name))
    if sort == "price-desc":
        return sorted(rows, key=lambda row: (-row.price_stars, row.name))
    if sort == "rarity":
        return sorted(rows, key=lambda row: (RARITY_RANK.get(row.rarity, 9), -row.price_stars))
    if sort == "supply":
        return sorted(rows, key=lambda row: (row.edition_size, row.name))
    return rows


@app.get("/api/gifts/catalog", response_model=list[GiftModelOut], tags=["gifts"])
async def read_gift_catalog(  # noqa: PLR0913
    session: SessionDep,
    me: CurrentUser,
    *,
    scope: Annotated[str, Query(pattern="^(all|market|limited|available|resale)$")] = "all",
    category: Annotated[str | None, Query(max_length=40)] = None,
    q: Annotated[str | None, Query(max_length=60, description="Search by name or slug")] = None,
    sort: Annotated[
        str, Query(pattern="^(position|price-asc|price-desc|rarity|supply)$")
    ] = "position",
) -> list[GiftModelOut]:
    """Designs available to buy, mirroring the purchase sheet's chips, search and sort."""
    del me
    query = select(GiftModel).where(GiftModel.available.is_(True))
    if scope == "market":
        query = query.where(GiftModel.on_market.is_(True))
    elif scope == "limited":
        query = query.where(GiftModel.limited.is_(True))
    if category:
        query = query.where(GiftModel.category == category.strip().lower())
    models = (
        await session.scalars(query.order_by(GiftModel.position, GiftModel.price_stars))
    ).all()
    minted, resale = await catalog_metrics(session)
    rows = [gift_model_out(model, minted, resale) for model in models]
    if scope == "available":
        rows = [row for row in rows if not row.sold_out]
    elif scope == "resale":
        rows = [row for row in rows if row.resale_count]
    if q:
        needle = q.strip().lower()
        rows = [row for row in rows if needle in row.name.lower() or needle in row.slug]
    return sort_catalog(rows, sort)


@app.get("/api/gifts/categories", response_model=list[GiftCategoryOut], tags=["gifts"])
async def read_gift_categories(session: SessionDep, me: CurrentUser) -> list[GiftCategoryOut]:
    """Shelves with a count each, so the chips can be built without loading the catalogue."""
    del me
    rows = (
        await session.execute(
            select(GiftModel.category, func.count())
            .where(GiftModel.available.is_(True))
            .group_by(GiftModel.category)
        )
    ).all()
    counts = {str(category): int(total) for category, total in rows}
    return [
        GiftCategoryOut(key=key, label=label, count=int(counts.get(key, 0)))
        for key, label in CATEGORIES
        if counts.get(key)
    ]


ART_CACHE_HEADER = "public, max-age=604800, immutable"


async def _art_response(
    kind: str, gift_ref: str, variant: str, ext: str, size: int | None
) -> Response:
    """
    Serve one cached artwork asset, fetching it once on the first request.

    `.tgs` is a gzip stream of Lottie JSON, so the cached bytes go out as `application/json`
    with `Content-Encoding: gzip`: the browser inflates it natively and the client needs no
    decompression library. Artwork is public product imagery, so this sits outside the session
    guard for the same reason `/media` does — an `<img>` or a `fetch` should just work.
    """
    if size is not None and size not in giftart.ART_SIZES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Недопустимый размер")
    resolved = giftart.resolve(kind, gift_ref, variant, ext)
    if resolved is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Артворк не найден")
    gift, name = resolved
    path = await giftart.ensure(kind, gift, name, ext, size)
    if path is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Артворк недоступен"
        )
    if ext == "png":
        return FileResponse(
            path, media_type="image/png", headers={"Cache-Control": ART_CACHE_HEADER}
        )
    return Response(
        content=path.read_bytes(),
        media_type="application/json",
        headers={"Content-Encoding": "gzip", "Cache-Control": ART_CACHE_HEADER},
    )


@app.get("/api/gifts/art/original/{gift}", tags=["gifts"])
async def gift_original_art(
    gift: str,
    ext: Annotated[str, Query(pattern="^(tgs|png)$")] = "tgs",
    size: Annotated[int | None, Query()] = None,
) -> Response:
    """The design's own sticker: what a storefront tile and a design card show."""
    return await _art_response("original", gift, "", ext, size)


@app.get("/api/gifts/art/{kind}/{gift}/{variant}", tags=["gifts"])
async def gift_variant_art(
    kind: Annotated[str, Path(pattern="^(model|symbol)$")],
    gift: str,
    variant: str,
    ext: Annotated[str, Query(pattern="^(tgs|png)$")] = "tgs",
    size: Annotated[int | None, Query()] = None,
) -> Response:
    """One rolled model, or one symbol for the pattern layer behind an item."""
    return await _art_response(kind, gift, variant, ext, size)


def market_item_out(
    gift: Gift, owner: User, collectible: GiftCollectible | None, me: User
) -> GiftMarketOut:
    return GiftMarketOut(
        gift_id=gift.id,
        slug=gift.slug,
        design_slug=design_slug(gift.slug),
        name=gift.name,
        serial_number=gift.serial_number,
        edition_size=gift.edition_size,
        rarity=gift.rarity,
        accent=gift.accent,
        backdrop_edge=gift.backdrop_edge or "#08080a",
        art=gift.art or "orb",
        pattern=gift.pattern or "star",
        image_url=gift.image_url,
        model=collectible.model if collectible else None,
        backdrop=collectible.backdrop if collectible else None,
        symbol=collectible.symbol if collectible else None,
        price_stars=gift.sale_price_stars or 0,
        value_stars=collectible.value_stars if collectible else 0,
        owner=compact_user(owner),
        listed_at=gift.listed_at,
        is_mine=gift.owner_id == me.id,
    )


async def listed_gifts(
    session: AsyncSession, me: User, *, design: str | None = None, limit: int = 60
) -> list[GiftMarketOut]:
    """Everything currently for sale outright, newest listing first."""
    query = (
        select(Gift, User, GiftCollectible)
        .join(User, Gift.owner_id == User.id)
        .outerjoin(GiftCollectible, GiftCollectible.gift_id == Gift.id)
        .where(Gift.sale_price_stars.is_not(None))
        .order_by(Gift.listed_at.desc().nullslast(), Gift.sale_price_stars)
        .limit(limit)
    )
    if design:
        query = query.where(Gift.slug.like(f"{design}-%"))
    rows = (await session.execute(query)).all()
    return [market_item_out(gift, owner, collectible, me) for gift, owner, collectible in rows]


@app.get("/api/gifts/market", response_model=list[GiftMarketOut], tags=["gifts"])
async def read_gift_market(
    session: SessionDep,
    me: CurrentUser,
    design: Annotated[str | None, Query(max_length=80, description="Filter by design")] = None,
    sort: Annotated[str, Query(pattern="^(recent|price-asc|price-desc)$")] = "recent",
    limit: Annotated[int, Query(ge=1, le=120)] = 60,
) -> list[GiftMarketOut]:
    """
    Minted items on sale at a fixed price.

    Offers ask an owner to consider a number; a listing is an answer already given, so this
    is the shelf where "купить" means one action instead of a negotiation.
    """
    items = await listed_gifts(
        session, me, design=design.strip().lower() if design else None, limit=limit
    )
    if sort == "price-asc":
        items.sort(key=lambda item: item.price_stars)
    elif sort == "price-desc":
        items.sort(key=lambda item: -item.price_stars)
    return items


def _variants(pool: list[dict[str, Any]]) -> list[GiftVariantOut]:
    """Stored pool entries are `{name, permille}`; collectors are shown a percentage."""
    return [
        GiftVariantOut(
            name=str(item.get("name", "")),
            rarity_percent=round(float(item.get("permille") or 0) / 10, 2),
        )
        for item in pool
        if item.get("name")
    ]


@app.get("/api/gifts/catalog/{slug}", response_model=GiftDesignOut, tags=["gifts"])
async def read_gift_design(slug: str, session: SessionDep, me: CurrentUser) -> GiftDesignOut:
    """One design with its variant pools and the copies other people are reselling."""
    model = await session.scalar(
        select(GiftModel).where(func.lower(GiftModel.slug) == slug.strip().lower())
    )
    if model is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Подарок не найден")
    minted, resale = await catalog_metrics(session)
    base = gift_model_out(model, minted, resale)

    def pool(stored: list[dict[str, Any]] | None, fallback: str) -> list[dict[str, Any]]:
        # A design always has real pools; the singular is only a floor so an unseeded row still
        # renders one variant instead of an empty table.
        return list(stored) if stored else [{"name": fallback, "permille": 1000.0}]

    return GiftDesignOut(
        **base.model_dump(),
        models=_variants(pool(model.models_pool, model.model_name)),
        backdrops=_variants(pool(model.backdrops_pool, model.backdrop)),
        symbols=_variants(pool(model.symbols_pool, model.symbol)),
        resale=await listed_gifts(session, me, design=model.slug, limit=40),
    )


@app.post(
    "/api/gifts/purchase",
    response_model=GiftPurchaseOut,
    status_code=status.HTTP_201_CREATED,
    tags=["gifts"],
)
async def purchase_gift(
    payload: GiftPurchaseRequest, session: SessionDep, me: CurrentUser
) -> GiftPurchaseOut:
    """
    Buy a catalogue design with Stars and mint the next serial for the recipient.

    Omitting `to_username` buys the design for yourself, which is the whole point of a
    limited edition: a collector should not have to ask someone else to hold it first.
    """
    model = await session.scalar(
        select(GiftModel)
        .where(func.lower(GiftModel.slug) == payload.slug.strip().lower())
        .with_for_update()
    )
    if model is None or not model.available:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Подарок не найден")
    recipient = me
    if payload.to_username and payload.to_username != me.username.lower():
        resolved = await resolve_user(session, payload.to_username)
        if resolved is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Получатель не найден"
            )
        _refuse_banned_recipient(resolved)
        await _refuse_closed_inbox(session, resolved, gift=True)
        recipient = resolved
    note = (payload.message or "").strip() or None
    minted: list[Gift] = []
    for _ in range(payload.quantity):
        # Each serial is minted, charged and rolled on its own, so a run of five is five real
        # items with five different models rather than one item counted five times.
        gift = await _mint_gift(
            session,
            model,
            owner=recipient,
            buyer=me,
            message=note,
            hide_sender=payload.hide_my_name,
        )
        minted.append(gift)
    if recipient.id != me.id:
        sender_label = "Кто-то" if payload.hide_my_name else me.display_name
        tail = f" ×{len(minted)}" if len(minted) > 1 else ""
        session.add(
            Notification(
                user_id=recipient.id,
                actor_id=None if payload.hide_my_name else me.id,
                kind=NotificationKind.GIFT,
                text=f"{sender_label} подарил(а) вам «{model.name}»{tail}",
                entity_id=str(minted[0].id),
            )
        )
        # A gift arrives in the conversation as its own card, not only as a notification.
        for gift in minted:
            await _gift_message(session, me, recipient, gift)
    await session.commit()
    rendered: list[GiftOut] = []
    for gift in minted:
        await session.refresh(gift)
        rendered.append(await render_gift(session, gift, recipient, me))
    return GiftPurchaseOut(
        gifts=rendered, spent_stars=model.price_stars * len(minted)
    )


async def _mint_gift(  # noqa: PLR0913
    session: AsyncSession,
    model: GiftModel,
    *,
    owner: User,
    buyer: User,
    message: str | None = None,
    hide_sender: bool = False,
    free: bool = False,
) -> Gift:
    """
    Charge the buyer and mint the next serial of `model` into `owner`'s collection.

    Shared by the storefront and by gifting inside a chat so a collectible is minted exactly
    one way: one serial, one rolled variant of each trait, one ledger entry, one hash.
    """
    minted = int(
        await session.scalar(
            select(func.count()).select_from(Gift).where(Gift.slug.like(f"{model.slug}-%"))
        )
        or 0
    )
    if minted >= model.edition_size:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Выпуск распродан")
    # Serials continue past any seeded item, so a mint can never reuse an existing slug.
    highest = int(
        await session.scalar(
            select(func.max(Gift.serial_number)).where(Gift.slug.like(f"{model.slug}-%"))
        )
        or 0
    )
    serial = max(minted, highest) + 1
    # A staff grant charges nobody: there is no buyer to debit, and inventing one would put a
    # purchase somebody never made into their ledger.
    if not free:
        wallet = await _wallet_for_update(session, buyer.id)
        _ledger_change(
            session,
            wallet,
            -model.price_stars,
            kind="gift_purchase",
            description=(
                f"Подарок {model.name} для @{owner.username}"
                if owner.id != buyer.id
                else f"Покупка {model.name}"
            ),
            correlation_id=uuid.uuid4(),
            counterparty_id=owner.id if owner.id != buyer.id else None,
            entity_type="gift_model",
            entity_id=model.slug,
        )
    # A mint produces a *plain* gift: the design's own artwork on its own neutral backdrop, with
    # no model, no rolled backdrop and no symbol. Those three are what `POST /upgrade` rolls, at
    # Telegram's real drop rates, which is the moment the item becomes a collectible.
    now = utcnow()
    gift = Gift(
        slug=f"{model.slug}-{serial:03d}",
        name=model.name,
        description=model.description,
        serial_number=serial,
        edition_size=model.edition_size,
        rarity=model.rarity,
        image_url=model.image_url,
        accent=model.accent,
        backdrop_edge=model.backdrop_edge,
        pattern_color="#ffffff",
        text_color="#ffffff",
        tg_name=model.tg_name or model.name,
        model_name="",
        art=model.art or "orb",
        pattern="",
        owner_id=owner.id,
        received_at=now,
        sender_id=buyer.id,
        sender_hidden=hide_sender and owner.id != buyer.id,
        message=message if owner.id != buyer.id else None,
        upgraded_at=None,
    )
    session.add(gift)
    await session.flush()
    session.add(
        GiftCollectible(
            gift_id=gift.id,
            model="",
            backdrop="",
            symbol="",
            traits={"serial_percent": round(serial / max(1, model.edition_size) * 100, 3)},
            value_stars=model.price_stars,
            provenance_hash=hashlib.sha256(f"{gift.id}:{model.slug}:{serial}".encode()).hexdigest(),
            creator_username="gram",
            minted_at=gift.received_at,
        )
    )
    return gift


async def _apply_upgrade(
    session: AsyncSession,
    gift: Gift,
    model: GiftModel,
    *,
    pick_model: str | None = None,
    pick_backdrop: str | None = None,
    pick_symbol: str | None = None,
) -> Gift:
    """
    Roll a model, a backdrop and a symbol onto a plain gift.

    The pools come from the imported catalogue rather than the stored JSON copy, so one table
    decides the odds, and the rolled percentages are recorded so two owners of the same design
    can compare what they actually got. These are Telegram's own per-mille rates, not an
    approximation of them.

    `pick_*` bypasses the roll for staff grants: a prize is chosen, not won, and an admin who
    promised somebody a particular model should be able to hand over that model.
    """
    source = giftart.BY_SLUG.get(model.slug)

    def named(pool: tuple[Any, ...], wanted: str | None) -> Any | None:
        return next((item for item in pool if item.name == wanted), None) if wanted else None

    rolled_model = named(source.models, pick_model) if source else None
    rolled_backdrop = named(source.backdrops, pick_backdrop) if source else None
    rolled_symbol = named(source.symbols, pick_symbol) if source else None
    if source is not None:
        rolled_model = rolled_model or giftart.roll(source.models)
        rolled_backdrop = rolled_backdrop or giftart.roll(source.backdrops)
        rolled_symbol = rolled_symbol or giftart.roll(source.symbols)
    variant_model = rolled_model.name if rolled_model else model.model_name
    variant_backdrop = rolled_backdrop.name if rolled_backdrop else model.backdrop
    variant_symbol = rolled_symbol.name if rolled_symbol else model.symbol
    backdrop = rolled_backdrop if isinstance(rolled_backdrop, giftart.Backdrop) else None
    gift.model_name = variant_model
    gift.pattern = variant_symbol
    gift.accent = backdrop.center if backdrop else model.accent
    gift.backdrop_edge = backdrop.edge if backdrop else model.backdrop_edge
    gift.pattern_color = backdrop.pattern if backdrop else "#ffffff"
    gift.text_color = backdrop.text if backdrop else "#ffffff"
    gift.upgraded_at = utcnow()
    collectible = await session.scalar(
        select(GiftCollectible).where(GiftCollectible.gift_id == gift.id)
    )
    if collectible is None:
        collectible = GiftCollectible(
            gift_id=gift.id,
            value_stars=model.price_stars,
            provenance_hash=hashlib.sha256(
                f"{gift.id}:{model.slug}:{gift.serial_number}".encode()
            ).hexdigest(),
            creator_username="gram",
            minted_at=gift.received_at,
        )
        session.add(collectible)
    collectible.model = variant_model
    collectible.backdrop = variant_backdrop
    collectible.symbol = variant_symbol
    collectible.traits = {
        "model": variant_model,
        "backdrop": variant_backdrop,
        "symbol": variant_symbol,
        "model_rarity_percent": giftart.percent(rolled_model),
        "backdrop_rarity_percent": giftart.percent(rolled_backdrop),
        "symbol_rarity_percent": giftart.percent(rolled_symbol),
        "serial_percent": round(gift.serial_number / max(1, gift.edition_size) * 100, 3),
    }
    return gift


async def _gift_message(session: AsyncSession, sender: User, recipient: User, gift: Gift) -> None:
    """Post a gift card into the sender's direct chat with the recipient, creating it if new."""
    candidate_ids = (
        select(ChatMember.chat_id)
        .where(ChatMember.user_id.in_([sender.id, recipient.id]))
        .group_by(ChatMember.chat_id)
        .having(func.count(func.distinct(ChatMember.user_id)) == DIRECT_CHAT_MEMBER_COUNT)
    )
    chat = await session.scalar(
        select(Chat).where(
            Chat.id.in_(candidate_ids), Chat.is_group.is_(False), Chat.kind == "direct"
        )
    )
    if chat is None:
        chat = Chat(is_group=False, kind="direct")
        session.add(chat)
        await session.flush()
        session.add_all(
            [
                ChatMember(chat_id=chat.id, user_id=sender.id),
                ChatMember(chat_id=chat.id, user_id=recipient.id),
            ]
        )
    caption = f"🎁 Подарок «{gift.name}» #{gift.serial_number}"
    session.add(
        Message(
            chat_id=chat.id,
            sender_id=sender.id,
            content=f"{caption} — {gift.message}" if gift.message else caption,
            gift_id=gift.id,
        )
    )


@app.get("/api/gifts", response_model=list[GiftOut], tags=["gifts"])
async def read_gifts(
    session: SessionDep,
    me: CurrentUser,
    owner: Annotated[str | None, Query(description="Filter by owner username")] = None,
) -> list[GiftOut]:
    """
    A collection, as its owner curates it.

    Items an owner has hidden are withheld from everyone else. They are still theirs — provenance
    intact, still sellable — so the owner keeps seeing them, flagged, and can put them back.
    """
    query = (
        select(Gift, User)
        .join(User, Gift.owner_id == User.id)
        # Pinned first, newest pin leading, then the rest as they arrived.
        .order_by(Gift.pinned_at.is_(None), Gift.pinned_at.desc(), Gift.received_at.desc())
    )
    if owner:
        owner_user = await resolve_user(session, owner)
        if owner_user is None:
            return []
        # A collection is content: a closed account's is for its followers, and someone who
        # blocked me does not show me theirs.
        await require_content_access(session, owner_user, me)
        query = query.where(Gift.owner_id == owner_user.id)
    else:
        walled_off = await blocked_pair_ids(session, me.id)
        if walled_off:
            query = query.where(Gift.owner_id.notin_(walled_off))
    query = query.where(or_(Gift.hidden_in_profile.is_(False), Gift.owner_id == me.id))
    rows = (await session.execute(query)).all()
    return [await render_gift(session, gift, gift_owner, me) for gift, gift_owner in rows]


@app.patch("/api/gifts/{gift_id}/visibility", response_model=GiftOut, tags=["gifts"])
async def update_gift_visibility(
    gift_id: uuid.UUID,
    payload: GiftVisibilityUpdate,
    session: SessionDep,
    me: CurrentUser,
) -> GiftOut:
    """Hide an owned item from the public collection, or put it back."""
    gift = await session.scalar(select(Gift).where(Gift.id == gift_id).with_for_update())
    if gift is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Подарок не найден")
    if gift.owner_id != me.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Вы не владеете этим подарком"
        )
    gift.hidden_in_profile = payload.hidden
    if payload.hidden:
        # A hidden item cannot also be on display, so pinning is released with it.
        await session.execute(
            delete(GiftShowcase).where(
                GiftShowcase.user_id == me.id, GiftShowcase.gift_id == gift.id
            )
        )
        gift.pinned_at = None
    await session.commit()
    await session.refresh(gift)
    return await render_gift(session, gift, me, me)


@app.patch("/api/gifts/{gift_id}/offers", response_model=GiftOut, tags=["gifts"])
async def update_gift_offers(
    gift_id: uuid.UUID,
    payload: OffersToggle,
    session: SessionDep,
    me: CurrentUser,
) -> GiftOut:
    """
    Stop being asked a price for something that is not for sale.

    Declining offers one by one tells a buyer to try again; refusing them tells the truth once.
    Listing the item for sale is still possible — this only closes the bidding.
    """
    gift = await _owned_gift_simple(session, gift_id, me)
    gift.offers_disabled = payload.offers_disabled
    await session.commit()
    await session.refresh(gift)
    return await render_gift(session, gift, me, me)


async def _owned_gift_simple(session: AsyncSession, gift_id: uuid.UUID, me: User) -> Gift:
    gift = await session.get(Gift, gift_id)
    if gift is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Подарок не найден")
    if gift.owner_id != me.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Вы не владеете этим подарком"
        )
    return gift


async def _owned_gift(session: AsyncSession, gift_id: uuid.UUID, me: User) -> Gift:
    gift = await session.scalar(select(Gift).where(Gift.id == gift_id).with_for_update())
    if gift is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Подарок не найден")
    if gift.owner_id != me.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Вы не владеете этим подарком"
        )
    return gift


@app.post("/api/gifts/{gift_id}/pin", response_model=GiftOut, tags=["gifts"])
async def pin_gift(gift_id: uuid.UUID, session: SessionDep, me: CurrentUser) -> GiftOut:
    """
    Keep an item at the head of the collection.

    Several may be pinned at once — a collection has favourites, not one favourite — and the
    newest pin leads. A hidden item is shown again by pinning it: pinning something nobody can
    see would be a promise the profile does not keep.
    """
    gift = await _owned_gift(session, gift_id, me)
    gift.pinned_at = utcnow()
    gift.hidden_in_profile = False
    await session.commit()
    await session.refresh(gift)
    return await render_gift(session, gift, me, me)


@app.delete("/api/gifts/{gift_id}/pin", response_model=GiftOut, tags=["gifts"])
async def unpin_gift(gift_id: uuid.UUID, session: SessionDep, me: CurrentUser) -> GiftOut:
    gift = await _owned_gift(session, gift_id, me)
    gift.pinned_at = None
    await session.commit()
    await session.refresh(gift)
    return await render_gift(session, gift, me, me)


@app.get("/api/gifts/{gift_id}", response_model=GiftOut, tags=["gifts"])
async def read_gift(gift_id: uuid.UUID, session: SessionDep, me: CurrentUser) -> GiftOut:
    row = (
        await session.execute(
            select(Gift, User).join(User, Gift.owner_id == User.id).where(Gift.id == gift_id)
        )
    ).first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Подарок не найден")
    await require_content_access(session, row.User, me)
    return await render_gift(session, row.Gift, row.User, me)


# The cover holds four, in this order, and `COVER_SLOT_COUNT` up in the premium table is that
# same four — the comparison row promises exactly these slots. The first is anyone's to arrange;
# the others, and the marker beside the name, are what a premium account gets for its
# personalization.
COVER_SLOTS = ("featured", "cover2", "cover3", "cover4")
PREMIUM_SLOTS = frozenset({"cover2", "cover3", "cover4", "name"})


async def _require_premium_slot(session: AsyncSession, me: User, slot: str) -> None:
    """A free account arranges one gift on its cover; the rest come with Premium."""
    if slot not in PREMIUM_SLOTS:
        return
    if me.id in await premium_user_ids(session, [me.id]):
        return
    raise HTTPException(
        status_code=status.HTTP_402_PAYMENT_REQUIRED,
        detail=(
            "Подарок рядом с именем и вторая, третья и четвёртая витрины в шапке — "
            "возможности GRAM Premium"
        ),
    )


async def _set_showcase_slot(
    session: AsyncSession, me: User, slot: str, gift_id: uuid.UUID | None
) -> None:
    existing = await session.scalar(
        select(GiftShowcase)
        .where(GiftShowcase.user_id == me.id, GiftShowcase.slot == slot)
        .with_for_update()
    )
    if gift_id is None:
        if existing:
            await session.delete(existing)
        return
    # Emptying a slot is always allowed; filling a premium one is not.
    await _require_premium_slot(session, me, slot)
    gift = await session.scalar(select(Gift).where(Gift.id == gift_id).with_for_update())
    if gift is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Подарок не найден")
    if gift.owner_id != me.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Для витрины можно выбрать только свой подарок",
        )
    other_slot = await session.scalar(
        select(GiftShowcase).where(GiftShowcase.user_id == me.id, GiftShowcase.gift_id == gift.id)
    )
    if other_slot and other_slot.slot != slot:
        await session.delete(other_slot)
        await session.flush()
    if existing:
        existing.gift_id = gift.id
        existing.updated_at = utcnow()
    else:
        session.add(GiftShowcase(user_id=me.id, gift_id=gift.id, slot=slot))


@app.patch("/api/users/me/showcase", response_model=UserProfile, tags=["gifts"])
async def update_profile_showcase(
    payload: ProfileShowcaseUpdate, session: SessionDep, me: CurrentUser
) -> UserProfile:
    if "featured_gift_id" in payload.model_fields_set:
        await _set_showcase_slot(session, me, "featured", payload.featured_gift_id)
    if "name_gift_id" in payload.model_fields_set:
        await _set_showcase_slot(session, me, "name", payload.name_gift_id)
    await session.commit()
    return await render_profile(session, me, me)


@app.delete("/api/users/me/showcase/{slot}", response_model=UserProfile, tags=["gifts"])
async def clear_showcase_slot(
    slot: Annotated[str, Path(pattern="^(featured|cover2|cover3|cover4|name)$")],
    session: SessionDep,
    me: CurrentUser,
) -> UserProfile:
    """
    Take a gift off display.

    Never gated: an account whose Premium lapsed must still be able to tidy its own cover, and
    a slot it cannot refill is one it must at least be able to empty.
    """
    await _set_showcase_slot(session, me, slot, None)
    await session.commit()
    return await render_profile(session, me, me)


@app.put("/api/gifts/{gift_id}/showcase", response_model=UserProfile, tags=["gifts"])
async def showcase_gift(
    gift_id: uuid.UUID, payload: GiftShowcaseRequest, session: SessionDep, me: CurrentUser
) -> UserProfile:
    await _set_showcase_slot(session, me, payload.slot, gift_id)
    await session.commit()
    return await render_profile(session, me, me)


@app.post("/api/gifts/{gift_id}/transfer", response_model=GiftOut, tags=["gifts"])
async def transfer_gift(
    gift_id: uuid.UUID, payload: GiftTransferCreate, session: SessionDep, me: CurrentUser
) -> GiftOut:
    gift = await session.scalar(select(Gift).where(Gift.id == gift_id).with_for_update())
    if gift is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Подарок не найден")
    if gift.owner_id != me.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Вы не владеете этим подарком"
        )
    recipient = await resolve_user(session, payload.to_username)
    if recipient is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Получатель не найден")
    if recipient.id == me.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Подарок уже принадлежит вам"
        )
    _refuse_banned_recipient(recipient)
    await _refuse_closed_inbox(session, recipient, gift=True)
    transferred_at = utcnow()
    session.add(
        GiftTransfer(
            gift_id=gift.id,
            from_user_id=me.id,
            to_user_id=recipient.id,
            note=payload.note,
            transferred_at=transferred_at,
        )
    )
    await session.execute(
        delete(GiftShowcase).where(GiftShowcase.user_id == me.id, GiftShowcase.gift_id == gift.id)
    )
    gift.owner_id = recipient.id
    gift.received_at = transferred_at
    # A listing belongs to whoever set it, so handing the item on withdraws it from sale.
    gift.sale_price_stars = None
    gift.listed_at = None
    session.add(
        Notification(
            user_id=recipient.id,
            actor_id=me.id,
            kind=NotificationKind.GIFT,
            text=f"{me.display_name} передал(а) вам подарок «{gift.name}»",
            entity_id=str(gift.id),
        )
    )
    await session.commit()
    await session.refresh(gift)
    return await render_gift(session, gift, recipient, me)


@app.put("/api/gifts/{gift_id}/listing", response_model=GiftOut, tags=["gifts"])
async def update_gift_listing(
    gift_id: uuid.UUID, payload: GiftListingUpdate, session: SessionDep, me: CurrentUser
) -> GiftOut:
    """
    Put an owned item up for sale at a fixed price, or take it back off the market.

    A price is a standing answer: anyone can then buy the item outright instead of leaving an
    offer and waiting for the owner to notice it.
    """
    gift = await session.scalar(select(Gift).where(Gift.id == gift_id).with_for_update())
    if gift is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Подарок не найден")
    if gift.owner_id != me.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Вы не владеете этим подарком"
        )
    gift.sale_price_stars = payload.price_stars
    gift.listed_at = utcnow() if payload.price_stars is not None else None
    await session.commit()
    await session.refresh(gift)
    return await render_gift(session, gift, me, me)


@app.post("/api/gifts/{gift_id}/buy", response_model=GiftOut, tags=["gifts"])
async def buy_listed_gift(gift_id: uuid.UUID, session: SessionDep, me: CurrentUser) -> GiftOut:
    """
    Buy a listed item outright at its asking price.

    Both wallets are locked before either moves, and the two ledger rows share a correlation
    id, so a purchase is one settlement rather than a debit that might not find its credit.
    """
    gift = await session.scalar(select(Gift).where(Gift.id == gift_id).with_for_update())
    if gift is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Подарок не найден")
    price = gift.sale_price_stars
    if price is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Подарок не выставлен на продажу"
        )
    if gift.owner_id == me.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Подарок уже принадлежит вам"
        )
    seller = await session.get(User, gift.owner_id)
    if seller is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Владелец не найден")
    # Ordered by id so two simultaneous purchases take the same locks in the same sequence.
    wallets = (
        await session.scalars(
            select(StarWallet)
            .where(StarWallet.user_id.in_([me.id, seller.id]))
            .order_by(StarWallet.user_id)
            .with_for_update()
        )
    ).all()
    by_user = {wallet.user_id: wallet for wallet in wallets}
    buyer_wallet = by_user.get(me.id) or await _wallet_for_update(session, me.id)
    seller_wallet = by_user.get(seller.id) or await _wallet_for_update(session, seller.id)
    if buyer_wallet.balance < price:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Недостаточно Stars")
    correlation = uuid.uuid4()
    _ledger_change(
        session,
        buyer_wallet,
        -price,
        kind="gift_purchase",
        description=f"Покупка {gift.name} #{gift.serial_number}",
        correlation_id=correlation,
        counterparty_id=seller.id,
        entity_type="gift",
        entity_id=str(gift.id),
    )
    _ledger_change(
        session,
        seller_wallet,
        price,
        kind="gift_sale",
        description=f"Продажа {gift.name} #{gift.serial_number}",
        correlation_id=correlation,
        counterparty_id=me.id,
        entity_type="gift",
        entity_id=str(gift.id),
    )
    await session.execute(
        delete(GiftShowcase).where(
            GiftShowcase.user_id == seller.id, GiftShowcase.gift_id == gift.id
        )
    )
    bought_at = utcnow()
    session.add(
        GiftTransfer(
            gift_id=gift.id,
            from_user_id=seller.id,
            to_user_id=me.id,
            note=f"Покупка на маркете за {price} Stars",
            transferred_at=bought_at,
        )
    )
    gift.owner_id = me.id
    gift.received_at = bought_at
    gift.sale_price_stars = None
    gift.listed_at = None
    # Buying a listed item does not upgrade it: a plain gift stays plain for its new owner,
    # who can roll it themselves. The note belonged to the previous owner.
    gift.message = None
    gift.sender_id = seller.id
    gift.sender_hidden = False
    session.add(
        Notification(
            user_id=seller.id,
            actor_id=me.id,
            kind=NotificationKind.GIFT,
            text=(
                f"{me.display_name} купил(а) «{gift.name}» #{gift.serial_number} "
                f"за {price} ★"
            ),
            entity_id=str(gift.id),
        )
    )
    # Pending offers were addressed to the previous owner and cannot outlive the sale.
    losing = (
        await session.scalars(
            select(GiftOffer).where(GiftOffer.gift_id == gift.id, GiftOffer.status == "pending")
        )
    ).all()
    for offer in losing:
        session.add(
            Notification(
                user_id=offer.buyer_id,
                actor_id=me.id,
                kind=NotificationKind.GIFT,
                text=f"«{gift.name}» #{gift.serial_number} продан другому покупателю",
                entity_id=str(gift.id),
            )
        )
    await session.execute(
        update(GiftOffer)
        .where(GiftOffer.gift_id == gift.id, GiftOffer.status == "pending")
        .values(status="rejected", resolved_at=bought_at)
    )
    await session.commit()
    await session.refresh(gift)
    return await render_gift(session, gift, me, me)


@app.post("/api/gifts/{gift_id}/upgrade", response_model=GiftOut, tags=["gifts"])
async def upgrade_gift(gift_id: uuid.UUID, session: SessionDep, me: CurrentUser) -> GiftOut:
    """
    Turn a plain gift into a collectible for stars.

    This is the whole point of the economy: the buyer chooses the design, the upgrade chooses
    what they get — any model of that design can drop, at Telegram's own rates. A gift that is
    already upgraded cannot be rolled again, or the rarest model would just be a matter of
    paying until it appeared.
    """
    gift = await session.scalar(select(Gift).where(Gift.id == gift_id).with_for_update())
    if gift is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Подарок не найден")
    if gift.owner_id != me.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Улучшить подарок может владелец"
        )
    if gift.upgraded_at is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"«{gift.name}» уже улучшен — модель {gift.model_name or 'выпала ранее'}",
        )
    slug = design_slug(gift.slug)
    model = await session.scalar(select(GiftModel).where(GiftModel.slug == slug))
    design = DESIGN_BY_SLUG.get(slug)
    if model is None or design is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Этот подарок больше не улучшается"
        )
    price = design.upgrade_price_stars
    wallet = await _wallet_for_update(session, me.id)
    if wallet.balance < price:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail=f"Не хватает {price - wallet.balance} ★ на улучшение",
        )
    _ledger_change(
        session,
        wallet,
        -price,
        kind="gift_upgrade",
        description=f"Улучшение {gift.name} #{gift.serial_number}",
        correlation_id=uuid.uuid4(),
        entity_type="gift",
        entity_id=str(gift.id),
    )
    await _apply_upgrade(session, gift, model)
    await session.commit()
    await session.refresh(gift)
    return await render_gift(session, gift, me, me)


async def render_offer(session: AsyncSession, offer: GiftOffer) -> GiftOfferOut:
    buyer = await session.get(User, offer.buyer_id)
    seller = await session.get(User, offer.seller_id)
    if buyer is None or seller is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Участник предложения не найден"
        )
    return GiftOfferOut(
        id=offer.id,
        gift_id=offer.gift_id,
        buyer=compact_user(buyer),
        seller=compact_user(seller),
        amount_stars=offer.amount_stars,
        status=offer.status,
        created_at=offer.created_at,
        resolved_at=offer.resolved_at,
    )


@app.post(
    "/api/gifts/{gift_id}/offers",
    response_model=GiftOfferOut,
    status_code=status.HTTP_201_CREATED,
    tags=["gifts"],
)
async def create_gift_offer(
    gift_id: uuid.UUID, payload: GiftOfferCreate, session: SessionDep, me: CurrentUser
) -> GiftOfferOut:
    gift = await session.get(Gift, gift_id)
    if gift is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Подарок не найден")
    if gift.owner_id == me.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Нельзя сделать предложение себе"
        )
    # An owner who is not selling should stop being asked, not keep declining.
    if gift.offers_disabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Владелец не принимает предложения по этому подарку",
        )
    await refuse_if_blocked_with(session, gift.owner_id, me)
    wallet = await _wallet_for_update(session, me.id)
    if wallet.balance < payload.amount_stars:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Недостаточно Stars")
    offer = GiftOffer(
        gift_id=gift.id, buyer_id=me.id, seller_id=gift.owner_id, amount_stars=payload.amount_stars
    )
    session.add(offer)
    # Without this the seller had no way to learn an offer arrived, so offers looked inert.
    session.add(
        Notification(
            user_id=gift.owner_id,
            actor_id=me.id,
            kind=NotificationKind.GIFT,
            text=(
                f"{me.display_name} предлагает {payload.amount_stars} ★ "
                f"за «{gift.name}» #{gift.serial_number}"
            ),
            entity_id=str(gift.id),
        )
    )
    await session.commit()
    await session.refresh(offer)
    return await render_offer(session, offer)


@app.get("/api/gifts/offers/outgoing", response_model=list[GiftOfferOut], tags=["gifts"])
async def outgoing_gift_offers(session: SessionDep, me: CurrentUser) -> list[GiftOfferOut]:
    """
    Offers I have placed, in any state.

    Buyers previously had no record of their own bids — an offer vanished from view the
    moment the sheet closed, so a pending bid was indistinguishable from a lost one.
    """
    offers = (
        await session.scalars(
            select(GiftOffer)
            .where(GiftOffer.buyer_id == me.id)
            .order_by(GiftOffer.created_at.desc())
            .limit(50)
        )
    ).all()
    return [await render_offer(session, offer) for offer in offers]


@app.get("/api/gifts/offers/incoming", response_model=list[GiftOfferOut], tags=["gifts"])
async def incoming_gift_offers(session: SessionDep, me: CurrentUser) -> list[GiftOfferOut]:
    """
    Every pending offer addressed to me, so offers are visible without opening each gift.

    Scoped by *current* ownership rather than the offer's recorded seller: once a gift is
    transferred on, its old pending offers are no longer the previous owner's to answer.
    """
    offers = (
        await session.scalars(
            select(GiftOffer)
            .join(Gift, Gift.id == GiftOffer.gift_id)
            .where(GiftOffer.status == "pending", Gift.owner_id == me.id)
            .order_by(GiftOffer.created_at.desc())
        )
    ).all()
    return [await render_offer(session, offer) for offer in offers]


@app.get("/api/gifts/{gift_id}/offers", response_model=list[GiftOfferOut], tags=["gifts"])
async def gift_offers(
    gift_id: uuid.UUID, session: SessionDep, me: CurrentUser
) -> list[GiftOfferOut]:
    gift = await session.get(Gift, gift_id)
    if gift is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Подарок не найден")
    if gift.owner_id != me.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Предложения видит владелец"
        )
    offers = (
        await session.scalars(
            select(GiftOffer)
            .where(GiftOffer.gift_id == gift.id)
            .order_by(GiftOffer.created_at.desc())
        )
    ).all()
    return [await render_offer(session, offer) for offer in offers]


@app.post("/api/gifts/offers/{offer_id}/accept", response_model=GiftOut, tags=["gifts"])
async def accept_gift_offer(offer_id: uuid.UUID, session: SessionDep, me: CurrentUser) -> GiftOut:
    offer = await session.scalar(
        select(GiftOffer).where(GiftOffer.id == offer_id).with_for_update()
    )
    if offer is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Предложение не найдено")
    if offer.seller_id != me.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Только продавец может принять предложение",
        )
    if offer.status != "pending":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Предложение уже закрыто")
    gift = await session.scalar(select(Gift).where(Gift.id == offer.gift_id).with_for_update())
    buyer = await session.get(User, offer.buyer_id)
    if gift is None or buyer is None or gift.owner_id != me.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Владелец подарка изменился"
        )
    wallets = (
        await session.scalars(
            select(StarWallet)
            .where(StarWallet.user_id.in_([me.id, buyer.id]))
            .order_by(StarWallet.user_id)
            .with_for_update()
        )
    ).all()
    by_user = {wallet.user_id: wallet for wallet in wallets}
    buyer_wallet = by_user.get(buyer.id) or await _wallet_for_update(session, buyer.id)
    seller_wallet = by_user.get(me.id) or await _wallet_for_update(session, me.id)
    correlation = uuid.uuid4()
    _ledger_change(
        session,
        buyer_wallet,
        -offer.amount_stars,
        kind="gift_purchase",
        description=f"Покупка {gift.name}",
        correlation_id=correlation,
        counterparty_id=me.id,
        entity_type="gift",
        entity_id=str(gift.id),
    )
    _ledger_change(
        session,
        seller_wallet,
        offer.amount_stars,
        kind="gift_sale",
        description=f"Продажа {gift.name}",
        correlation_id=correlation,
        counterparty_id=buyer.id,
        entity_type="gift",
        entity_id=str(gift.id),
    )
    await session.execute(
        delete(GiftShowcase).where(GiftShowcase.user_id == me.id, GiftShowcase.gift_id == gift.id)
    )
    session.add(
        GiftTransfer(
            gift_id=gift.id,
            from_user_id=me.id,
            to_user_id=buyer.id,
            note=f"Продажа за {offer.amount_stars} Stars",
        )
    )
    gift.owner_id = buyer.id
    gift.received_at = utcnow()
    # Selling settles the item: the seller's listing and note do not travel with it, and the
    # upgrade state does — a collectible stays a collectible under its new owner.
    gift.sale_price_stars = None
    gift.listed_at = None
    gift.message = None
    offer.status = "accepted"
    offer.resolved_at = utcnow()
    session.add(
        Notification(
            user_id=buyer.id,
            actor_id=me.id,
            kind=NotificationKind.GIFT,
            text=(
                f"{me.display_name} принял(а) ваше предложение — «{gift.name}» "
                f"#{gift.serial_number} теперь ваш"
            ),
            entity_id=str(gift.id),
        )
    )
    losing_offers = (
        await session.scalars(
            select(GiftOffer).where(
                GiftOffer.gift_id == gift.id,
                GiftOffer.id != offer.id,
                GiftOffer.status == "pending",
            )
        )
    ).all()
    for losing in losing_offers:
        session.add(
            Notification(
                user_id=losing.buyer_id,
                actor_id=me.id,
                kind=NotificationKind.GIFT,
                text=f"«{gift.name}» #{gift.serial_number} продан другому покупателю",
                entity_id=str(gift.id),
            )
        )
    await session.execute(
        update(GiftOffer)
        .where(
            GiftOffer.gift_id == gift.id, GiftOffer.id != offer.id, GiftOffer.status == "pending"
        )
        .values(status="rejected", resolved_at=utcnow())
    )
    await session.commit()
    return await render_gift(session, gift, buyer, me)


@app.post("/api/gifts/offers/{offer_id}/decline", response_model=GiftOfferOut, tags=["gifts"])
async def decline_gift_offer(
    offer_id: uuid.UUID, session: SessionDep, me: CurrentUser
) -> GiftOfferOut:
    """Declining was missing entirely, leaving sellers with only "accept" or silence."""
    offer = await session.scalar(
        select(GiftOffer).where(GiftOffer.id == offer_id).with_for_update()
    )
    if offer is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Предложение не найдено")
    gift = await session.get(Gift, offer.gift_id)
    # Whoever holds the gift now answers for it, not whoever held it when the offer landed.
    if gift is None or gift.owner_id != me.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Только владелец может отклонить предложение",
        )
    if offer.status != "pending":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Предложение уже закрыто")
    offer.status = "declined"
    offer.resolved_at = utcnow()
    session.add(
        Notification(
            user_id=offer.buyer_id,
            actor_id=me.id,
            kind=NotificationKind.GIFT,
            text=(
                f"{me.display_name} отклонил(а) предложение "
                f"{offer.amount_stars} ★ за «{gift.name if gift else 'подарок'}»"
            ),
            entity_id=str(offer.gift_id),
        )
    )
    await session.commit()
    await session.refresh(offer)
    return await render_offer(session, offer)


@app.post("/api/gifts/offers/{offer_id}/cancel", response_model=GiftOfferOut, tags=["gifts"])
async def cancel_gift_offer(
    offer_id: uuid.UUID, session: SessionDep, me: CurrentUser
) -> GiftOfferOut:
    """Buyers can withdraw a pending offer they no longer want to honour."""
    offer = await session.scalar(
        select(GiftOffer).where(GiftOffer.id == offer_id).with_for_update()
    )
    if offer is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Предложение не найдено")
    if offer.buyer_id != me.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Отменить может только покупатель"
        )
    if offer.status != "pending":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Предложение уже закрыто")
    offer.status = "cancelled"
    offer.resolved_at = utcnow()
    await session.commit()
    await session.refresh(offer)
    return await render_offer(session, offer)


@app.get("/api/gifts/{gift_id}/provenance", response_model=list[GiftProvenanceOut], tags=["gifts"])
async def gift_provenance(
    gift_id: uuid.UUID, session: SessionDep, me: CurrentUser
) -> list[GiftProvenanceOut]:
    del me
    gift = await session.get(Gift, gift_id)
    if gift is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Подарок не найден")
    collectible = await session.get(GiftCollectible, gift.id)
    from_user = aliased(User)
    to_user = aliased(User)
    rows = (
        await session.execute(
            select(GiftTransfer, from_user, to_user)
            .join(from_user, GiftTransfer.from_user_id == from_user.id)
            .join(to_user, GiftTransfer.to_user_id == to_user.id)
            .where(GiftTransfer.gift_id == gift.id)
            .order_by(GiftTransfer.transferred_at)
        )
    ).all()
    events = [
        GiftProvenanceOut(
            id=None,
            event="minted",
            from_user=None,
            to_user=None,
            note="Создание коллекционного подарка",
            occurred_at=collectible.minted_at if collectible else gift.received_at,
            provenance_hash=collectible.provenance_hash if collectible else None,
        )
    ]
    events.extend(
        GiftProvenanceOut(
            id=transfer.id,
            event="transferred",
            from_user=compact_user(source),
            to_user=compact_user(destination),
            note=transfer.note,
            occurred_at=transfer.transferred_at,
            provenance_hash=collectible.provenance_hash if collectible else None,
        )
        for transfer, source, destination in rows
    )
    return events


def muted_notification_kinds(settings: UserSettings) -> set[NotificationKind]:
    """
    Which kinds the account has switched off.

    The switches are applied when the list is read rather than when each row is written: one
    place to enforce instead of sixteen, and turning a switch back on brings the history with
    it. Security notices (SYSTEM) are never in this set — a login alert is not noise.
    """
    toggles = {
        NotificationKind.LIKE: settings.notify_likes,
        NotificationKind.COMMENT: settings.notify_comments,
        NotificationKind.MESSAGE: settings.notify_messages,
        NotificationKind.GIFT: settings.notify_gifts,
        NotificationKind.FOLLOW: settings.notify_follows,
        NotificationKind.STARS: settings.notify_stars,
        NotificationKind.SUBSCRIPTION: settings.notify_stars,
        NotificationKind.COMMUNITY: settings.notify_comments,
    }
    return {kind for kind, wanted in toggles.items() if not wanted}


@app.get("/api/notifications", response_model=list[NotificationOut], tags=["notifications"])
async def read_notifications(
    session: SessionDep, me: CurrentUser, limit: Annotated[int, Query(ge=1, le=100)] = 50
) -> list[NotificationOut]:
    muted = muted_notification_kinds(await settings_for(session, me.id))
    query = (
        select(Notification, User)
        .outerjoin(User, Notification.actor_id == User.id)
        .where(Notification.user_id == me.id)
    )
    if muted:
        query = query.where(Notification.kind.notin_(muted))
    rows = (
        await session.execute(query.order_by(Notification.created_at.desc()).limit(limit))
    ).all()
    return [
        NotificationOut(
            id=notification.id,
            kind=notification.kind,
            text=notification.text,
            actor=compact_user(actor) if actor else None,
            entity_id=notification.entity_id,
            is_read=notification.is_read,
            read=notification.is_read,
            created_at=notification.created_at,
        )
        for notification, actor in rows
    ]


@app.post("/api/notifications/read-all", response_model=DetailResponse, tags=["notifications"])
async def read_all_notifications(session: SessionDep, me: CurrentUser) -> DetailResponse:
    await session.execute(
        update(Notification)
        .where(Notification.user_id == me.id, Notification.is_read.is_(False))
        .values(is_read=True)
    )
    await session.commit()
    return DetailResponse(detail="read")


@app.post(
    "/api/notifications/{notification_id}/read",
    response_model=NotificationOut,
    tags=["notifications"],
)
async def read_notification(
    notification_id: uuid.UUID, session: SessionDep, me: CurrentUser
) -> NotificationOut:
    notification = await session.scalar(
        select(Notification).where(
            Notification.id == notification_id, Notification.user_id == me.id
        )
    )
    if notification is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Уведомление не найдено")
    notification.is_read = True
    await session.commit()
    actor = await session.get(User, notification.actor_id) if notification.actor_id else None
    return NotificationOut(
        id=notification.id,
        kind=notification.kind,
        text=notification.text,
        actor=compact_user(actor) if actor else None,
        entity_id=notification.entity_id,
        is_read=True,
        read=True,
        created_at=notification.created_at,
    )


@app.delete("/api/notifications/{notification_id}", response_model=DetailResponse, tags=["notifications"])
async def delete_notification(
    notification_id: uuid.UUID, session: SessionDep, me: CurrentUser
) -> DetailResponse:
    """
    Remove one notice from one's own list.

    Marking as read was the only thing the list could do, so a notice about something long dealt
    with stayed there for good and the only way to get a clean list was to stop looking at it.
    Scoped to the caller by construction: the `user_id` predicate means somebody else's id simply
    does not match, and the answer is the same 404 a made-up id gets.
    """
    notification = await session.scalar(
        select(Notification).where(
            Notification.id == notification_id, Notification.user_id == me.id
        )
    )
    if notification is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Уведомление не найдено")
    await session.delete(notification)
    await session.commit()
    return DetailResponse(detail="Уведомление удалено")


@app.delete("/api/notifications", response_model=DetailResponse, tags=["notifications"])
async def clear_notifications(
    session: SessionDep,
    me: CurrentUser,
    scope: Annotated[str, Query(pattern="^(all|read)$")] = "all",
) -> DetailResponse:
    """
    Empty the list: everything, or only what has already been read.

    `scope=read` is the one people reach for — it clears the settled noise and leaves anything
    still waiting for attention, so nothing is lost by pressing it.
    """
    query = delete(Notification).where(Notification.user_id == me.id)
    if scope == "read":
        query = query.where(Notification.is_read.is_(True))
    removed = (await session.execute(query)).rowcount or 0
    await session.commit()
    return DetailResponse(detail=f"Удалено: {removed}")


class SocialConnectionManager:
    """
    One authenticated read-only socket per browser for feed/comment invalidation events.

    Two kinds of traffic share it. Post events go to everybody, because a like on a public post is
    public. Chat events go to named people only — `send_to_users` — since the existence of a
    conversation is not: a frame naming a chat id must not reach anybody who is not in it.
    """

    def __init__(self) -> None:
        self.connections: set[WebSocket] = set()
        self.owners: dict[WebSocket, uuid.UUID] = {}

    async def connect(self, websocket: WebSocket, user_id: uuid.UUID) -> None:
        await websocket.accept()
        self.connections.add(websocket)
        self.owners[websocket] = user_id

    def disconnect(self, websocket: WebSocket) -> None:
        self.connections.discard(websocket)
        self.owners.pop(websocket, None)

    async def broadcast(self, payload: dict[str, Any]) -> None:
        await self._send(self.connections, payload)

    async def send_to_users(
        self, user_ids: Iterable[uuid.UUID], payload: dict[str, Any]
    ) -> None:
        """Deliver to every open tab of these accounts, and to nobody else."""
        wanted = set(user_ids)
        if not wanted:
            return
        targets = [
            connection
            for connection in tuple(self.connections)
            if self.owners.get(connection) in wanted
        ]
        await self._send(targets, payload)

    async def _send(self, targets: Iterable[WebSocket], payload: dict[str, Any]) -> None:
        stale: list[WebSocket] = []
        for connection in tuple(targets):
            try:
                await connection.send_json(payload)
            except (RuntimeError, OSError, WebSocketDisconnect):
                stale.append(connection)
        for connection in stale:
            self.disconnect(connection)


social_connections = SocialConnectionManager()


async def broadcast_social(
    event: str,
    post_id: uuid.UUID,
    *,
    comment_id: uuid.UUID | None = None,
    actor_id: uuid.UUID | None = None,
) -> None:
    payload: dict[str, Any] = {"type": event, "post_id": str(post_id)}
    if comment_id is not None:
        payload["comment_id"] = str(comment_id)
    if actor_id is not None:
        payload["actor_id"] = str(actor_id)
    await social_connections.broadcast(payload)


class ChatConnectionManager:
    """In-process WebSocket fan-out; messages remain durable in PostgreSQL."""

    def __init__(self) -> None:
        self.connections: dict[uuid.UUID, set[WebSocket]] = defaultdict(set)

    async def connect(self, chat_id: uuid.UUID, websocket: WebSocket) -> None:
        await websocket.accept()
        self.connections[chat_id].add(websocket)

    def disconnect(self, chat_id: uuid.UUID, websocket: WebSocket) -> None:
        self.connections[chat_id].discard(websocket)
        if not self.connections[chat_id]:
            self.connections.pop(chat_id, None)

    async def broadcast(
        self,
        chat_id: uuid.UUID,
        payload: dict[str, Any],
        *,
        exclude: WebSocket | None = None,
    ) -> None:
        """
        Fan out to the chat's open sockets.

        `exclude` leaves one out, which is what "somebody else is typing" needs: a typing frame
        echoed back to its own author would draw the author typing to themselves.
        """
        stale: list[WebSocket] = []
        for connection in tuple(self.connections.get(chat_id, ())):
            if connection is exclude:
                continue
            try:
                await connection.send_json(payload)
            except RuntimeError:
                stale.append(connection)
        for connection in stale:
            self.disconnect(chat_id, connection)


chat_connections = ChatConnectionManager()


@app.websocket("/ws/social")
async def social_websocket(websocket: WebSocket) -> None:
    token = websocket.cookies.get(ACCESS_COOKIE) or websocket.query_params.get("access_token")
    if not token:
        await websocket.close(code=4401, reason="Требуется авторизация")
        return
    try:
        payload = decode_access_token(token)
        user_id = uuid.UUID(str(payload["sub"]))
        auth_session_id = uuid.UUID(str(payload["sid"]))
    except (jwt.PyJWTError, KeyError, TypeError, ValueError):
        await websocket.close(code=4401, reason="Сессия недействительна")
        return
    async with SessionFactory() as session:
        auth_session = await session.scalar(
            select(RefreshSession).where(
                RefreshSession.id == auth_session_id,
                RefreshSession.user_id == user_id,
                RefreshSession.revoked_at.is_(None),
                RefreshSession.expires_at > utcnow(),
            )
        )
        user = await session.get(User, user_id)
    if auth_session is None or user is None:
        await websocket.close(code=4401, reason="Сессия завершена")
        return
    await social_connections.connect(websocket, user_id)
    await websocket.send_json({"type": "ready"})
    try:
        while True:
            frame = await websocket.receive_json()
            if not isinstance(frame, dict) or frame.get("type") != "ping":
                continue
            # Pings also bound passive-session expiry and explicit revocation.
            async with SessionFactory() as session:
                alive = await session.scalar(
                    select(RefreshSession.id).where(
                        RefreshSession.id == auth_session_id,
                        RefreshSession.user_id == user_id,
                        RefreshSession.revoked_at.is_(None),
                        RefreshSession.expires_at > utcnow(),
                    )
                )
            if alive is None:
                await websocket.close(code=4401, reason="Сессия завершена")
                return
            await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    finally:
        social_connections.disconnect(websocket)


async def _handle_chat_frame(  # noqa: PLR0913
    frame: Any,
    *,
    session: AsyncSession,
    chat_id: uuid.UUID,
    user: User,
    member: ChatMember,
    websocket: WebSocket,
) -> None:
    """
    One inbound frame on a conversation's socket.

    Four kinds, and three of them are new work the thread used to do over HTTP or not at all: a
    keepalive that used to be answered with a validation error, a typing hint, and a read receipt
    that saves a round trip on every arriving message. Anything else is still a message to send.
    """
    kind = frame.get("type") if isinstance(frame, dict) else None
    if kind == "ping":
        await websocket.send_json({"type": "pong"})
        return
    # «печатает…». Never stored — it is true for a second and a half and then it is not — and
    # never echoed to its author.
    if kind == "typing":
        await chat_connections.broadcast(
            chat_id,
            {
                "type": "typing",
                "chat_id": str(chat_id),
                "user_id": str(user.id),
                "display_name": user.display_name,
                "username": user.username,
            },
            exclude=websocket,
        )
        return
    # The reader has caught up.
    if kind == "read":
        now = utcnow()
        member.last_read_at = now
        member.marked_unread = False
        await enqueue_wire_chat_event(
            session,
            chat_id,
            "chat.read",
            {"user_id": str(user.id), "at": now.isoformat()},
            actor_id=user.id,
        )
        await session.commit()
        await chat_connections.broadcast(
            chat_id,
            {
                "type": "chat_read",
                "chat_id": str(chat_id),
                "user_id": str(user.id),
                "at": now.isoformat(),
            },
            exclude=websocket,
        )
        await announce_chat_activity(session, chat_id, actor_id=user.id)
        return
    try:
        message_payload = MessageCreate.model_validate(frame)
    except ValidationError as exc:
        await websocket.send_json(
            {"type": "error", "detail": "Некорректное сообщение", "errors": exc.errors()}
        )
        return
    outgoing = await create_chat_message(session, chat_id, user, message_payload.content)
    await chat_connections.broadcast(
        chat_id, {"type": "message", "message": broadcast_payload(outgoing)}
    )


@app.websocket("/ws/chats/{chat_id}")
async def chat_websocket(websocket: WebSocket, chat_id: uuid.UUID) -> None:
    token = websocket.cookies.get(ACCESS_COOKIE) or websocket.query_params.get("access_token")
    if not token:
        await websocket.close(code=4401, reason="Требуется авторизация")
        return
    try:
        payload = decode_access_token(token)
        user_id = uuid.UUID(str(payload["sub"]))
        auth_session_id = uuid.UUID(str(payload["sid"]))
    except (jwt.PyJWTError, KeyError, TypeError, ValueError):
        await websocket.close(code=4401, reason="Сессия недействительна")
        return
    async with SessionFactory() as session:
        auth_session = await session.scalar(
            select(RefreshSession).where(
                RefreshSession.id == auth_session_id,
                RefreshSession.user_id == user_id,
                RefreshSession.revoked_at.is_(None),
                RefreshSession.expires_at > utcnow(),
            )
        )
        user = await session.get(User, user_id)
        if auth_session is None or user is None:
            await websocket.close(code=4401, reason="Сессия завершена")
            return
        # The socket writes messages, so a banned account is refused here too — the HTTP guard
        # cannot see a connection that never makes a request.
        if user.banned_at is not None:
            await websocket.close(code=4403, reason="Аккаунт заблокирован администрацией")
            return
        member = await session.scalar(
            select(ChatMember).where(ChatMember.chat_id == chat_id, ChatMember.user_id == user.id)
        )
        if member is None:
            await websocket.close(code=4403, reason="Нет доступа к чату")
            return
        await chat_connections.connect(chat_id, websocket)
        await websocket.send_json({"type": "ready", "chat_id": str(chat_id), "user": user.username})
        try:
            while True:
                await _handle_chat_frame(
                    await websocket.receive_json(),
                    session=session,
                    chat_id=chat_id,
                    user=user,
                    member=member,
                    websocket=websocket,
                )
        except WebSocketDisconnect:
            chat_connections.disconnect(chat_id, websocket)


# ---------------------------------------------------------------------------------------------
# Staff tools.
#
# Everything below is gated on `AdminUser`, writes an `AdminAction` row, and tells whoever was
# affected. Those three together are the difference between moderation and someone with database
# access: a decision that is not logged and not explained cannot be reviewed or appealed.
# ---------------------------------------------------------------------------------------------


async def get_admin_user(me: CurrentUser) -> User:
    """Staff-only gate. Refuses with 403 rather than 404, because hiding the panel is not
    security — the accounts that hold the flag are visible on their own profiles anyway."""
    if not me.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Нужны права администратора"
        )
    return me


AdminUser = Annotated[User, Depends(get_admin_user)]


def _audit(  # noqa: PLR0913
    session: AsyncSession,
    actor: User,
    action: str,
    *,
    target_type: str,
    target_id: str,
    target_label: str | None = None,
    reason: str | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    """Record one staff decision. Append-only: nothing in the panel deletes from this table."""
    session.add(
        AdminAction(
            actor_id=actor.id,
            action=action,
            target_type=target_type,
            target_id=target_id,
            target_label=target_label,
            reason=reason,
            details=details,
        )
    )


def _notify(
    session: AsyncSession,
    user_id: uuid.UUID,
    text: str,
    *,
    actor_id: uuid.UUID | None = None,
    entity_id: str | None = None,
) -> None:
    """
    Tell somebody what was done to them.

    Staff actions use the system kind rather than a new one: `notifications.kind` is a checked
    varchar, and `_add_missing_columns` cannot widen a CHECK, so a fresh value would start
    rejecting inserts on databases that already exist.
    """
    session.add(
        Notification(
            user_id=user_id,
            actor_id=actor_id,
            kind=NotificationKind.SYSTEM,
            text=text[:240],
            entity_id=entity_id,
        )
    )


async def _notify_admins(
    session: AsyncSession, text: str, *, entity_id: str | None = None
) -> None:
    """
    Tell the staff something is waiting for them.

    A queue nobody is told about is a queue nobody empties. Admins are few and the message is one
    line, so this is a notification each rather than a digest — the panel's counters are the
    summary, this is the nudge towards them.
    """
    admin_ids = (await session.scalars(select(User.id).where(User.is_admin.is_(True)))).all()
    for admin_id in admin_ids:
        _notify(session, admin_id, text, entity_id=entity_id)


async def admin_user_out(session: AsyncSession, user: User) -> AdminUserOut:
    """One account with the numbers a moderator decides on."""
    wallet = await session.get(StarWallet, user.id)
    gifts = int(
        await session.scalar(
            select(func.count()).select_from(Gift).where(Gift.owner_id == user.id)
        )
        or 0
    )
    posts = int(
        await session.scalar(
            select(func.count()).select_from(Post).where(Post.author_id == user.id)
        )
        or 0
    )
    handles = int(
        await session.scalar(
            select(func.count())
            .select_from(UsernameAsset)
            .where(UsernameAsset.owner_id == user.id)
        )
        or 0
    )
    reports = (
        await session.execute(
            select(ContentReport.status, func.count())
            .where(ContentReport.subject_id == user.id)
            .group_by(ContentReport.status)
        )
    ).all()
    by_status = {row[0]: int(row[1]) for row in reports}
    banned_by = await session.get(User, user.banned_by_id) if user.banned_by_id else None
    premium = user.id in await premium_user_ids(session, [user.id])
    return AdminUserOut(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        avatar_url=user.avatar_url,
        bio=user.bio or "",
        location=user.location,
        role_title=None,
        profile_color=user.profile_color or "default",
        is_verified=user.is_verified,
        verification_tier=user.verification_tier
        or ("official" if user.is_verified else None),
        is_admin=user.is_admin,
        is_premium=premium,
        is_banned=user.banned_at is not None,
        banned_at=user.banned_at,
        ban_reason=user.ban_reason,
        banned_by=compact_user(banned_by) if banned_by else None,
        joined_at=user.joined_at,
        followers_count=user.followers_count,
        stars_balance=wallet.balance if wallet else 0,
        gifts_count=gifts,
        posts_count=posts,
        usernames_count=handles,
        reports_count=sum(by_status.values()),
        open_reports_count=by_status.get("open", 0),
    )


@app.get("/api/admin/overview", response_model=AdminOverviewOut, tags=["admin"])
async def admin_overview(
    session: SessionDep,
    admin: AdminUser,  # noqa: ARG001
) -> AdminOverviewOut:
    """Everything the panel's first screen needs, as one request rather than nine."""

    async def count(model: Any, *where: Any) -> int:
        return int(await session.scalar(select(func.count()).select_from(model).where(*where)) or 0)

    since = utcnow() - timedelta(days=1)

    async def total(column: Any, *where: Any) -> int:
        return int(await session.scalar(select(func.sum(column)).where(*where)) or 0)

    return AdminOverviewOut(
        users=await count(User),
        banned_users=await count(User, User.banned_at.is_not(None)),
        admins=await count(User, User.is_admin.is_(True)),
        verified_users=await count(User, User.is_verified.is_(True)),
        open_reports=await count(ContentReport, ContentReport.status == "open"),
        open_legal_reports=await count(LegalReport, LegalReport.status == "open"),
        resolved_reports=await count(ContentReport, ContentReport.status != "open"),
        hidden_posts=await count(Post, Post.hidden_at.is_not(None)),
        hidden_comments=await count(PostComment, PostComment.hidden_at.is_not(None)),
        communities=await count(Community),
        gifts=await count(Gift),
        stars_in_circulation=int(await session.scalar(select(func.sum(StarWallet.balance))) or 0),
        actions_today=await count(AdminAction, AdminAction.created_at >= since),
        # The money side: two queues that wait for a person, and what has actually moved.
        pending_payouts=await count(StarPayout, StarPayout.status == "pending"),
        pending_payout_stars=await total(
            StarPayout.stars, StarPayout.status.in_(OPEN_PAYOUT_STATUSES)
        ),
        pending_refunds=await count(StarRefund, StarRefund.status == "pending"),
        paid_orders=await count(StarPurchase, StarPurchase.status == "paid"),
        xtr_collected=await total(
            StarPurchase.price_xtr, StarPurchase.status.in_(("paid", "refunded"))
        ),
        xtr_refunded=await total(StarPurchase.price_xtr, StarPurchase.status == "refunded"),
        xtr_paid_out=await total(StarPayout.price_xtr, StarPayout.status == "paid"),
    )


@app.get("/api/admin/users", response_model=list[AdminUserOut], tags=["admin"])
async def admin_list_users(
    session: SessionDep,
    admin: AdminUser,  # noqa: ARG001
    q: Annotated[str | None, Query(max_length=64)] = None,
    scope: Annotated[Literal["all", "banned", "admins", "verified", "reported"], Query()] = "all",
    limit: Annotated[int, Query(ge=1, le=200)] = 60,
) -> list[AdminUserOut]:
    query = select(User)
    if q:
        pattern = f"%{q.strip().lower().removeprefix('@')}%"
        query = query.where(
            or_(
                func.lower(User.username).like(pattern),
                func.lower(User.display_name).like(pattern),
            )
        )
    if scope == "banned":
        query = query.where(User.banned_at.is_not(None))
    elif scope == "admins":
        query = query.where(User.is_admin.is_(True))
    elif scope == "verified":
        query = query.where(User.is_verified.is_(True))
    elif scope == "reported":
        reported = select(ContentReport.subject_id).where(ContentReport.status == "open")
        query = query.where(User.id.in_(reported))
    rows = (await session.scalars(query.order_by(User.joined_at.desc()).limit(limit))).all()
    return [await admin_user_out(session, user) for user in rows]


async def _admin_target(session: AsyncSession, username: str) -> User:
    user = await resolve_user(session, username)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Пользователь не найден")
    return user


@app.get("/api/admin/users/{username}", response_model=AdminUserOut, tags=["admin"])
async def admin_read_user(
    username: str,
    session: SessionDep,
    admin: AdminUser,  # noqa: ARG001
) -> AdminUserOut:
    return await admin_user_out(session, await _admin_target(session, username))


@app.patch("/api/admin/users/{username}", response_model=AdminUserOut, tags=["admin"])
async def admin_update_user(
    username: str, payload: AdminUserUpdate, session: SessionDep, admin: AdminUser
) -> AdminUserOut:
    """
    Rewrite an account's public presentation, its verification and its staff flag.

    Verification and the tier move together: a tier without the tick would explain a mark that
    is not drawn, and a tick without a tier would say "подтверждён" without saying of what.
    """
    user = await _admin_target(session, username)
    fields = payload.model_dump(exclude_unset=True, exclude={"reason"})
    if not fields:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Нечего изменять"
        )
    if payload.is_admin is False and user.id == admin.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Снять права с себя нельзя — попросите другого администратора",
        )
    details = await session.get(UserProfileDetails, user.id)
    for field, value in fields.items():
        if field == "role_title":
            if details is None:
                details = UserProfileDetails(user_id=user.id)
                session.add(details)
            details.role_title = value
            continue
        setattr(user, field, value)
    # A tier is what the popover behind the tick reads out, so the two are kept consistent.
    if payload.verification_tier is not None and payload.is_verified is None:
        user.is_verified = True
    if payload.is_verified is False:
        user.verification_tier = None
    _audit(
        session,
        admin,
        "user_updated",
        target_type="user",
        target_id=str(user.id),
        target_label=f"@{user.username}",
        reason=payload.reason,
        details=fields,
    )
    if payload.is_verified is True:
        _notify(
            session,
            user.id,
            "GRAM подтвердил ваш профиль: "
            + VERIFICATION_LABELS.get(user.verification_tier or "official", "подтверждён"),
            actor_id=admin.id,
        )
    if payload.is_admin is True:
        _notify(session, user.id, "Вам выданы права администратора GRAM", actor_id=admin.id)
    await session.commit()
    await session.refresh(user)
    return await admin_user_out(session, user)


@app.post("/api/admin/users/{username}/ban", response_model=AdminUserOut, tags=["admin"])
async def admin_ban_user(
    username: str, payload: AdminBanRequest, session: SessionDep, admin: AdminUser
) -> AdminUserOut:
    """
    Ban an account and tell it why, in the same words everyone else will read.

    Nothing is deleted: the posts stay up carrying the mark, because a platform that erases the
    trail when it punishes someone cannot be held to its own decisions afterwards.
    """
    user = await _admin_target(session, username)
    if user.id == admin.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Забанить себя нельзя"
        )
    if user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Сначала снимите права администратора, потом баньте",
        )
    user.banned_at = utcnow()
    user.ban_reason = payload.reason
    user.banned_by_id = admin.id
    # The session is deliberately left alone. Enforcement is `_refuse_banned_write`, which refuses
    # every write on every request; revoking here would only sign them out, and signing back in
    # was exactly the hole — while also hiding the notice they are supposed to read.
    _audit(
        session,
        admin,
        "user_banned",
        target_type="user",
        target_id=str(user.id),
        target_label=f"@{user.username}",
        reason=payload.reason,
    )
    _notify(
        session,
        user.id,
        f"Ваш аккаунт заблокирован. Причина: {payload.reason}",
        actor_id=admin.id,
    )
    await session.commit()
    await session.refresh(user)
    return await admin_user_out(session, user)


@app.delete("/api/admin/users/{username}/ban", response_model=AdminUserOut, tags=["admin"])
async def admin_unban_user(
    username: str, session: SessionDep, admin: AdminUser
) -> AdminUserOut:
    user = await _admin_target(session, username)
    if user.banned_at is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=f"@{user.username} не заблокирован"
        )
    user.banned_at = None
    user.ban_reason = None
    user.banned_by_id = None
    _audit(
        session,
        admin,
        "user_unbanned",
        target_type="user",
        target_id=str(user.id),
        target_label=f"@{user.username}",
    )
    _notify(session, user.id, "Блокировка аккаунта снята", actor_id=admin.id)
    await session.commit()
    await session.refresh(user)
    return await admin_user_out(session, user)


@app.post("/api/admin/users/{username}/stars", response_model=AdminUserOut, tags=["admin"])
async def admin_grant_stars(
    username: str, payload: AdminStarsGrant, session: SessionDep, admin: AdminUser
) -> AdminUserOut:
    """Hand stars over or take them back. Either way it lands in the person's own ledger."""
    if payload.amount == 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Укажите ненулевую сумму"
        )
    user = await _admin_target(session, username)
    wallet = await _wallet_for_update(session, user.id)
    if wallet.balance + payload.amount < 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"У @{user.username} только {wallet.balance} ★",
        )
    given = payload.amount > 0
    _ledger_change(
        session,
        wallet,
        payload.amount,
        kind="admin_grant" if given else "admin_debit",
        description=payload.reason
        or ("Начисление от администрации" if given else "Списание администрацией"),
        correlation_id=uuid.uuid4(),
        counterparty_id=admin.id,
        entity_type="admin",
        entity_id=str(admin.id),
    )
    _audit(
        session,
        admin,
        "stars_granted" if given else "stars_taken",
        target_type="user",
        target_id=str(user.id),
        target_label=f"@{user.username}",
        reason=payload.reason,
        details={"amount": payload.amount},
    )
    _notify(
        session,
        user.id,
        f"Администрация начислила вам {payload.amount} ★"
        if given
        else f"Администрация списала {abs(payload.amount)} ★",
        actor_id=admin.id,
    )
    await session.commit()
    await session.refresh(user)
    return await admin_user_out(session, user)


@app.post("/api/admin/users/{username}/gifts", response_model=GiftOut, tags=["admin"])
async def admin_grant_gift(
    username: str, payload: AdminGiftGrant, session: SessionDep, admin: AdminUser
) -> GiftOut:
    """Mint a design straight into somebody's collection, optionally already upgraded."""
    user = await _admin_target(session, username)
    model = await session.scalar(select(GiftModel).where(GiftModel.slug == payload.slug))
    if model is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"Дизайна «{payload.slug}» нет"
        )
    gift = await _mint_gift(session, model, owner=user, buyer=admin, free=True)
    if payload.upgraded or payload.model or payload.backdrop or payload.symbol:
        for wanted, pool_name in (
            (payload.model, "модели"),
            (payload.backdrop, "фона"),
            (payload.symbol, "узора"),
        ):
            source = giftart.BY_SLUG.get(model.slug)
            pools = {
                "модели": source.models if source else (),
                "фона": source.backdrops if source else (),
                "узора": source.symbols if source else (),
            }[pool_name]
            if wanted and not any(item.name == wanted for item in pools):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail=f"У «{model.name}» нет {pool_name} «{wanted}»",
                )
        await _apply_upgrade(
            session,
            gift,
            model,
            pick_model=payload.model,
            pick_backdrop=payload.backdrop,
            pick_symbol=payload.symbol,
        )
    _audit(
        session,
        admin,
        "gift_granted",
        target_type="user",
        target_id=str(user.id),
        target_label=f"@{user.username}",
        reason=payload.reason,
        details={"slug": model.slug, "serial": gift.serial_number, "upgraded": payload.upgraded},
    )
    _notify(
        session,
        user.id,
        f"Администрация подарила вам «{model.name}» #{gift.serial_number}"
        + (f" — {gift.model_name}" if gift.model_name else ""),
        actor_id=admin.id,
        entity_id=str(gift.id),
    )
    await session.commit()
    await session.refresh(gift)
    return await render_gift(session, gift, user, admin)


@app.delete("/api/admin/gifts/{gift_id}", response_model=DetailResponse, tags=["admin"])
async def admin_revoke_gift(
    gift_id: uuid.UUID,
    session: SessionDep,
    admin: AdminUser,
    reason: Annotated[str | None, Query(max_length=240)] = None,
) -> DetailResponse:
    """
    Take a collectible back.

    The item is destroyed rather than moved to staff: a moderator holding somebody's confiscated
    Pepe in their own collection would be indistinguishable from taking it for themselves.
    """
    gift = await session.get(Gift, gift_id)
    if gift is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Подарок не найден")
    owner = await session.get(User, gift.owner_id)
    label = f"{gift.name} #{gift.serial_number}"
    _audit(
        session,
        admin,
        "gift_revoked",
        target_type="gift",
        target_id=str(gift.id),
        target_label=label,
        reason=reason,
        details={"owner": owner.username if owner else None},
    )
    if owner is not None:
        _notify(
            session,
            owner.id,
            f"Администрация изъяла «{label}»" + (f". Причина: {reason}" if reason else ""),
            actor_id=admin.id,
        )
    await session.delete(gift)
    await session.commit()
    return DetailResponse(detail="gift_revoked")


@app.post("/api/admin/users/{username}/usernames", response_model=AdminUserOut, tags=["admin"])
async def admin_grant_username(
    username: str, payload: AdminUsernameGrant, session: SessionDep, admin: AdminUser
) -> AdminUserOut:
    """Hand a collectible handle to an account, creating the asset if it never existed."""
    user = await _admin_target(session, username)
    handle = payload.username
    asset = await session.scalar(
        select(UsernameAsset).where(func.lower(UsernameAsset.username) == handle)
    )
    taken_by_account = await session.scalar(
        select(User).where(func.lower(User.username) == handle, User.id != user.id)
    )
    if taken_by_account is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"@{handle} — это чужой аккаунт, а не свободный ник",
        )
    if asset is None:
        asset = UsernameAsset(username=handle)
        session.add(asset)
    asset.owner_id = user.id
    asset.status = UsernameStatus.RESERVED
    asset.price = None
    asset.listed_at = None
    asset.reserved_at = utcnow()
    _audit(
        session,
        admin,
        "username_granted",
        target_type="user",
        target_id=str(user.id),
        target_label=f"@{user.username}",
        reason=payload.reason,
        details={"username": handle},
    )
    _notify(session, user.id, f"Администрация закрепила за вами @{handle}", actor_id=admin.id)
    await session.commit()
    await session.refresh(user)
    return await admin_user_out(session, user)


@app.delete(
    "/api/admin/users/{username}/usernames/{handle}",
    response_model=AdminUserOut,
    tags=["admin"],
)
async def admin_revoke_username(
    username: str,
    handle: str,
    session: SessionDep,
    admin: AdminUser,
    reason: Annotated[str | None, Query(max_length=240)] = None,
) -> AdminUserOut:
    user = await _admin_target(session, username)
    normalized = handle.strip().removeprefix("@").lower()
    asset = await session.scalar(
        select(UsernameAsset).where(
            func.lower(UsernameAsset.username) == normalized, UsernameAsset.owner_id == user.id
        )
    )
    if asset is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"@{normalized} не принадлежит этому аккаунту",
        )
    if normalized == user.username.lower():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Это основной ник аккаунта — сначала смените его",
        )
    asset.owner_id = None
    asset.status = UsernameStatus.AVAILABLE
    asset.reserved_at = None
    _audit(
        session,
        admin,
        "username_revoked",
        target_type="user",
        target_id=str(user.id),
        target_label=f"@{user.username}",
        reason=reason,
        details={"username": normalized},
    )
    _notify(session, user.id, f"Администрация забрала @{normalized}", actor_id=admin.id)
    await session.commit()
    await session.refresh(user)
    return await admin_user_out(session, user)


async def report_out(session: AsyncSession, report: ContentReport, same_target: int) -> ReportOut:
    reporter = await session.get(User, report.reporter_id)
    subject = await session.get(User, report.subject_id) if report.subject_id else None
    resolver = await session.get(User, report.resolved_by_id) if report.resolved_by_id else None
    return ReportOut(
        id=report.id,
        reporter=compact_user(reporter) if reporter else None,
        target_type=report.target_kind,
        target_id=report.target_id,
        subject=compact_user(subject) if subject else None,
        reason=report.reason,
        reason_label=REASON_LABELS.get(report.reason, report.reason),
        text=report.comment,
        excerpt=report.excerpt,
        status=report.status or "open",
        resolution=report.resolution,
        resolved_by=compact_user(resolver) if resolver else None,
        resolved_at=report.resolved_at,
        created_at=report.created_at,
        target_reports=same_target,
    )


@app.get("/api/admin/reports", response_model=list[ReportOut], tags=["admin"])
async def admin_list_reports(
    session: SessionDep,
    admin: AdminUser,  # noqa: ARG001
    report_status: Annotated[Literal["open", "resolved", "all"], Query(alias="status")] = "open",
    kind: Annotated[str | None, Query(max_length=20)] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 80,
) -> list[ReportOut]:
    """
    The review queue, newest first.

    Complaints about the same thing are counted together, so a moderator sees "seven people said
    this" rather than seven separate rows they have to notice are identical.
    """
    query = select(ContentReport)
    if report_status == "open":
        query = query.where(ContentReport.status == "open")
    elif report_status == "resolved":
        query = query.where(ContentReport.status != "open")
    if kind:
        query = query.where(ContentReport.target_kind == kind)
    rows = (
        await session.scalars(query.order_by(ContentReport.created_at.desc()).limit(limit))
    ).all()
    counts = {
        (row[0], row[1]): int(row[2])
        for row in (
            await session.execute(
                select(
                    ContentReport.target_kind, ContentReport.target_id, func.count()
                ).group_by(ContentReport.target_kind, ContentReport.target_id)
            )
        ).all()
    }
    return [
        await report_out(session, row, counts.get((row.target_kind, row.target_id), 1))
        for row in rows
    ]


async def legal_report_out(session: AsyncSession, report: LegalReport) -> LegalReportOut:
    resolver = await session.get(User, report.resolved_by_id) if report.resolved_by_id else None
    return LegalReportOut(
        id=report.id,
        reference_code=_legal_reference(report.id),
        kind=report.kind,
        reporter_role=report.reporter_role,
        reporter_name=report.reporter_name,
        reporter_email=report.reporter_email,
        country=report.country,
        account_username=report.account_username,
        content_urls=list(report.content_urls or []),
        original_work=report.original_work,
        details=report.details,
        requested_action=report.requested_action,
        electronic_signature=report.electronic_signature,
        status=report.status or "open",
        resolution=report.resolution,
        resolved_by=compact_user(resolver) if resolver else None,
        resolved_at=report.resolved_at,
        created_at=report.created_at,
    )


@app.get("/api/admin/legal-reports", response_model=list[LegalReportOut], tags=["admin"])
async def admin_list_legal_reports(
    session: SessionDep,
    admin: AdminUser,  # noqa: ARG001
    response: Response,
    report_status: Annotated[Literal["open", "resolved", "all"], Query(alias="status")] = "open",
    limit: Annotated[int, Query(ge=1, le=200)] = 80,
) -> list[LegalReportOut]:
    """List public legal and support cases without exposing them outside the staff boundary."""

    response.headers["Cache-Control"] = "no-store"
    query = select(LegalReport)
    if report_status == "open":
        query = query.where(LegalReport.status == "open")
    elif report_status == "resolved":
        query = query.where(LegalReport.status != "open")
    rows = (
        await session.scalars(query.order_by(LegalReport.created_at.desc()).limit(limit))
    ).all()
    return [await legal_report_out(session, row) for row in rows]


@app.post(
    "/api/admin/legal-reports/{report_id}/resolve",
    response_model=LegalReportOut,
    tags=["admin"],
)
async def admin_resolve_legal_report(
    report_id: uuid.UUID,
    payload: LegalReportResolve,
    session: SessionDep,
    admin: AdminUser,
    response: Response,
) -> LegalReportOut:
    response.headers["Cache-Control"] = "no-store"
    report = await session.get(LegalReport, report_id)
    if report is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Обращение не найдено")
    if report.status != "open":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Обращение уже рассмотрено",
        )
    report.status = "dismissed" if payload.action == "dismiss" else "resolved"
    report.resolution = payload.resolution.strip()
    report.resolved_by_id = admin.id
    report.resolved_at = utcnow()
    _audit(
        session,
        admin,
        f"legal_report_{payload.action}",
        target_type="legal_report",
        target_id=str(report.id),
        target_label=_legal_reference(report.id),
        reason=report.resolution,
        details={"kind": report.kind},
    )
    await session.commit()
    await session.refresh(report)
    return await legal_report_out(session, report)


async def _hide_reported_target(  # noqa: PLR0911
    session: AsyncSession, admin: User, report: ContentReport, reason: str
) -> str | None:
    """Hide or remove whatever the report points at, and tell its author. Returns a label."""
    def as_uuid(value: str) -> uuid.UUID | None:
        try:
            return uuid.UUID(value)
        except (ValueError, AttributeError):
            return None

    now = utcnow()
    if report.target_kind == "post" and (post_id := as_uuid(report.target_id)):
        post = await session.get(Post, post_id)
        if post is None:
            return None
        post.hidden_at = now
        post.hidden_by_id = admin.id
        post.hidden_reason = reason
        _notify(
            session,
            post.author_id,
            f"Администрация скрыла вашу публикацию. Причина: {reason}",
            actor_id=admin.id,
            entity_id=str(post.id),
        )
        return "post"
    if report.target_kind == "comment" and (comment_id := as_uuid(report.target_id)):
        comment = await session.get(PostComment, comment_id)
        if comment is None:
            return None
        comment.hidden_at = now
        comment.hidden_by_id = admin.id
        comment.hidden_reason = reason
        _notify(
            session,
            comment.author_id,
            f"Администрация удалила ваш комментарий. Причина: {reason}",
            actor_id=admin.id,
            entity_id=str(comment.id),
        )
        return "comment"
    if report.target_kind == "message" and (message_id := as_uuid(report.target_id)):
        message = await session.get(Message, message_id)
        if message is None:
            return None
        _notify(
            session,
            message.sender_id,
            f"Администрация удалила ваше сообщение. Причина: {reason}",
            actor_id=admin.id,
        )
        await session.delete(message)
        return "message"
    return None


@app.post("/api/admin/reports/{report_id}/resolve", response_model=ReportOut, tags=["admin"])
async def admin_resolve_report(
    report_id: uuid.UUID, payload: ReportResolve, session: SessionDep, admin: AdminUser
) -> ReportOut:
    """
    Close a complaint, and carry out the decision in the same request.

    `hide` and `ban` are not separate buttons somewhere else: a moderator who has just read the
    case should not have to go and find the account, and a queue that only closes rows teaches
    everyone that reporting does nothing.
    """
    report = await session.get(ContentReport, report_id)
    if report is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Жалоба не найдена")
    reason = payload.resolution or REASON_LABELS.get(report.reason, report.reason)
    if payload.action == "hide" and (
        await _hide_reported_target(session, admin, report, reason) is None
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Объект жалобы уже удалён — закройте её как рассмотренную",
        )
    if payload.action == "ban":
        subject = await session.get(User, report.subject_id) if report.subject_id else None
        if subject is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Непонятно, кого банить"
            )
        if subject.is_admin or subject.id == admin.id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Этот аккаунт нельзя забанить"
            )
        subject.banned_at = utcnow()
        subject.ban_reason = reason
        subject.banned_by_id = admin.id
        _notify(
            session,
            subject.id,
            f"Ваш аккаунт заблокирован по жалобе. Причина: {reason}",
            actor_id=admin.id,
        )
    report.status = "dismissed" if payload.action == "dismiss" else "resolved"
    report.resolution = payload.resolution
    report.resolved_by_id = admin.id
    report.resolved_at = utcnow()
    # Everyone who complained about the same thing gets the same answer: leaving duplicates open
    # would keep the queue full of cases that have already been decided.
    await session.execute(
        update(ContentReport)
        .where(
            ContentReport.target_kind == report.target_kind,
            ContentReport.target_id == report.target_id,
            ContentReport.status == "open",
        )
        .values(
            status=report.status,
            resolution=payload.resolution,
            resolved_by_id=admin.id,
            resolved_at=report.resolved_at,
        )
    )
    _audit(
        session,
        admin,
        f"report_{payload.action}",
        target_type=report.target_kind,
        target_id=report.target_id,
        target_label=report.excerpt[:120] if report.excerpt else None,
        reason=payload.resolution,
    )
    if report.reporter_id != admin.id:
        _notify(
            session,
            report.reporter_id,
            "Ваша жалоба рассмотрена"
            + (f": {payload.resolution}" if payload.resolution else ""),
            actor_id=admin.id,
        )
    await session.commit()
    await session.refresh(report)
    return await report_out(session, report, 1)


@app.post("/api/admin/posts/{post_id}/hide", response_model=DetailResponse, tags=["admin"])
async def admin_hide_post(
    post_id: uuid.UUID, payload: AdminHideRequest, session: SessionDep, admin: AdminUser
) -> DetailResponse:
    """Hide a post from everyone except its author and staff, and say why."""
    post = await session.get(Post, post_id)
    if post is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Публикация не найдена")
    post.hidden_at = utcnow()
    post.hidden_by_id = admin.id
    post.hidden_reason = payload.reason
    _audit(
        session,
        admin,
        "post_hidden",
        target_type="post",
        target_id=str(post.id),
        target_label=post.content[:120],
        reason=payload.reason,
    )
    _notify(
        session,
        post.author_id,
        f"Администрация скрыла вашу публикацию. Причина: {payload.reason}",
        actor_id=admin.id,
        entity_id=str(post.id),
    )
    await session.commit()
    return DetailResponse(detail="post_hidden")


@app.delete("/api/admin/posts/{post_id}/hide", response_model=DetailResponse, tags=["admin"])
async def admin_unhide_post(
    post_id: uuid.UUID, session: SessionDep, admin: AdminUser
) -> DetailResponse:
    post = await session.get(Post, post_id)
    if post is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Публикация не найдена")
    post.hidden_at = None
    post.hidden_by_id = None
    post.hidden_reason = None
    _audit(
        session,
        admin,
        "post_restored",
        target_type="post",
        target_id=str(post.id),
        target_label=post.content[:120],
    )
    _notify(
        session,
        post.author_id,
        "Администрация вернула вашу публикацию",
        actor_id=admin.id,
        entity_id=str(post.id),
    )
    await session.commit()
    return DetailResponse(detail="post_restored")


@app.delete("/api/admin/comments/{comment_id}", response_model=DetailResponse, tags=["admin"])
async def admin_hide_comment(
    comment_id: uuid.UUID,
    session: SessionDep,
    admin: AdminUser,
    reason: Annotated[str, Query(min_length=3, max_length=240)],
) -> DetailResponse:
    comment = await session.get(PostComment, comment_id)
    if comment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Комментарий не найден")
    comment.hidden_at = utcnow()
    comment.hidden_by_id = admin.id
    comment.hidden_reason = reason
    _audit(
        session,
        admin,
        "comment_hidden",
        target_type="comment",
        target_id=str(comment.id),
        target_label=comment.content[:120],
        reason=reason,
    )
    _notify(
        session,
        comment.author_id,
        f"Администрация удалила ваш комментарий. Причина: {reason}",
        actor_id=admin.id,
        entity_id=str(comment.post_id),
    )
    await session.commit()
    return DetailResponse(detail="comment_hidden")


@app.get("/api/admin/communities", response_model=list[AdminCommunityOut], tags=["admin"])
async def admin_list_communities(
    session: SessionDep,
    admin: AdminUser,  # noqa: ARG001
    q: Annotated[str | None, Query(max_length=64)] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 60,
) -> list[AdminCommunityOut]:
    query = select(Community)
    if q:
        pattern = f"%{q.strip().lower()}%"
        query = query.where(
            or_(
                func.lower(Community.slug).like(pattern),
                func.lower(Community.title).like(pattern),
            )
        )
    rows = (await session.scalars(query.order_by(Community.created_at.desc()).limit(limit))).all()
    reports = {
        row[0]: int(row[1])
        for row in (
            await session.execute(
                select(ContentReport.target_id, func.count())
                .where(ContentReport.target_kind == "community")
                .group_by(ContentReport.target_id)
            )
        ).all()
    }
    out: list[AdminCommunityOut] = []
    for community in rows:
        owner = await session.get(User, community.owner_id) if community.owner_id else None
        posts = int(
            await session.scalar(
                select(func.count()).select_from(Post).where(Post.community_id == community.id)
            )
            or 0
        )
        out.append(
            AdminCommunityOut(
                id=community.id,
                slug=community.slug,
                title=community.title,
                description=community.description or "",
                category=community.category,
                location=community.location,
                owner=compact_user(owner) if owner else None,
                members_count=community.members_count,
                posts_count=posts,
                reports_count=reports.get(community.slug, 0),
                created_at=community.created_at,
            )
        )
    return out


@app.patch("/api/admin/communities/{slug}", response_model=AdminCommunityOut, tags=["admin"])
async def admin_update_community(
    slug: str, payload: AdminCommunityUpdate, session: SessionDep, admin: AdminUser
) -> AdminCommunityOut:
    community = await session.scalar(select(Community).where(Community.slug == slug))
    if community is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Сообщество не найдено")
    fields = payload.model_dump(exclude_unset=True, exclude={"reason"})
    if not fields:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Нечего изменять"
        )
    for field, value in fields.items():
        setattr(community, field, value)
    _audit(
        session,
        admin,
        "community_updated",
        target_type="community",
        target_id=community.slug,
        target_label=community.title,
        reason=payload.reason,
        details=fields,
    )
    if community.owner_id:
        _notify(
            session,
            community.owner_id,
            f"Администрация изменила сообщество «{community.title}»",
            actor_id=admin.id,
        )
    await session.commit()
    await session.refresh(community)
    owner = await session.get(User, community.owner_id) if community.owner_id else None
    return AdminCommunityOut(
        id=community.id,
        slug=community.slug,
        title=community.title,
        description=community.description or "",
        category=community.category,
        location=community.location,
        owner=compact_user(owner) if owner else None,
        members_count=community.members_count,
        posts_count=0,
        reports_count=0,
        created_at=community.created_at,
    )


@app.delete("/api/admin/communities/{slug}", response_model=DetailResponse, tags=["admin"])
async def admin_delete_community(
    slug: str,
    session: SessionDep,
    admin: AdminUser,
    reason: Annotated[str, Query(min_length=3, max_length=240)],
) -> DetailResponse:
    """Close a community. Its posts go with it, which is why the reason is mandatory."""
    community = await session.scalar(select(Community).where(Community.slug == slug))
    if community is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Сообщество не найдено")
    _audit(
        session,
        admin,
        "community_deleted",
        target_type="community",
        target_id=community.slug,
        target_label=community.title,
        reason=reason,
    )
    if community.owner_id:
        _notify(
            session,
            community.owner_id,
            f"Администрация закрыла сообщество «{community.title}». Причина: {reason}",
            actor_id=admin.id,
        )
    # Handles pointing at it go back to being plain collectibles. Without this they point at a
    # channel that no longer exists — and a handle pointing at nothing opens nothing.
    await _release_community_handles(session, community)
    await session.delete(community)
    await session.commit()
    return DetailResponse(detail="community_deleted")


async def _release_community_handles(session: AsyncSession, community: Community) -> None:
    """
    Erase a channel that is about to stop existing from everything still pointing at it.

    Two kinds of reference, both of which used to survive the deletion. A handle left pointing at a
    dead channel opens nothing. And a profile advertising it asked the API for it on every view —
    two 404s per profile — and drew no card, so the reference was invisible and could not be
    withdrawn: the edit sheet offers the channels an account owns, and a deleted one is not one.
    """
    assets = (
        await session.scalars(
            select(UsernameAsset).where(UsernameAsset.community_id == community.id)
        )
    ).all()
    for asset in assets:
        asset.community_id = None
        if asset.owner_id is not None:
            session.add(
                UsernameOwnershipEvent(
                    asset_id=asset.id, to_user_id=asset.owner_id, action="community_released"
                )
            )
    slug = community.slug
    advertisers = (
        await session.scalars(
            select(UserProfileDetails).where(
                or_(
                    UserProfileDetails.featured_community_slug == slug,
                    UserProfileDetails.featured_community_slugs.is_not(None),
                )
            )
        )
    ).all()
    for details in advertisers:
        kept = [item for item in (details.featured_community_slugs or []) if item != slug]
        if kept == list(details.featured_community_slugs or []) and (
            details.featured_community_slug != slug
        ):
            continue
        details.featured_community_slugs = kept
        # The single slug is documented as the first of the list, so it follows the list.
        details.featured_community_slug = kept[0] if kept else None


@app.get("/api/admin/actions", response_model=list[AdminActionOut], tags=["admin"])
async def admin_audit_log(  # noqa: PLR0913, PLR0917
    session: SessionDep,
    admin: AdminUser,  # noqa: ARG001
    limit: Annotated[int, Query(ge=1, le=200)] = 80,
    action: Annotated[str | None, Query(max_length=40)] = None,
    actor: Annotated[str | None, Query(max_length=64)] = None,
    target_type: Annotated[str | None, Query(max_length=16)] = None,
    q: Annotated[str | None, Query(max_length=64)] = None,
    hours: Annotated[int | None, Query(ge=1, le=8760)] = None,
) -> list[AdminActionOut]:
    """
    The trail. Append-only, and readable by every admin — including about each other.

    A log worth keeping is a log that can be questioned, and eighty newest rows answer "what just
    happened" but never "what did @leon do to this payout last week". Hence the filters: by kind of
    decision, by who took it, by what it touched, and by a window in hours.
    """
    query = select(AdminAction).order_by(AdminAction.created_at.desc())
    if action:
        query = query.where(AdminAction.action == action.strip())
    if target_type:
        query = query.where(AdminAction.target_type == target_type.strip())
    if hours:
        query = query.where(AdminAction.created_at >= utcnow() - timedelta(hours=hours))
    if actor:
        who = await resolve_user(session, actor)
        if who is None:
            return []
        query = query.where(AdminAction.actor_id == who.id)
    if q:
        pattern = f"%{q.strip().lower()}%"
        query = query.where(
            or_(
                func.lower(AdminAction.target_label).like(pattern),
                func.lower(AdminAction.target_id).like(pattern),
                func.lower(AdminAction.reason).like(pattern),
            )
        )
    rows = (await session.scalars(query.limit(limit))).all()
    actors = {
        user.id: compact_user(user)
        for user in (
            await session.scalars(
                select(User).where(User.id.in_({row.actor_id for row in rows if row.actor_id}))
            )
        ).all()
    }
    return [
        AdminActionOut(
            id=row.id,
            actor=actors.get(row.actor_id) if row.actor_id else None,
            action=row.action,
            target_type=row.target_type,
            target_id=row.target_id,
            target_label=row.target_label,
            reason=row.reason,
            details=row.details,
            created_at=row.created_at,
        )
        for row in rows
    ]



# ---------------------------------------------------------------------------------------------
# Staff tools, part three: the money.
#
# Stars are the one thing here somebody paid real money for, so every star that comes in or goes
# out is a row that can be shown to a person: purchases, refunds, payouts, and the wallet history
# under them. Two of those are queues rather than logs — a refund and a payout each wait for an
# answer — and both answers live here as well as on the bot's buttons, because an admin at a
# keyboard should not have to open Telegram to do their job.
# ---------------------------------------------------------------------------------------------


async def _admin_payout_out(
    session: AsyncSession, payout: StarPayout, user: User
) -> AdminPayoutOut:
    decided_by = (
        await session.get(User, payout.decided_by_id) if payout.decided_by_id else None
    )
    crypto = await session.get(CryptoPayoutDetails, payout.id)
    return AdminPayoutOut(
        **_payout_out(payout, crypto).model_dump(),
        user=compact_user(user),
        balance=await _wallet_balance(session, user.id),
        decided_by=compact_user(decided_by) if decided_by else None,
        # A crypto payout is never automatic: the provider's API needs credentials this server does
        # not hold, so an admin sends it and records the hash. Claiming otherwise would put a
        # "confirm and done" button on something nobody has actually sent.
        automatic=(
            crypto is None and await _auto_payout_charge(session, payout) is not None
        ),
    )


@app.get("/api/admin/payouts", response_model=list[AdminPayoutOut], tags=["admin"])
async def admin_list_payouts(
    session: SessionDep,
    admin: AdminUser,  # noqa: ARG001
    payout_status: Annotated[
        Literal["pending", "open", "paid", "declined", "failed", "all"], Query(alias="status")
    ] = "pending",
    limit: Annotated[int, Query(ge=1, le=200)] = 60,
) -> list[AdminPayoutOut]:
    """
    Withdrawal requests, oldest first — a queue is served from its front.

    `open` is the pair that still needs somebody: waiting for a decision, and decided but not yet
    sent. Everything else is history.
    """
    query = select(StarPayout, User).join(User, User.id == StarPayout.user_id)
    if payout_status == "open":
        query = query.where(StarPayout.status.in_(OPEN_PAYOUT_STATUSES))
    elif payout_status != "all":
        query = query.where(StarPayout.status == payout_status)
    rows = (
        await session.execute(query.order_by(StarPayout.requested_at).limit(limit))
    ).all()
    return [await _admin_payout_out(session, payout, user) for payout, user in rows]


@app.post("/api/admin/payouts/{payout_id}/decision", response_model=AdminPayoutOut, tags=["admin"])
async def admin_decide_payout(
    payout_id: uuid.UUID, body: AdminDecision, session: SessionDep, admin: AdminUser
) -> AdminPayoutOut:
    """
    Confirm a withdrawal or refuse it.

    A confirmation does not move stars — they left the balance when the request was made — it
    authorises the Telegram half and puts the request in front of whoever sends it. A refusal is
    the only branch that touches the wallet: the held amount goes straight back.
    """
    payout = await session.scalar(
        select(StarPayout).where(StarPayout.id == payout_id).with_for_update()
    )
    if payout is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Заявка не найдена")
    if payout.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="По этой заявке уже есть решение"
        )
    note = body.note.strip()[:240]
    crypto = await session.get(CryptoPayoutDetails, payout.id)
    payout.decided_at = utcnow()
    payout.decided_by_id = admin.id
    payout.admin_note = note or None
    if body.approved:
        payout.status = "approved"
        # The destination is what the person needs to hear, and it is not the same sentence for the
        # two rails — a crypto payout has no Telegram Stars in it at all.
        arriving = (
            f"{crypto.quoted_amount:g} {crypto.asset_label} ({crypto.network_label})"
            if crypto
            else f"{payout.price_xtr} Telegram Stars"
        )
        text = f"Вывод подтверждён: {arriving} будут отправлены" + (f". {note}" if note else "")
    else:
        payout.status = "declined"
        wallet = await _wallet_for_update(session, payout.user_id)
        _ledger_change(
            session,
            wallet,
            payout.stars,
            kind="payout_declined",
            description=f"Вывод отклонён — {payout.stars} ★ снова на балансе",
            correlation_id=uuid.uuid4(),
            entity_type="star_payout",
            entity_id=str(payout.id),
        )
        text = (
            f"Вывод {payout.stars} ★ отклонён" + (f": {note}" if note else "")
        ) + f". {payout.stars} ★ вернулись на баланс"
    session.add(
        Notification(
            user_id=payout.user_id,
            actor_id=admin.id,
            kind=NotificationKind.STARS,
            text=text,
            entity_id=str(payout.id),
        )
    )
    _audit(
        session,
        admin,
        "payout_approved" if body.approved else "payout_declined",
        target_type="payout",
        target_id=str(payout.id),
        target_label=f"{payout.stars} ★ → {payout.price_xtr} XTR",
        reason=note or None,
        details={"stars": payout.stars, "xtr": payout.price_xtr},
    )
    await session.commit()
    await session.refresh(payout)
    user = await session.get(User, payout.user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Аккаунт не найден")
    return await _admin_payout_out(session, payout, user)


@app.post("/api/admin/payouts/{payout_id}/paid", response_model=AdminPayoutOut, tags=["admin"])
async def admin_payout_paid(
    payout_id: uuid.UUID, body: AdminCryptoPaidIn, session: SessionDep, admin: AdminUser
) -> AdminPayoutOut:
    """
    The money was sent. This is the admin recording that by hand.

    For a Telegram payout the note is optional and that is all there is to say. For a crypto payout
    the transaction hash is the receipt — the one thing that lets the person verify the transfer
    themselves — so it is stored on the request and shown to them. It is not *required*, because a
    payout that really was sent must always be recordable even when a hash has been mislaid, and
    refusing to close it would leave the queue lying about what has happened.
    """
    crypto = await session.get(CryptoPayoutDetails, payout_id)
    if crypto is not None and body.tx_hash:
        crypto.tx_hash = body.tx_hash
    payout = await _settle_payout(
        session, payout_id, sent=True, note=body.note or "", admin=admin
    )
    _audit(
        session,
        admin,
        "payout_paid",
        target_type="payout",
        target_id=str(payout.id),
        target_label=(
            f"{payout.stars} ★ → {crypto.quoted_amount:g} {crypto.asset_label}"
            if crypto
            else f"{payout.stars} ★ → {payout.price_xtr} XTR"
        ),
        reason=(body.note or "").strip() or None,
        details={
            "stars": payout.stars,
            "xtr": payout.price_xtr,
            "source": "panel",
            **(
                {
                    "method": "crypto",
                    "currency": crypto.currency,
                    "amount": crypto.quoted_amount,
                    "address": crypto.address,
                    "tx_hash": crypto.tx_hash,
                }
                if crypto
                else {"method": "telegram"}
            ),
        },
    )
    await session.commit()
    await session.refresh(payout)
    user = await session.get(User, payout.user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Аккаунт не найден")
    return await _admin_payout_out(session, payout, user)


@app.post("/api/admin/payouts/{payout_id}/failed", response_model=AdminPayoutOut, tags=["admin"])
async def admin_payout_failed(
    payout_id: uuid.UUID, body: AdminNote, session: SessionDep, admin: AdminUser
) -> AdminPayoutOut:
    """It could not be sent. The compensation: the held stars go back and the note says why."""
    payout = await _settle_payout(session, payout_id, sent=False, note=body.note, admin=admin)
    _audit(
        session,
        admin,
        "payout_failed",
        target_type="payout",
        target_id=str(payout.id),
        target_label=f"{payout.stars} ★ → {payout.price_xtr} XTR",
        reason=payout.admin_note,
        details={"stars": payout.stars, "xtr": payout.price_xtr, "source": "panel"},
    )
    await session.commit()
    await session.refresh(payout)
    user = await session.get(User, payout.user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Аккаунт не найден")
    return await _admin_payout_out(session, payout, user)


@app.get("/api/admin/refunds", response_model=list[AdminRefundOut], tags=["admin"])
async def admin_list_refunds(
    session: SessionDep,
    admin: AdminUser,  # noqa: ARG001
    refund_status: Annotated[
        Literal["pending", "approved", "declined", "failed", "all"], Query(alias="status")
    ] = "pending",
    limit: Annotated[int, Query(ge=1, le=200)] = 60,
) -> list[AdminRefundOut]:
    """
    Refund requests, oldest first, with the answer already worked out.

    `blocked_reason` is the same check the decision itself runs, shown beforehand: a two-week
    window closes and a balance gets spent between the asking and the answering, so an admin should
    see that an approval would fail before they press it.
    """
    query = (
        select(StarRefund, StarPurchase, User)
        .join(StarPurchase, StarPurchase.id == StarRefund.purchase_id)
        .join(User, User.id == StarRefund.user_id)
        .order_by(StarRefund.requested_at)
    )
    if refund_status != "all":
        query = query.where(StarRefund.status == refund_status)
    rows = (await session.execute(query.limit(limit))).all()
    out: list[AdminRefundOut] = []
    for refund, order, buyer in rows:
        balance = await _wallet_balance(session, buyer.id)
        out.append(
            AdminRefundOut(
                id=refund.id,
                purchase_id=order.id,
                user=compact_user(buyer),
                stars=order.stars,
                price_xtr=order.price_xtr,
                balance=balance,
                reason=refund.reason,
                status=refund.status,
                admin_note=refund.admin_note,
                telegram_charge_id=order.telegram_charge_id,
                telegram_user_id=order.telegram_user_id,
                blocked_reason=(
                    _refund_block(order, balance, None) if refund.status == "pending" else None
                ),
                requested_at=refund.requested_at,
                decided_at=refund.decided_at,
                telegram_done_at=refund.telegram_done_at,
            )
        )
    return out


@app.post("/api/admin/refunds/{refund_id}/decision", response_model=DetailResponse, tags=["admin"])
async def admin_decide_refund(
    refund_id: uuid.UUID, body: AdminDecision, session: SessionDep, admin: AdminUser
) -> DetailResponse:
    """
    The same decision the bot's buttons take, taken in the panel instead.

    Identical money movement, because it is the same code. What the panel cannot do is call
    Telegram: an approval here lands in `/api/bot/refunds/approved`, and the bot carries out the
    Telegram half on its next poll.
    """
    refund, order, applied = await _apply_refund_decision(
        session, refund_id, approved=body.approved, note=body.note, admin=admin
    )
    _audit(
        session,
        admin,
        "refund_approved" if body.approved else "refund_declined",
        target_type="refund",
        target_id=str(refund.id),
        target_label=f"{order.stars} ★ / {order.price_xtr} XTR",
        reason=refund.admin_note,
        details={"stars": order.stars, "xtr": order.price_xtr, "source": "panel"},
    )
    await session.commit()
    return DetailResponse(
        detail=(
            "Возврат одобрен — бот вернёт Telegram Stars при следующей проверке"
            if applied.status == "approved"
            else "Возврат отклонён"
        )
    )


@app.get("/api/admin/star-orders", response_model=list[AdminStarOrderOut], tags=["admin"])
async def admin_list_star_orders(
    session: SessionDep,
    admin: AdminUser,  # noqa: ARG001
    order_status: Annotated[
        Literal["paid", "pending", "refunded", "cancelled", "all"], Query(alias="status")
    ] = "paid",
    q: Annotated[str | None, Query(max_length=64)] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 60,
) -> list[AdminStarOrderOut]:
    """Every Telegram Stars purchase, newest first. The income side of the same ledger."""
    query = select(StarPurchase, User).join(User, User.id == StarPurchase.user_id)
    if order_status != "all":
        query = query.where(StarPurchase.status == order_status)
    if q:
        needle = q.strip().lstrip("@").lower()
        query = query.where(
            or_(
                func.lower(User.username).like(f"%{needle}%"),
                func.lower(StarPurchase.telegram_charge_id).like(f"%{needle}%"),
            )
        )
    rows = (
        await session.execute(query.order_by(StarPurchase.created_at.desc()).limit(limit))
    ).all()
    refunds = await _refunds_for(session, [order.id for order, _user in rows])
    return [
        AdminStarOrderOut(
            id=order.id,
            user=compact_user(user),
            package_slug=order.package_slug,
            stars=order.stars,
            price_xtr=order.price_xtr,
            status="expired" if _order_expired(order) else order.status,
            telegram_user_id=order.telegram_user_id,
            telegram_charge_id=order.telegram_charge_id,
            created_at=order.created_at,
            paid_at=order.paid_at,
            refund_status=refunds[order.id].status if order.id in refunds else None,
        )
        for order, user in rows
    ]


@app.get("/api/admin/crypto-invoices", response_model=list[AdminCryptoInvoiceOut], tags=["admin"])
async def admin_list_crypto_invoices(
    session: SessionDep,
    admin: AdminUser,  # noqa: ARG001
    invoice_status: Annotated[
        Literal["pending", "paid", "underpaid", "failed", "expired", "cancelled", "all"],
        Query(alias="status"),
    ] = "all",
    q: Annotated[str | None, Query(max_length=64)] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 60,
) -> list[AdminCryptoInvoiceOut]:
    """
    Every crypto top-up, newest first — the other half of the income side.

    Searchable by handle, by our order id and by the provider's payment id, because those are the
    three things somebody asking "where is my money" can actually quote.
    """
    query = select(CryptoInvoice, User).join(User, User.id == CryptoInvoice.user_id)
    if invoice_status != "all":
        query = query.where(CryptoInvoice.status == invoice_status)
    if q:
        needle = q.strip().lstrip("@").lower()
        query = query.where(
            or_(
                func.lower(User.username).like(f"%{needle}%"),
                func.lower(CryptoInvoice.order_id).like(f"%{needle}%"),
                func.lower(CryptoInvoice.provider_payment_id).like(f"%{needle}%"),
            )
        )
    rows = (
        await session.execute(query.order_by(CryptoInvoice.created_at.desc()).limit(limit))
    ).all()
    return [
        AdminCryptoInvoiceOut(
            id=invoice.id,
            user=compact_user(user),
            package_slug=invoice.package_slug,
            stars=invoice.stars,
            price_amount=invoice.price_amount,
            price_currency=invoice.price_currency,
            pay_currency=invoice.pay_currency,
            asset_label=_crypto_labels(invoice.pay_currency)[0],
            network_label=invoice.network_label or _crypto_labels(invoice.pay_currency)[1],
            pay_amount=invoice.pay_amount,
            actually_paid=invoice.actually_paid,
            status=invoice.status,
            provider_status=invoice.provider_status,
            provider_payment_id=invoice.provider_payment_id,
            provider_note=invoice.provider_note,
            order_id=invoice.order_id,
            created_at=invoice.created_at,
            credited_at=invoice.credited_at,
        )
        for invoice, user in rows
    ]


@app.post(
    "/api/admin/crypto-invoices/{invoice_id}/recheck",
    response_model=AdminCryptoInvoiceOut,
    tags=["admin"],
)
async def admin_recheck_crypto_invoice(
    invoice_id: uuid.UUID, session: SessionDep, admin: AdminUser
) -> AdminCryptoInvoiceOut:
    """
    Ask the provider again about one payment, and credit it if it turns out to be paid.

    The manual counterpart to the buyer's own poll, for the case where a callback was lost and
    nobody had the page open. It goes through exactly the same settle path, so it cannot double
    credit: the latch is checked under the row lock either way.
    """
    del admin
    _require_crypto()
    invoice = await session.get(CryptoInvoice, invoice_id)
    if invoice is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Счёт не найден")
    settled = await _settle_crypto_invoice(session, invoice_id)
    user = await session.get(User, settled.user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Аккаунт не найден")
    return AdminCryptoInvoiceOut(
        id=settled.id,
        user=compact_user(user),
        package_slug=settled.package_slug,
        stars=settled.stars,
        price_amount=settled.price_amount,
        price_currency=settled.price_currency,
        pay_currency=settled.pay_currency,
        asset_label=_crypto_labels(settled.pay_currency)[0],
        network_label=settled.network_label or _crypto_labels(settled.pay_currency)[1],
        pay_amount=settled.pay_amount,
        actually_paid=settled.actually_paid,
        status=settled.status,
        provider_status=settled.provider_status,
        provider_payment_id=settled.provider_payment_id,
        provider_note=settled.provider_note,
        order_id=settled.order_id,
        created_at=settled.created_at,
        credited_at=settled.credited_at,
    )


@app.get("/api/admin/ledger", response_model=list[AdminLedgerOut], tags=["admin"])
async def admin_star_ledger(
    session: SessionDep,
    admin: AdminUser,  # noqa: ARG001
    username: Annotated[str | None, Query(max_length=64)] = None,
    kind: Annotated[str | None, Query(max_length=40)] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 80,
) -> list[AdminLedgerOut]:
    """
    Everybody's wallet history in one place.

    The panel could show balances and nothing else, and then "куда ушли 500 ★" would have no
    answer. This is that answer: every line, whose it is, and what it was for — filterable by
    account and by kind of movement.
    """
    holder = aliased(User)
    other = aliased(User)
    query = (
        select(StarLedger, holder, other)
        .join(holder, holder.id == StarLedger.user_id)
        .outerjoin(other, other.id == StarLedger.counterparty_id)
        .order_by(StarLedger.created_at.desc())
    )
    if username:
        who = await resolve_user(session, username)
        if who is None:
            return []
        query = query.where(StarLedger.user_id == who.id)
    if kind:
        query = query.where(StarLedger.kind == kind.strip())
    rows = (await session.execute(query.limit(limit))).all()
    return [
        AdminLedgerOut(
            id=entry.id,
            user=compact_user(owner),
            counterparty=compact_user(counterparty) if counterparty else None,
            amount=entry.amount,
            balance_after=entry.balance_after,
            kind=entry.kind,
            description=entry.description,
            entity_type=entry.entity_type,
            entity_id=entry.entity_id,
            created_at=entry.created_at,
        )
        for entry, owner, counterparty in rows
    ]


@app.post("/api/admin/broadcast", response_model=DetailResponse, tags=["admin"])
async def admin_broadcast(
    body: AdminBroadcast, session: SessionDep, admin: AdminUser
) -> DetailResponse:
    """
    One announcement to many people, as a notification each.

    Scoped, because an announcement about Premium is noise for accounts without it. Banned accounts
    are left out — a message to somebody who cannot read it is not communication — and the whole
    thing is one audit row saying how many were reached, so nobody has to guess afterwards.
    """
    text = " ".join(body.text.split())
    query = select(User.id).where(User.banned_at.is_(None))
    if body.scope == "admins":
        query = query.where(User.is_admin.is_(True))
    elif body.scope == "active":
        # Presence lives on the profile-details row, not on the account itself.
        recently_seen = select(UserProfileDetails.user_id).where(
            UserProfileDetails.last_seen_at >= utcnow() - timedelta(days=30)
        )
        query = query.where(User.id.in_(recently_seen))
    recipients = list((await session.scalars(query)).all())
    if body.scope == "premium":
        premium = await premium_user_ids(session, recipients)
        recipients = [user_id for user_id in recipients if user_id in premium]
    for user_id in recipients:
        _notify(session, user_id, text, actor_id=admin.id)
    _audit(
        session,
        admin,
        "broadcast_sent",
        target_type="system",
        target_id=body.scope,
        target_label=f"{len(recipients)} получателей",
        reason=text[:240],
        details={"scope": body.scope, "recipients": len(recipients)},
    )
    await session.commit()
    return DetailResponse(detail=f"Отправлено {len(recipients)} получателям")


# ---------------------------------------------------------------------------------------------
# Staff tools, part two: the inventory an account actually holds.
#
# The first block decides about people. This one decides about their things — collectibles,
# handles, posts — because "управлять пользователем" without being able to touch what they own
# is only half a panel.
# ---------------------------------------------------------------------------------------------


@app.get("/api/admin/users/{username}/inventory", response_model=AdminInventoryOut, tags=["admin"])
async def admin_user_inventory(
    username: str,
    session: SessionDep,
    admin: AdminUser,  # noqa: ARG001
) -> AdminInventoryOut:
    """Everything staff can act on for one account, in one request rather than four."""
    user = await _admin_target(session, username)
    gifts = (
        await session.scalars(
            select(Gift).where(Gift.owner_id == user.id).order_by(Gift.received_at.desc())
        )
    ).all()
    transfers = {
        row[0]: int(row[1])
        for row in (
            await session.execute(
                select(GiftTransfer.gift_id, func.count())
                .where(GiftTransfer.gift_id.in_([gift.id for gift in gifts] or [uuid.uuid4()]))
                .group_by(GiftTransfer.gift_id)
            )
        ).all()
    }
    handles = (
        await session.scalars(
            select(UsernameAsset)
            .where(UsernameAsset.owner_id == user.id)
            .order_by(UsernameAsset.username)
        )
    ).all()
    history = {
        row[0]: int(row[1])
        for row in (
            await session.execute(
                select(UsernameOwnershipEvent.asset_id, func.count()).group_by(
                    UsernameOwnershipEvent.asset_id
                )
            )
        ).all()
    }
    posts = (
        await session.scalars(
            select(Post)
            .where(Post.author_id == user.id)
            .order_by(Post.created_at.desc())
            .limit(40)
        )
    ).all()
    community_ids = {post.community_id for post in posts if post.community_id}
    communities = (
        {
            row[0]: row[1]
            for row in (
                await session.execute(
                    select(Community.id, Community.slug).where(Community.id.in_(community_ids))
                )
            ).all()
        }
        if community_ids
        else {}
    )
    post_reports = {
        row[0]: int(row[1])
        for row in (
            await session.execute(
                select(ContentReport.target_id, func.count())
                .where(ContentReport.target_kind == "post")
                .group_by(ContentReport.target_id)
            )
        ).all()
    }
    return AdminInventoryOut(
        gifts=[
            AdminGiftItem(
                id=gift.id,
                slug=gift.slug,
                name=gift.name,
                serial_number=gift.serial_number,
                rarity=str(gift.rarity),
                upgraded=gift.upgraded_at is not None,
                model_name=gift.model_name or "",
                accent=gift.accent,
                design_slug=design_slug(gift.slug),
                is_listed=gift.sale_price_stars is not None,
                sale_price_stars=gift.sale_price_stars,
                transfers_count=transfers.get(gift.id, 0),
                received_at=gift.received_at,
            )
            for gift in gifts
        ],
        usernames=[
            AdminUsernameItem(
                username=asset.username,
                status=str(asset.status),
                is_primary=asset.username.lower() == user.username.lower(),
                price=float(asset.price) if asset.price is not None else None,
                history_count=history.get(asset.id, 0),
            )
            for asset in handles
        ],
        posts=[
            AdminPostItem(
                id=post.id,
                content=post.content[:280],
                created_at=post.created_at,
                hidden_at=post.hidden_at,
                hidden_reason=post.hidden_reason,
                community_slug=communities.get(post.community_id) if post.community_id else None,
                reports_count=post_reports.get(str(post.id), 0),
            )
            for post in posts
        ],
    )


@app.patch("/api/admin/gifts/{gift_id}", response_model=GiftOut, tags=["admin"])
async def admin_update_gift(  # noqa: C901, PLR0915
    gift_id: uuid.UUID, payload: AdminGiftUpdate, session: SessionDep, admin: AdminUser
) -> GiftOut:
    """
    Rewrite what a collectible shows, or take its upgrade away.

    Named variants are validated against the design's real pools: staff picking a model that
    Telegram never made for this gift would put artwork in somebody's collection that no URL
    can resolve, and the tile would silently render empty.
    """
    gift = await session.scalar(select(Gift).where(Gift.id == gift_id).with_for_update())
    if gift is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Подарок не найден")
    slug = design_slug(gift.slug)
    source = giftart.BY_SLUG.get(slug)
    if source is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="У этого подарка нет каталога вариантов"
        )
    changed: dict[str, Any] = {}
    if payload.upgraded is False:
        gift.upgraded_at = None
        gift.model_name = ""
        gift.pattern = ""
        gift.pattern_color = "#ffffff"
        gift.text_color = "#ffffff"
        changed["upgraded"] = False
    if payload.model is not None:
        chosen = next((item for item in source.models if item.name == payload.model), None)
        if chosen is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"У «{gift.name}» нет модели «{payload.model}»",
            )
        gift.model_name = chosen.name
        gift.upgraded_at = gift.upgraded_at or utcnow()
        changed["model"] = chosen.name
    if payload.backdrop is not None:
        chosen_backdrop = next(
            (item for item in source.backdrops if item.name == payload.backdrop), None
        )
        if chosen_backdrop is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"У «{gift.name}» нет фона «{payload.backdrop}»",
            )
        gift.accent = chosen_backdrop.center
        gift.backdrop_edge = chosen_backdrop.edge
        gift.pattern_color = chosen_backdrop.pattern
        gift.text_color = chosen_backdrop.text
        gift.upgraded_at = gift.upgraded_at or utcnow()
        changed["backdrop"] = chosen_backdrop.name
    if payload.symbol is not None:
        chosen_symbol = next((item for item in source.symbols if item.name == payload.symbol), None)
        if chosen_symbol is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"У «{gift.name}» нет узора «{payload.symbol}»",
            )
        gift.pattern = chosen_symbol.name
        gift.upgraded_at = gift.upgraded_at or utcnow()
        changed["symbol"] = chosen_symbol.name
    if not changed:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Нечего изменять"
        )
    collectible = await session.scalar(
        select(GiftCollectible).where(GiftCollectible.gift_id == gift.id)
    )
    if collectible is not None:
        collectible.model = gift.model_name
        collectible.symbol = gift.pattern
        traits = dict(collectible.traits or {})
        traits.update({"model": gift.model_name, "symbol": gift.pattern})
        if "backdrop" in changed:
            collectible.backdrop = str(changed["backdrop"])
            traits["backdrop"] = changed["backdrop"]
        collectible.traits = traits
    label = f"{gift.name} #{gift.serial_number}"
    _audit(
        session,
        admin,
        "gift_updated",
        target_type="gift",
        target_id=str(gift.id),
        target_label=label,
        reason=payload.reason,
        details=changed,
    )
    _notify(
        session,
        gift.owner_id,
        f"Администрация изменила ваш подарок «{label}»"
        + (f". Причина: {payload.reason}" if payload.reason else ""),
        actor_id=admin.id,
        entity_id=str(gift.id),
    )
    await session.commit()
    await session.refresh(gift)
    owner = await session.get(User, gift.owner_id)
    return await render_gift(session, gift, owner or admin, admin)


@app.post("/api/admin/gifts/{gift_id}/transfer", response_model=GiftOut, tags=["admin"])
async def admin_transfer_gift(
    gift_id: uuid.UUID, payload: AdminGiftTransfer, session: SessionDep, admin: AdminUser
) -> GiftOut:
    """Move a collectible to another account, recording it as a transfer like any other."""
    gift = await session.scalar(select(Gift).where(Gift.id == gift_id).with_for_update())
    if gift is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Подарок не найден")
    recipient = await _admin_target(session, payload.username)
    if recipient.id == gift.owner_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"@{recipient.username} и так владеет этим подарком",
        )
    previous_id = gift.owner_id
    previous = await session.get(User, previous_id)
    label = f"{gift.name} #{gift.serial_number}"
    session.add(
        GiftTransfer(
            gift_id=gift.id,
            from_user_id=previous_id,
            to_user_id=recipient.id,
            note=payload.reason or "Передано администрацией",
        )
    )
    gift.owner_id = recipient.id
    gift.received_at = utcnow()
    gift.sale_price_stars = None
    gift.listed_at = None
    gift.message = None
    # A showcased gift that changed hands must leave the previous owner's profile slots.
    await session.execute(
        delete(GiftShowcase).where(
            GiftShowcase.gift_id == gift.id, GiftShowcase.user_id == previous_id
        )
    )
    _audit(
        session,
        admin,
        "gift_transferred",
        target_type="gift",
        target_id=str(gift.id),
        target_label=label,
        reason=payload.reason,
        details={"from": previous.username if previous else None, "to": recipient.username},
    )
    if previous is not None:
        _notify(
            session,
            previous.id,
            f"Администрация передала ваш подарок «{label}» пользователю @{recipient.username}"
            + (f". Причина: {payload.reason}" if payload.reason else ""),
            actor_id=admin.id,
        )
    _notify(
        session,
        recipient.id,
        f"Администрация передала вам подарок «{label}»",
        actor_id=admin.id,
        entity_id=str(gift.id),
    )
    await session.commit()
    await session.refresh(gift)
    return await render_gift(session, gift, recipient, admin)


@app.delete("/api/admin/gifts/{gift_id}/history", response_model=DetailResponse, tags=["admin"])
async def admin_clear_gift_history(
    gift_id: uuid.UUID,
    session: SessionDep,
    admin: AdminUser,
    reason: Annotated[str, Query(min_length=3, max_length=240)],
) -> DetailResponse:
    """
    Wipe one collectible's transfer history.

    Provenance is the point of a collectible, so this is not a routine action — it exists for the
    case where the trail itself is the problem (a leaked handle, a mistaken chain of gifts), and
    it is logged with the reason precisely because it destroys evidence.
    """
    gift = await session.get(Gift, gift_id)
    if gift is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Подарок не найден")
    # Counted before the delete: the audit entry should say how much history was destroyed, and
    # `rowcount` is not part of the typed Result contract.
    removed = int(
        await session.scalar(
            select(func.count()).select_from(GiftTransfer).where(GiftTransfer.gift_id == gift.id)
        )
        or 0
    )
    await session.execute(delete(GiftTransfer).where(GiftTransfer.gift_id == gift.id))
    label = f"{gift.name} #{gift.serial_number}"
    _audit(
        session,
        admin,
        "gift_history_cleared",
        target_type="gift",
        target_id=str(gift.id),
        target_label=label,
        reason=reason,
        details={"removed": removed},
    )
    _notify(
        session,
        gift.owner_id,
        f"Администрация очистила историю передач «{label}». Причина: {reason}",
        actor_id=admin.id,
        entity_id=str(gift.id),
    )
    await session.commit()
    return DetailResponse(detail="gift_history_cleared")


@app.get("/api/admin/gift-designs", response_model=list[AdminDesignOut], tags=["admin"])
async def admin_list_designs(
    session: SessionDep,
    admin: AdminUser,  # noqa: ARG001
    q: Annotated[str | None, Query(max_length=64)] = None,
) -> list[AdminDesignOut]:
    query = select(GiftModel)
    if q:
        pattern = f"%{q.strip().lower()}%"
        query = query.where(
            or_(func.lower(GiftModel.slug).like(pattern), func.lower(GiftModel.name).like(pattern))
        )
    designs = (await session.scalars(query.order_by(GiftModel.name).limit(200))).all()
    # `plush-pepe-042` -> `plush-pepe`: the mint count per design, without a join.
    design_of_gift = func.substr(Gift.slug, 1, func.length(Gift.slug) - 4)
    minted = {
        row[0]: int(row[1])
        for row in (
            await session.execute(
                select(design_of_gift, func.count()).group_by(design_of_gift)
            )
        ).all()
    }
    return [
        AdminDesignOut(
            slug=design.slug,
            name=design.name,
            price_stars=design.price_stars,
            edition_size=design.edition_size,
            minted=minted.get(design.slug, 0),
            remaining=max(0, design.edition_size - minted.get(design.slug, 0)),
            limited=design.limited,
            available=design.available,
            on_market=design.on_market,
            models_count=len(design.models_pool or []),
            backdrops_count=len(design.backdrops_pool or []),
            symbols_count=len(design.symbols_pool or []),
        )
        for design in designs
    ]


@app.patch("/api/admin/gift-designs/{slug}", response_model=AdminDesignOut, tags=["admin"])
async def admin_update_design(
    slug: str, payload: AdminDesignUpdate, session: SessionDep, admin: AdminUser
) -> AdminDesignOut:
    """
    Change the supply and the price of a design.

    Lowering `edition_size` below what has already been minted is refused: the remaining count
    would go negative, and the serials already in people's collections would start claiming to
    be out of a run smaller than themselves.
    """
    design = await session.scalar(select(GiftModel).where(GiftModel.slug == slug))
    if design is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Дизайн не найден")
    minted = int(
        await session.scalar(
            select(func.count()).select_from(Gift).where(Gift.slug.like(f"{design.slug}-%"))
        )
        or 0
    )
    fields = payload.model_dump(exclude_unset=True, exclude={"reason"})
    if not fields:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Нечего изменять"
        )
    if payload.edition_size is not None and payload.edition_size < minted:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Уже выпущено {minted} — тираж нельзя опустить ниже",
        )
    for field, value in fields.items():
        setattr(design, field, value)
    _audit(
        session,
        admin,
        "design_updated",
        target_type="gift_design",
        target_id=design.slug,
        target_label=design.name,
        reason=payload.reason,
        details=fields,
    )
    await session.commit()
    await session.refresh(design)
    return AdminDesignOut(
        slug=design.slug,
        name=design.name,
        price_stars=design.price_stars,
        edition_size=design.edition_size,
        minted=minted,
        remaining=max(0, design.edition_size - minted),
        limited=design.limited,
        available=design.available,
        on_market=design.on_market,
        models_count=len(design.models_pool or []),
        backdrops_count=len(design.backdrops_pool or []),
        symbols_count=len(design.symbols_pool or []),
    )


@app.post("/api/admin/usernames/{handle}/transfer", response_model=AdminUserOut, tags=["admin"])
async def admin_transfer_username(
    handle: str, payload: AdminGiftTransfer, session: SessionDep, admin: AdminUser
) -> AdminUserOut:
    """Hand a collectible handle from whoever holds it to somebody else, and record the move."""
    normalized = handle.strip().removeprefix("@").lower()
    recipient = await _admin_target(session, payload.username)
    # Checked before the asset lookup: a live account handle usually has no collectible row at
    # all, and "@nikita не найден" would be a confusing way to say "that is somebody's name".
    account = await session.scalar(select(User).where(func.lower(User.username) == normalized))
    if account is not None and account.id != recipient.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"@{normalized} — основной ник @{account.username}, сначала смените его",
        )
    asset = await session.scalar(
        select(UsernameAsset).where(func.lower(UsernameAsset.username) == normalized)
    )
    if asset is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"@{normalized} не найден"
        )
    if asset.owner_id == recipient.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"@{normalized} уже принадлежит @{recipient.username}",
        )
    previous_id = asset.owner_id
    previous = await session.get(User, previous_id) if previous_id else None
    asset.owner_id = recipient.id
    asset.status = UsernameStatus.RESERVED
    asset.price = None
    asset.listed_at = None
    asset.reserved_at = utcnow()
    session.add(
        UsernameOwnershipEvent(
            asset_id=asset.id,
            from_user_id=previous_id,
            to_user_id=recipient.id,
            action="admin_transfer",
        )
    )
    _audit(
        session,
        admin,
        "username_transferred",
        target_type="username",
        target_id=asset.username,
        target_label=f"@{asset.username}",
        reason=payload.reason,
        details={"from": previous.username if previous else None, "to": recipient.username},
    )
    if previous is not None:
        _notify(
            session,
            previous.id,
            f"Администрация передала ваш ник @{asset.username} "
            f"пользователю @{recipient.username}"
            + (f". Причина: {payload.reason}" if payload.reason else ""),
            actor_id=admin.id,
        )
    _notify(
        session,
        recipient.id,
        f"Администрация передала вам ник @{asset.username}",
        actor_id=admin.id,
    )
    await session.commit()
    await session.refresh(recipient)
    return await admin_user_out(session, recipient)


@app.delete(
    "/api/admin/usernames/{handle}/history", response_model=DetailResponse, tags=["admin"]
)
async def admin_clear_username_history(
    handle: str,
    session: SessionDep,
    admin: AdminUser,
    reason: Annotated[str, Query(min_length=3, max_length=240)],
) -> DetailResponse:
    """Wipe one handle's ownership trail. Logged, for the same reason gift history is."""
    normalized = handle.strip().removeprefix("@").lower()
    asset = await session.scalar(
        select(UsernameAsset).where(func.lower(UsernameAsset.username) == normalized)
    )
    if asset is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"@{normalized} не найден"
        )
    removed = int(
        await session.scalar(
            select(func.count())
            .select_from(UsernameOwnershipEvent)
            .where(UsernameOwnershipEvent.asset_id == asset.id)
        )
        or 0
    )
    await session.execute(
        delete(UsernameOwnershipEvent).where(UsernameOwnershipEvent.asset_id == asset.id)
    )
    _audit(
        session,
        admin,
        "username_history_cleared",
        target_type="username",
        target_id=asset.username,
        target_label=f"@{asset.username}",
        reason=reason,
        details={"removed": removed},
    )
    if asset.owner_id:
        _notify(
            session,
            asset.owner_id,
            f"Администрация очистила историю ника @{asset.username}. Причина: {reason}",
            actor_id=admin.id,
        )
    await session.commit()
    return DetailResponse(detail="username_history_cleared")


@app.delete("/api/admin/posts/{post_id}", response_model=DetailResponse, tags=["admin"])
async def admin_delete_post(
    post_id: uuid.UUID,
    session: SessionDep,
    admin: AdminUser,
    reason: Annotated[str, Query(min_length=3, max_length=240)],
) -> DetailResponse:
    """
    Delete a post outright.

    Hiding is the default and this is the exception: it exists for content that must not remain
    on disk at all. The author is told, because a post that vanishes without a word is how a
    platform teaches people it is arbitrary.
    """
    post = await session.get(Post, post_id)
    if post is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Публикация не найдена")
    _audit(
        session,
        admin,
        "post_deleted",
        target_type="post",
        target_id=str(post.id),
        target_label=post.content[:120],
        reason=reason,
    )
    _notify(
        session,
        post.author_id,
        f"Администрация удалила вашу публикацию. Причина: {reason}",
        actor_id=admin.id,
    )
    await session.delete(post)
    await session.commit()
    return DetailResponse(detail="post_deleted")


@app.post("/api/admin/communities/{slug}/owner", response_model=AdminCommunityOut, tags=["admin"])
async def admin_transfer_community(
    slug: str, payload: AdminOwnerTransfer, session: SessionDep, admin: AdminUser
) -> AdminCommunityOut:
    """Hand a community to somebody else — the alternative to closing it."""
    community = await session.scalar(select(Community).where(Community.slug == slug))
    if community is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Сообщество не найдено")
    recipient = await _admin_target(session, payload.username)
    if community.owner_id == recipient.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=f"@{recipient.username} и так владелец"
        )
    previous = await session.get(User, community.owner_id) if community.owner_id else None
    community.owner_id = recipient.id
    # The new owner has to be a member, or they would own a community they cannot post in.
    membership = await session.scalar(
        select(CommunityMember).where(
            CommunityMember.community_id == community.id,
            CommunityMember.user_id == recipient.id,
        )
    )
    if membership is None:
        session.add(CommunityMember(community_id=community.id, user_id=recipient.id))
        community.members_count += 1
    _audit(
        session,
        admin,
        "community_transferred",
        target_type="community",
        target_id=community.slug,
        target_label=community.title,
        reason=payload.reason,
        details={"from": previous.username if previous else None, "to": recipient.username},
    )
    if previous is not None:
        _notify(
            session,
            previous.id,
            "Администрация передала сообщество "
            f"«{community.title}» пользователю @{recipient.username}",
            actor_id=admin.id,
        )
    _notify(
        session,
        recipient.id,
        f"Администрация передала вам сообщество «{community.title}»",
        actor_id=admin.id,
    )
    await session.commit()
    await session.refresh(community)
    return AdminCommunityOut(
        id=community.id,
        slug=community.slug,
        title=community.title,
        description=community.description or "",
        category=community.category,
        location=community.location,
        owner=compact_user(recipient),
        members_count=community.members_count,
        posts_count=0,
        reports_count=0,
        created_at=community.created_at,
    )


@app.delete("/api/admin/users/{username}", response_model=DetailResponse, tags=["admin"])
async def admin_delete_account(
    username: str, payload: AdminAccountDelete, session: SessionDep, admin: AdminUser
) -> DetailResponse:
    """
    Delete an account for good.

    The only staff action with nothing left to review afterwards, so it is the only one that
    makes staff type the handle again. An admin cannot be deleted while they hold the flag, and
    nobody deletes themselves here — that is what the account settings are for.
    """
    user = await _admin_target(session, username)
    if payload.confirm_username.strip().removeprefix("@").lower() != user.username.lower():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Для подтверждения введите @{user.username}",
        )
    if user.id == admin.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Свой аккаунт удаляют в настройках, а не в панели",
        )
    if user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Сначала снимите права администратора",
        )
    owned = (await session.scalars(select(Community).where(Community.owner_id == user.id))).all()
    for community in owned:
        if payload.communities == "delete":
            # Handles and profile cards pointing at it have to let go first, exactly as when an
            # admin closes a single channel — deleting the row does not update what referred to it.
            await _release_community_handles(session, community)
            await session.delete(community)
        else:
            # Handed to the acting admin rather than orphaned: `owner_id` is RESTRICT, and a
            # community with no owner cannot be moderated by anybody.
            community.owner_id = admin.id
    # Transfer history references users with RESTRICT, so it goes before the account row.
    await session.execute(
        delete(GiftTransfer).where(
            or_(GiftTransfer.from_user_id == user.id, GiftTransfer.to_user_id == user.id)
        )
    )
    # Release the handles this account held, or the names stay reserved to nobody for good.
    await session.execute(
        update(UsernameAsset)
        .where(UsernameAsset.owner_id == user.id)
        .values(
            owner_id=None,
            status=UsernameStatus.AVAILABLE,
            reserved_at=None,
            listed_at=None,
            price=None,
        )
    )
    _audit(
        session,
        admin,
        "user_deleted",
        target_type="user",
        target_id=str(user.id),
        target_label=f"@{user.username}",
        reason=payload.reason,
        details={
            "communities": payload.communities,
            "owned_communities": [community.slug for community in owned],
        },
    )
    await session.delete(user)
    await session.commit()
    return DetailResponse(detail="account_deleted")
