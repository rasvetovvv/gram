"""FastAPI application for the GRAM social messenger."""

from __future__ import annotations

import asyncio
import hashlib
import logging
import re
import uuid
from collections import Counter, defaultdict
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager, suppress
from datetime import UTC, datetime, timedelta
from io import BytesIO
from typing import Annotated, Any

import jwt
from fastapi import (
    Cookie,
    Depends,
    FastAPI,
    File,
    Form,
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
from pydantic import ValidationError
from sqlalchemy import and_, delete, func, or_, select, true, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased
from starlette.concurrency import run_in_threadpool

from app import giftart, music
from app.config import (
    ACCESS_COOKIE,
    ACCESS_TOKEN_MINUTES,
    AUTO_SEED,
    COOKIE_DOMAIN,
    COOKIE_SECURE,
    CORS_ORIGINS,
    ENABLE_INTERNAL_LEDGER_TOPUPS,
    MAX_PARKED_ACCOUNTS,
    MAX_UPLOAD_BYTES,
    MAX_VIDEO_BYTES,
    MEDIA_ROOT,
    PARKED_COOKIE_PREFIX,
    PREFETCH_GIFT_ART,
    REFRESH_COOKIE,
    REFRESH_TOKEN_DAYS,
)
from app.db import SessionFactory, create_schema, get_session
from app.gifts import (
    CATEGORIES,
    CATEGORY_LABELS,
    DESIGN_BY_SLUG,
)
from app.models import (
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
    Follow,
    FollowRequest,
    Gift,
    GiftCollectible,
    GiftModel,
    GiftOffer,
    GiftShowcase,
    GiftTransfer,
    Message,
    MessageHide,
    MessageReaction,
    Notification,
    NotificationKind,
    Post,
    PostBookmark,
    PostComment,
    PostCommentLike,
    PostLike,
    PostMute,
    PostPollVote,
    PostRepost,
    PostView,
    PremiumEntitlement,
    ProfileStory,
    RefreshSession,
    StarLedger,
    StarWallet,
    User,
    UserBlock,
    UsernameAsset,
    UsernameOwnershipEvent,
    UsernameStatus,
    UserPreferences,
    UserProfileDetails,
    UserSettings,
    utcnow,
)
from app.schemas import (
    MAX_POST_IMAGES,
    MIN_POLL_OPTIONS,
    AccountDeleteRequest,
    AccountSlot,
    AuthResponse,
    AuthSessionOut,
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
    CommunityVerification,
    CreatorAnalyticsOut,
    CreatorSeriesPoint,
    CreatorSettingsOut,
    CreatorSettingsUpdate,
    DetailResponse,
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
    GroupCreate,
    GroupMembersAdd,
    GroupUpdate,
    HealthResponse,
    LoginRequest,
    MessageCreate,
    MessageEdit,
    MessageForward,
    MessageQuote,
    MessageReactionOut,
    NoteUpsert,
    NotificationOut,
    OffersToggle,
    PasswordChange,
    PollOption,
    PostCommentCreate,
    PostCommentEdit,
    PostCommentOut,
    PostCreate,
    PostEdit,
    PostMusic,
    PostPollOut,
    PostReportCreate,
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
    StarSendRequest,
    StarTopUpRequest,
    StarTransferReceipt,
    SubscriptionCreate,
    SubscriptionOut,
    ToggleState,
    TrendOut,
    UploadedMedia,
    UserCompact,
    UsernameAssetOut,
    UsernameHistoryOut,
    UsernameListingUpdate,
    UsernameReserve,
    UserProfile,
    UserReportCreate,
    UserSettingsOut,
    UserSettingsUpdate,
    WalletOut,
)
from app.security import (
    create_access_token,
    decode_access_token,
    hash_password,
    new_refresh_token,
    refresh_expiry,
    refresh_token_hash,
    verify_password,
)
from app.seed import seed_database

SessionDep = Annotated[AsyncSession, Depends(get_session)]
LEGENDARY_USERNAME_LENGTH = 4
RARE_USERNAME_LENGTH = 6
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
    yield
    presence.cancel()
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
    if await _touch_presence(session, user, online=True):
        await session.commit()
    return user


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
        verification_tier="official" if user.is_verified else None,
        # Someone who hides their presence is never advertised as online, wherever they appear.
        is_online=user.is_online and not hide_presence,
        profile_color=user.profile_color or "default",
        is_premium=is_premium,
        is_admin=user.is_admin,
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


def profile_story_out(story: ProfileStory, author: User) -> ProfileStoryOut:
    return ProfileStoryOut(
        id=story.id,
        author=compact_user(author),
        title=story.title,
        media_url=story.media_url,
        created_at=story.created_at,
        expires_at=story.expires_at,
        highlight=story.highlight,
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
            .where(UsernameAsset.owner_id == user.id)
            .order_by(UsernameAsset.username)
        )
    ).all()
    # Handles claimed by another account must not be advertised here, even if typed manually.
    foreign_handles = set(
        (
            await session.scalars(
                select(func.lower(UsernameAsset.username)).where(
                    UsernameAsset.owner_id.is_not(None), UsernameAsset.owner_id != user.id
                )
            )
        ).all()
    ) | set(
        (
            await session.scalars(
                select(func.lower(User.username)).where(User.id != user.id)
            )
        ).all()
    )
    owned_lookup = {handle.lower() for handle in owned_handles}
    # "а также" must reflect handles the account actually owns, not free-typed text.
    related: list[str] = []
    for handle in [*(user.related_usernames or []), *owned_handles]:
        normalized = handle.strip().removeprefix("@").lower()
        if not normalized or normalized == user.username.lower() or normalized in related:
            continue
        if normalized in foreign_handles and normalized not in owned_lookup:
            continue
        related.append(normalized)
    # The owner's own switches: presence and content visibility are theirs to set, and the
    # profile is where every other screen reads the result from.
    settings = await session.get(UserSettings, user.id)
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
        badges=profile_badges(user.badges),
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
}


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


async def resolve_user(session: AsyncSession, username: str) -> User | None:
    """Resolve a profile by its current handle or by any collectible username it owns."""
    normalized = username.strip().lower().removeprefix("@")
    if not normalized:
        return None
    user = await session.scalar(select(User).where(func.lower(User.username) == normalized))
    if user is not None:
        return user
    return await session.scalar(
        select(User)
        .join(UsernameAsset, UsernameAsset.owner_id == User.id)
        .where(func.lower(UsernameAsset.username) == normalized)
    )


def message_out(
    message: Message,
    sender: User,
    current_user_id: uuid.UUID,
    *,
    quote: MessageQuote | None = None,
    reactions: list[MessageReactionOut] | None = None,
    sender_premium: bool = False,
    gift: GiftCompact | None = None,
    peers_read_at: datetime | None = None,
    claimed_by: UserCompact | None = None,
    forwarded_from: UserCompact | None = None,
) -> ChatMessage:
    mine = message.sender_id == current_user_id
    return ChatMessage(
        id=message.id,
        chat_id=message.chat_id,
        sender_id=message.sender_id,
        sender=compact_user(sender, is_premium=sender_premium),
        content=message.content,
        media_url=message.media_url,
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
        is_muted=muted,
        stars_count=stars,
        starred_by_me=starred,
        can_edit=post.author_id == me.id,
        can_delete=post.author_id == me.id,
        community_slug=community.slug if community else None,
        community_title=community.title if community else None,
        community_avatar_url=community.avatar_url if community else None,
        community_verified=bool(community and community.is_verified),
    )


async def render_username(
    session: AsyncSession, asset: UsernameAsset, owner: User | None, me: User
) -> UsernameAssetOut:
    events = int(
        await session.scalar(
            select(func.count())
            .select_from(UsernameOwnershipEvent)
            .where(UsernameOwnershipEvent.asset_id == asset.id)
        )
        or 0
    )
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
        offers_count=max(0, events - 1),
        last_action=last_event.action if last_event else None,
        last_action_at=last_event.created_at if last_event else None,
        is_primary_handle=bool(owner and owner.username.lower() == asset.username.lower()),
        offers_disabled=asset.offers_disabled,
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


@app.post(
    "/api/auth/register",
    response_model=AuthResponse,
    status_code=status.HTTP_201_CREATED,
    tags=["auth"],
)
async def register(
    payload: RegisterRequest, request: Request, response: Response, session: SessionDep
) -> AuthResponse:
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


@app.post("/api/auth/login", response_model=AuthResponse, tags=["auth"])
async def login(
    payload: LoginRequest, request: Request, response: Response, session: SessionDep
) -> AuthResponse:
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
    password_matches = (
        await run_in_threadpool(verify_password, payload.password, row.AuthIdentity.password_hash)
        if row is not None
        else False
    )
    if row is None or not password_matches:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Неверный логин или пароль"
        )
    identity, user = row
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


@app.post("/api/auth/refresh", response_model=AuthResponse, tags=["auth"])
async def refresh_auth(
    request: Request,
    response: Response,
    session: SessionDep,
    refresh_cookie: Annotated[str | None, Cookie(alias=REFRESH_COOKIE)] = None,
) -> AuthResponse:
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
        await session.execute(
            update(RefreshSession)
            .where(RefreshSession.user_id == current.user_id, RefreshSession.revoked_at.is_(None))
            .values(revoked_at=utcnow())
        )
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
    next day extends it, and any longer gap restarts it at one. A row that predates the
    streak timestamp falls back to `last_seen_at`, and an unknown last visit keeps the
    existing count rather than punishing the user for missing history.
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
    else:
        details.streak_days = 1
    details.streak_updated_at = now
    details.last_seen_at = now
    await session.commit()


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
    username = fields.pop("username", None)
    if username and username.lower() != me.username.lower():
        occupied = await session.scalar(
            select(User.id).where(func.lower(User.username) == username.lower(), User.id != me.id)
        )
        if occupied:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Юзернейм уже занят")
        old_asset = await session.scalar(
            select(UsernameAsset).where(
                UsernameAsset.owner_id == me.id, UsernameAsset.username == me.username
            )
        )
        existing_asset = await session.scalar(
            select(UsernameAsset).where(func.lower(UsernameAsset.username) == username.lower())
        )
        if existing_asset and existing_asset.owner_id not in {None, me.id}:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Юзернейм уже занят")
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


async def _store_video(file: UploadFile, folder: str, owner_id: uuid.UUID) -> str:
    """
    Keep an uploaded clip under `MEDIA_ROOT/<folder>` and return its URL.

    Nothing is transcoded: the file is served back exactly as it arrived, which is why the
    container is identified from its own bytes and anything else is refused. A renamed
    executable does not become a video by being called one.
    """
    payload = await file.read(MAX_VIDEO_BYTES + 1)
    if len(payload) > MAX_VIDEO_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"Видео больше {MAX_VIDEO_BYTES // (1024 * 1024)} МБ",
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
    url = await _store_image(file, folder, me.id)
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
    for field, value in payload.model_dump(exclude_unset=True).items():
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


@app.get("/api/users/{username}/badges", response_model=list[ProfileBadge], tags=["profiles"])
async def read_user_badges(username: str, session: SessionDep) -> list[ProfileBadge]:
    user = await resolve_user(session, username)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Пользователь не найден")
    return profile_badges(user.badges)


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
    return [
        profile_story_out(story, author) for story in stories if story.community_id is None
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
    # One author's page opens with whatever they pinned; a mixed feed has no owner to pin it.
    order = (
        (Post.pinned_at.is_(None), Post.created_at.desc())
        if author
        else (Post.created_at.desc(),)
    )
    rows = (await session.execute(query.order_by(*order).limit(limit))).all()
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
        )
        for post, author in rows
    ]


@app.post("/api/feed", response_model=FeedPost, status_code=status.HTTP_201_CREATED, tags=["feed"])
async def create_post(payload: PostCreate, session: SessionDep, me: CurrentUser) -> FeedPost:
    gallery = [url for url in (payload.image_urls or []) if url][:MAX_POST_IMAGES]
    post = Post(
        author_id=me.id,
        content=payload.content,
        # `image_url` is the first picture, which is what older readers of this row expect.
        image_url=gallery[0] if gallery else payload.image_url,
        image_urls=gallery or ([payload.image_url] if payload.image_url else None),
        video_url=payload.video_url,
        poll_options=_poll_options(payload),
        sensitive=payload.sensitive,
        link_url=payload.link_url,
        link_title=(payload.link_title or None),
        music=await resolve_post_music(payload.content),
    )
    session.add(post)
    await session.commit()
    await session.refresh(post)
    return await render_post(session, post, me, me)


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
    del session
    return UploadedMedia(url=await _store_video(file, "posts", me.id))


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
    await session.delete(post)
    await session.commit()
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
    """
    post = await _own_post(session, post_id, me)
    post.content = payload.content
    if payload.sensitive is not None:
        post.sensitive = payload.sensitive
    post.link_url = payload.link_url
    post.link_title = payload.link_title or None
    post.music = await resolve_post_music(payload.content)
    post.edited_at = utcnow()
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
    """
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
            )
        )
    else:
        existing.reason = payload.reason
        existing.comment = payload.comment
    await session.commit()
    return DetailResponse(detail="Жалоба отправлена")


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
    await session.commit()
    return await render_post(session, post, author, me)


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
    await session.commit()
    await session.refresh(comment)
    author = await session.get(User, comment.author_id)
    return (await render_comments(session, post, [(comment, author or me)], me))[0]


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
    await session.execute(delete(PostComment).where(PostComment.parent_id == comment.id))
    await session.delete(comment)
    await session.commit()
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
    await session.commit()
    author = await session.get(User, comment.author_id)
    return (await render_comments(session, post, [(comment, author or me)], me))[0]


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
    await session.commit()
    await session.refresh(comment)
    return (await render_comments(session, post, [(comment, me)], me))[0]


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
    last_detail = message_out(last_row.Message, last_row.User, me.id) if last_row else None
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
            content=f"Группа «{payload.title}» создана",
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
    return ChatInfo(
        chat=await render_chat_summary(session, chat, me),
        members=members,
        links=links[:60],
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
    await session.commit()
    await session.refresh(message)
    outgoing = message_out(message, me, me.id, gift=compact_gift(gift))
    await chat_connections.broadcast(
        chat_id, {"type": "message", "message": broadcast_payload(outgoing)}
    )
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
    await session.commit()
    await session.refresh(message)
    sender = await session.get(User, message.sender_id)
    outgoing = message_out(
        message,
        sender or me,
        me.id,
        gift=compact_gift(gift),
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
    peers_read_at = await _peers_read_at(session, chat_id, me.id)
    return [
        message_out(
            message,
            sender,
            me.id,
            quote=quotes.get(message.reply_to_id),
            reactions=reactions.get(message.id),
            sender_premium=sender.id in premium,
            gift=gifts.get(message.gift_id) if message.gift_id else None,
            peers_read_at=peers_read_at,
            claimed_by=claimers.get(message.gift_claimed_by_id)
            if message.gift_claimed_by_id
            else None,
            forwarded_from=forwarders.get(message.forwarded_from_id)
            if message.forwarded_from_id
            else None,
        )
        for message, sender in ordered
    ]


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


async def create_chat_message(  # noqa: PLR0913
    session: AsyncSession,
    chat_id: uuid.UUID,
    me: User,
    content: str,
    *,
    reply_to_id: uuid.UUID | None = None,
    forwarded_from_id: uuid.UUID | None = None,
    media_url: str | None = None,
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
        chat_id=chat_id,
        sender_id=me.id,
        content=content,
        reply_to_id=reply_to_id,
        forwarded_from_id=forwarded_from_id,
        media_url=media_url,
    )
    session.add(message)
    # Writing into a chat is the clearest possible sign it is not deleted or unread.
    member.cleared_at = None
    member.marked_unread = False
    # Muting is per person, so the query asks who still wants to hear about this.
    recipients = (
        await session.scalars(
            select(ChatMember.user_id).where(
                ChatMember.chat_id == chat_id,
                ChatMember.user_id != me.id,
                ChatMember.muted.is_(False),
            )
        )
    ).all()
    for recipient_id in recipients:
        session.add(
            Notification(
                user_id=recipient_id,
                actor_id=me.id,
                kind=NotificationKind.MESSAGE,
                text=f"{me.display_name}: {content[:120] or ('Фото' if media_url else '')}",
                entity_id=str(chat_id),
            )
        )
    await session.commit()
    await session.refresh(message)
    quotes = await _message_quotes(session, [reply_to_id] if reply_to_id else [])
    forwarded = (
        compact_user(await session.get(User, forwarded_from_id) or me)
        if forwarded_from_id
        else None
    )
    return message_out(
        message,
        me,
        me.id,
        quote=quotes.get(reply_to_id) if reply_to_id else None,
        forwarded_from=forwarded,
    )


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
    Send a picture, with the text beside it as its caption.

    Membership is checked before the bytes are stored, so a stranger cannot use a chat id as
    free file hosting.
    """
    await require_chat_member(session, chat_id, me.id)
    url = await _store_image(file, "chats", me.id)
    outgoing = await create_chat_message(
        session, chat_id, me, caption.strip(), reply_to_id=reply_to_id, media_url=url
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
    await session.commit()
    await session.refresh(message)
    quotes = await _message_quotes(session, [message.reply_to_id] if message.reply_to_id else [])
    outgoing = message_out(
        message, me, me.id, quote=quotes.get(message.reply_to_id) if message.reply_to_id else None
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
    await session.commit()
    reactions = await _message_reactions(session, [message_id], me.id)
    quotes = await _message_quotes(session, [message.reply_to_id] if message.reply_to_id else [])
    outgoing = message_out(
        message,
        sender,
        me.id,
        quote=quotes.get(message.reply_to_id) if message.reply_to_id else None,
        reactions=reactions.get(message_id),
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
    await session.commit()
    await session.refresh(message)
    outgoing = message_out(message, sender, me.id)
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
    return WalletOut(balance=wallet.balance, updated_at=wallet.updated_at)


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

PREMIUM_BENEFITS: tuple[tuple[str, str, str, str, bool], ...] = (
    ("subscription", "Подписка GRAM Premium", "Ежемесячная подписка: поддержка GRAM и все возможности ниже.", "crown", False),
    ("name-color", "Цвет ника", "Премиум-палитра имени в профиле, ленте и чатах.", "palette", False),
    ("premium-badge", "Premium-значок", "Фирменная звезда рядом с ником и до 7 особых галочек.", "badge-check", False),
    ("emoji-status", "Эмодзи-статус", "Статус-подарок рядом с ником в профиле и чатах.", "sparkles", False),
    ("double-limits", "Удвоенные лимиты", "Длиннее посты, больше фото и символов в био. Сравнение ниже.", "gauge", False),
    ("voice-to-text", "Голос в текст", "Расшифровка голосовых сообщений одним касанием.", "audio-lines", True),
    ("realtime-translation", "Перевод в реальном времени", "Авто-перевод постов и переписки на твой язык.", "languages", True),
    ("custom-emoji", "Кастом-эмодзи в тексте", "Анимированные и кастомные эмодзи в сообщениях и профиле.", "smile-plus", True),
    ("stories-priority", "Сторис: приоритет и невидимка", "Приоритетная загрузка, скрытый просмотр и расширенные лимиты сторис.", "video", True),
    ("chat-wallpapers", "Обои чата", "Свой фон для чатов из набора премиум-обоев.", "image", True),
    ("large-files", "Большие файлы", "Загружай файлы большего размера в чаты и посты.", "upload", True),
    ("fast-uploads", "Быстрые загрузки", "Медиа и файлы грузятся без ограничения скорости.", "download", True),
)

PREMIUM_LIMITS: tuple[tuple[str, str, int, int], ...] = (
    ("post-length", "Длина поста", 280, 1200),
    ("post-photos", "Фото в посте", 6, 10),
    ("bio-length", "Описание профиля", 280, 560),
    ("special-marks", "Особые галочки", 3, 7),
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
    if entitlement and entitlement.active and entitlement.expires_at > now:
        entitlement.expires_at = entitlement.expires_at + timedelta(days=PREMIUM_PERIOD_DAYS)
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
    community = await session.scalar(
        select(Community).where(func.lower(Community.slug) == slug.lower()).with_for_update()
    )
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
    if await session.scalar(select(Community.id).where(func.lower(Community.slug) == payload.slug)):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Адрес сообщества уже занят"
        )
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
    await session.commit()
    await session.refresh(community)
    return await render_community(session, community, me)


@app.get("/api/communities/{slug}", response_model=CommunityOut, tags=["communities"])
async def read_community(slug: str, session: SessionDep, me: CurrentUser) -> CommunityOut:
    community = await session.scalar(
        select(Community).where(func.lower(Community.slug) == slug.lower())
    )
    if community is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Сообщество не найдено")
    rendered = await render_community(session, community, me)
    if community.is_private and not rendered.is_member:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Это закрытое сообщество")
    return rendered


@app.patch("/api/communities/{slug}", response_model=CommunityOut, tags=["communities"])
async def update_community(
    slug: str, payload: CommunityUpdate, session: SessionDep, me: CurrentUser
) -> CommunityOut:
    """
    The owner's own settings for their channel.

    The slug stays fixed: it is the channel's address, and links already point at it.
    """
    community = await session.scalar(
        select(Community).where(func.lower(Community.slug) == slug.lower())
    )
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
    community = await session.scalar(
        select(Community).where(func.lower(Community.slug) == slug.lower()).with_for_update()
    )
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
    community = await session.scalar(
        select(Community).where(func.lower(Community.slug) == slug.lower()).with_for_update()
    )
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
    community = await session.scalar(
        select(Community).where(func.lower(Community.slug) == slug.lower())
    )
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
            .order_by(Post.pinned_at.is_(None), Post.pinned_at.desc(), Post.created_at.desc())
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
    community = await session.scalar(
        select(Community).where(func.lower(Community.slug) == slug.lower())
    )
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
    community = await session.scalar(
        select(Community).where(func.lower(Community.slug) == slug.lower())
    )
    if community is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Сообщество не найдено")
    if community.owner_id != me.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Публиковать в сообществе может только владелец",
        )
    gallery = [url for url in (payload.image_urls or []) if url][:MAX_POST_IMAGES]
    post = Post(
        author_id=me.id,
        community_id=community.id,
        content=payload.content,
        image_url=gallery[0] if gallery else payload.image_url,
        image_urls=gallery or ([payload.image_url] if payload.image_url else None),
        video_url=payload.video_url,
        poll_options=_poll_options(payload),
        sensitive=payload.sensitive,
        link_url=payload.link_url,
        link_title=(payload.link_title or None),
        music=await resolve_post_music(payload.content),
    )
    session.add(post)
    await session.commit()
    await session.refresh(post)
    return await render_post(session, post, me, me, community=community)


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
    # Handles live in two places (accounts and collectible assets); both must agree.
    live_account = await session.scalar(
        select(User.id).where(func.lower(User.username) == wanted, User.id != me.id)
    )
    if live_account:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Это имя уже занято")
    asset = await session.scalar(
        select(UsernameAsset).where(func.lower(UsernameAsset.username) == wanted).with_for_update()
    )
    if asset is not None and asset.owner_id is not None:
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
    price = int(asset.price)
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
    correlation = uuid.uuid4()
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
    _ledger_change(
        session,
        seller_wallet,
        price,
        kind="username_sale",
        description=f"Продажа @{asset.username}",
        correlation_id=correlation,
        counterparty_id=me.id,
        entity_type="username",
        entity_id=str(asset.id),
    )
    previous_owner = seller.id
    asset.owner_id = me.id
    asset.status = UsernameStatus.RESERVED
    asset.price = None
    asset.listed_at = None
    asset.reserved_at = utcnow()
    session.add(
        UsernameOwnershipEvent(
            asset_id=asset.id,
            from_user_id=previous_owner,
            to_user_id=me.id,
            action="acquired",
            price_stars=price,
        )
    )
    await session.commit()
    await session.refresh(asset)
    return await render_username(session, asset, me, me)


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
    if asset.username.lower() == me.username.lower():
        return await render_profile(session, me, me)
    taken = await session.scalar(
        select(User.id).where(func.lower(User.username) == asset.username.lower(), User.id != me.id)
    )
    if taken:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Юзернейм уже занят")
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


async def _apply_upgrade(session: AsyncSession, gift: Gift, model: GiftModel) -> Gift:
    """
    Roll a model, a backdrop and a symbol onto a plain gift.

    The pools come from the imported catalogue rather than the stored JSON copy, so one table
    decides the odds, and the rolled percentages are recorded so two owners of the same design
    can compare what they actually got. These are Telegram's own per-mille rates, not an
    approximation of them.
    """
    source = giftart.BY_SLUG.get(model.slug)
    rolled_model = giftart.roll(source.models) if source else None
    rolled_backdrop = giftart.roll(source.backdrops) if source else None
    rolled_symbol = giftart.roll(source.symbols) if source else None
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


# The cover holds four, in this order. The first is anyone's to arrange; the others, and the
# marker beside the name, are what a premium account gets for its personalization.
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

    async def broadcast(self, chat_id: uuid.UUID, payload: dict[str, Any]) -> None:
        stale: list[WebSocket] = []
        for connection in tuple(self.connections.get(chat_id, ())):
            try:
                await connection.send_json(payload)
            except RuntimeError:
                stale.append(connection)
        for connection in stale:
            self.disconnect(chat_id, connection)


chat_connections = ChatConnectionManager()


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
    except jwt.PyJWTError, KeyError, TypeError, ValueError:
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
                raw_payload = await websocket.receive_json()
                try:
                    message_payload = MessageCreate.model_validate(raw_payload)
                except ValidationError as exc:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "detail": "Некорректное сообщение",
                            "errors": exc.errors(),
                        }
                    )
                    continue
                outgoing = await create_chat_message(
                    session, chat_id, user, message_payload.content
                )
                await chat_connections.broadcast(
                    chat_id, {"type": "message", "message": broadcast_payload(outgoing)}
                )
        except WebSocketDisconnect:
            chat_connections.disconnect(chat_id, websocket)
