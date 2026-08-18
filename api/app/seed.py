"""Idempotent, readable Russian demo content for local development."""

from __future__ import annotations

import hashlib
import uuid
from collections.abc import Sequence
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any, TypedDict

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app import giftart
from app.config import DEMO_EMAIL, DEMO_PASSWORD, DEMO_USERNAME
from app.gifts import (
    DESIGN_BY_SLUG,
    DESIGNS,
)
from app.models import (
    AuthIdentity,
    Chat,
    ChatMember,
    Community,
    CommunityMember,
    CommunityPost,
    CreatorSettings,
    Follow,
    Gift,
    GiftCollectible,
    GiftModel,
    GiftShowcase,
    Message,
    Notification,
    NotificationKind,
    Post,
    PostComment,
    PostLike,
    ProfileStory,
    StarLedger,
    StarWallet,
    User,
    UsernameAsset,
    UsernameOwnershipEvent,
    UsernameStatus,
    UserNote,
    UserPreferences,
    UserProfileDetails,
)
from app.security import hash_password

NAMESPACE = uuid.UUID("6533f5ad-d61b-44bb-bfc8-ea83aa154a59")


class DemoUserData(TypedDict):
    display_name: str
    avatar_url: str | None
    cover_url: str | None
    bio: str
    location: str | None
    verified: bool
    related: list[str]
    badges: list[str]
    profile_color: str
    followers: int
    following: int
    age: int


def demo_id(value: str) -> uuid.UUID:
    """Return stable UUIDs so seeded records survive repeated startup."""
    return uuid.uuid5(NAMESPACE, value)


async def _upsert_demo_users(session: AsyncSession, now: datetime) -> dict[str, User]:
    definitions: dict[str, DemoUserData] = {
        # The platform's own account. It sends onboarding and security notices, so it must
        # exist before anyone registers.
        "gram": {
            "display_name": "GRAM",
            "avatar_url": None,
            "cover_url": None,
            "bio": "Официальный аккаунт GRAM. Пишем о безопасности аккаунта и важных изменениях.",
            "location": None,
            "verified": True,
            "related": [],
            "profile_color": "ice_blue",
            "badges": ["official"],
            "followers": 0,
            "following": 0,
            "age": 900,
        },
        "leon": {
            "display_name": "Леон Северов",
            "avatar_url": "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=320&auto=format&fit=crop",
            "cover_url": "https://images.unsplash.com/photo-1519608487953-e999c86e7455?w=1200&auto=format&fit=crop",
            "bio": "Собираю редкие имена, снимаю ночной город и строю уютный интернет.",
            "location": "Киев",
            "verified": True,
            "related": ["@north", "@afterglow", "@still"],
            "profile_color": "ice_blue",
            "badges": ["founder", "legend", "sponsor", "maker", "sniper", "og"],
            "followers": 12840,
            "following": 318,
            "age": 742,
        },
        "artem": {
            "display_name": "Артём Вольный",
            "avatar_url": "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=320&auto=format&fit=crop",
            "cover_url": "https://images.unsplash.com/photo-1519608487953-e999c86e7455?w=1200&auto=format&fit=crop",
            "bio": "Типографика, музыка и маленькие продукты с характером.",
            "location": "Тбилиси",
            "verified": True,
            "related": ["@mono", "@type"],
            "profile_color": "champagne",
            "badges": ["early", "maker", "night_player"],
            "followers": 8210,
            "following": 194,
            "age": 619,
        },
        "maya": {
            "display_name": "Майя Лис",
            "avatar_url": "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=320&auto=format&fit=crop",
            "cover_url": "https://images.unsplash.com/photo-1528459801416-a9e53bbf4e17?w=1200&auto=format&fit=crop",
            "bio": "Цифровые объекты, тёплый свет и хорошие разговоры.",
            "location": "Берлин",
            "verified": False,
            "related": ["@quiet", "@maya"],
            "profile_color": "pink",
            "badges": ["collector"],
            "followers": 4932,
            "following": 267,
            "age": 401,
        },
        "nikita": {
            "display_name": "Никита Орлов",
            "avatar_url": "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=320&auto=format&fit=crop",
            "cover_url": None,
            "bio": "Пишу о независимой музыке.",
            "location": "Варшава",
            "verified": False,
            "related": [],
            "profile_color": "default",
            "badges": [],
            "followers": 2103,
            "following": 412,
            "age": 211,
        },
    }
    users: dict[str, User] = {}
    for username, data in definitions.items():
        user = await session.scalar(select(User).where(func.lower(User.username) == username))
        if user is None:
            user = User(
                id=demo_id(f"user:{username}"),
                username=username,
                followers_count=int(data["followers"]),
                following_count=int(data["following"]),
                joined_at=now - timedelta(days=int(data["age"])),
            )
            session.add(user)
        user.display_name = str(data["display_name"])
        user.avatar_url = str(data["avatar_url"]) if data["avatar_url"] else None
        user.cover_url = str(data["cover_url"]) if data["cover_url"] else None
        user.bio = str(data["bio"])
        user.location = str(data["location"]) if data["location"] else None
        user.is_verified = bool(data["verified"])
        user.is_online = False
        user.related_usernames = list(data["related"])
        user.profile_color = str(data.get("profile_color", "default"))
        user.badges = list(data["badges"])
        users[username] = user
    await session.flush()
    return users


async def _claim_official_handle(session: AsyncSession, official: User, now: datetime) -> None:
    """
    Make sure the platform account holds its own handle.

    A tester can reserve `@gram` before the official account exists, which would leave the
    collectible pointing at one account while the live handle resolves to another. The
    reservation is moved rather than deleted, and the transfer is recorded, so the history
    still shows who held it.
    """
    asset = await session.scalar(
        select(UsernameAsset).where(func.lower(UsernameAsset.username) == official.username)
    )
    if asset is None:
        asset = UsernameAsset(
            id=demo_id(f"username:{official.username}"),
            username=official.username,
            owner_id=official.id,
            status=UsernameStatus.RESERVED,
            currency="STARS",
            reserved_at=now,
        )
        session.add(asset)
        await session.flush()
        session.add(
            UsernameOwnershipEvent(
                asset_id=asset.id, to_user_id=official.id, action="reserved", created_at=now
            )
        )
        return
    if asset.owner_id == official.id:
        return
    previous_owner_id = asset.owner_id
    asset.owner_id = official.id
    asset.status = UsernameStatus.RESERVED
    asset.reserved_at = now
    asset.price = None
    asset.listed_at = None
    session.add(
        UsernameOwnershipEvent(
            asset_id=asset.id,
            from_user_id=previous_owner_id,
            to_user_id=official.id,
            action="official_reclaim",
            created_at=now,
        )
    )


async def _seed_accounts(session: AsyncSession, users: dict[str, User], now: datetime) -> None:
    leon = users[DEMO_USERNAME]
    identity = await session.get(AuthIdentity, leon.id)
    if identity is None:
        session.add(
            AuthIdentity(
                user_id=leon.id,
                email=DEMO_EMAIL.lower(),
                password_hash=hash_password(DEMO_PASSWORD),
                email_verified=True,
            )
        )
    for username, user in users.items():
        preferences = await session.get(UserPreferences, user.id)
        if preferences is None:
            session.add(
                UserPreferences(
                    user_id=user.id,
                    interests=["дизайн", "технологии", "коллекции"]
                    if username == "leon"
                    else ["творчество", "сообщества"],
                    onboarding_complete=True,
                )
            )
        wallet = await session.get(StarWallet, user.id)
        if wallet is None:
            balance = {"leon": 2500, "artem": 900, "maya": 700, "nikita": 300}.get(username, 0)
            session.add(StarWallet(user_id=user.id, balance=balance, updated_at=now))
            session.add(
                StarLedger(
                    id=demo_id(f"ledger:{username}:welcome"),
                    user_id=user.id,
                    amount=balance,
                    balance_after=balance,
                    kind="welcome",
                    description="Стартовый баланс локального аккаунта",
                    correlation_id=demo_id(f"correlation:{username}:welcome"),
                    created_at=now - timedelta(days=30),
                )
            )
        creator = await session.get(CreatorSettings, user.id)
        if creator is None:
            session.add(
                CreatorSettings(
                    user_id=user.id,
                    paid_subscription_enabled=username in {"leon", "artem", "maya"},
                    monthly_price={"leon": 75, "artem": 50, "maya": 60, "nikita": 40}.get(
                        username, 50
                    ),
                )
            )


async def _seed_feed_and_chats(
    session: AsyncSession, users: dict[str, User], now: datetime
) -> None:
    if not await session.get(Post, demo_id("post:leon:night")):
        posts = [
            Post(
                id=demo_id("post:leon:night"),
                author_id=users["leon"].id,
                content="Ночной маршрут без карты. Иногда лучший интерфейс города — свет в окнах.",
                image_url="https://images.unsplash.com/photo-1519608487953-e999c86e7455?w=1200&auto=format&fit=crop",
                created_at=now - timedelta(minutes=24),
            ),
            Post(
                id=demo_id("post:artem:type"),
                author_id=users["artem"].id,
                content="Собрал шрифт для тихих интерфейсов: меньше шума, больше воздуха.",
                created_at=now - timedelta(hours=2),
            ),
            Post(
                id=demo_id("post:maya:objects"),
                author_id=users["maya"].id,
                content=(
                    "Коллекционные подарки становятся памятью, когда у них есть история владельцев."
                ),
                created_at=now - timedelta(hours=5),
            ),
        ]
        session.add_all(posts)
        session.add(
            PostLike(
                id=demo_id("like:maya:leon-night"),
                post_id=posts[0].id,
                user_id=users["maya"].id,
                created_at=now - timedelta(minutes=22),
            )
        )
    artem_chats = select(ChatMember.chat_id).where(ChatMember.user_id == users["artem"].id)
    direct = await session.scalar(
        select(Chat)
        .join(ChatMember, ChatMember.chat_id == Chat.id)
        .where(
            Chat.is_group.is_(False),
            ChatMember.user_id == users["leon"].id,
            Chat.id.in_(artem_chats),
        )
    )
    if direct is None:
        direct = Chat(
            id=demo_id("chat:leon:artem"),
            is_group=False,
            kind="direct",
            created_at=now - timedelta(days=80),
        )
        session.add(direct)
        await session.flush()
    group = await session.get(Chat, demo_id("chat:studio"))
    if group is None:
        group = Chat(
            id=demo_id("chat:studio"),
            title="Клуб цифровых объектов",
            is_group=True,
            kind="group",
            owner_id=users["leon"].id,
            created_at=now - timedelta(days=30),
        )
        session.add(group)
        await session.flush()
    else:
        group.title = "Клуб цифровых объектов"
        group.kind = "group"
        group.owner_id = group.owner_id or users["leon"].id

    member_specs = [
        (direct.id, users["leon"].id),
        (direct.id, users["artem"].id),
        (group.id, users["leon"].id),
        (group.id, users["artem"].id),
        (group.id, users["maya"].id),
    ]
    for chat_id, user_id in member_specs:
        member = await session.scalar(
            select(ChatMember).where(ChatMember.chat_id == chat_id, ChatMember.user_id == user_id)
        )
        if member is None:
            session.add(ChatMember(chat_id=chat_id, user_id=user_id))

    message_specs = [
        (
            "message:1",
            direct.id,
            users["artem"].id,
            "Посмотрел новую коллекцию — особенно хороши детали редкости.",
            now - timedelta(minutes=12),
        ),
        (
            "message:2",
            direct.id,
            users["leon"].id,
            "Спасибо. Добавлю ещё историю переходов между владельцами.",
            now - timedelta(minutes=9),
        ),
        (
            "message:3",
            group.id,
            users["maya"].id,
            "Встречаемся в субботу? Хочу показать новые объекты.",
            now - timedelta(hours=3),
        ),
    ]
    for key, chat_id, sender_id, content, created_at in message_specs:
        if await session.get(Message, demo_id(key)) is None:
            session.add(
                Message(
                    id=demo_id(key),
                    chat_id=chat_id,
                    sender_id=sender_id,
                    content=content,
                    created_at=created_at,
                )
            )


async def _sync_demo_follow_counts(session: AsyncSession, users: dict[str, User]) -> None:
    await session.flush()
    for user in users.values():
        user.followers_count = int(
            await session.scalar(
                select(func.count()).select_from(Follow).where(Follow.following_id == user.id)
            )
            or 0
        )
        user.following_count = int(
            await session.scalar(
                select(func.count()).select_from(Follow).where(Follow.follower_id == user.id)
            )
            or 0
        )


async def _seed_profile_parity(
    session: AsyncSession, users: dict[str, User], now: datetime
) -> None:
    detail_specs = {
        "leon": {
            "website_url": "https://unixgram.com/u/leon",
            "birthday": date(1997, 5, 14),
            "github_url": "https://github.com/leon",
            "telegram_url": "https://t.me/leon",
            "profile_song_title": "Midnight City",
            "profile_song_artist": "Neon North",
            "profile_song_url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
            "featured_community_slug": "digital-objects",
            "role_title": "Founder & photographer",
            "streak_days": 147,
            "streak_updated_at": now - timedelta(days=1),
            "profile_note": "Собираю ночной город и редкие имена. Пишите по делу.",
            "last_seen_at": now - timedelta(minutes=2),
        },
        "artem": {
            "website_url": "https://unixgram.com/u/artem",
            "birthday": date(1995, 10, 2),
            "github_url": "https://github.com/artem",
            "telegram_url": "https://t.me/artem",
            "profile_song_title": "Soft Focus",
            "profile_song_artist": "Mono Type",
            "profile_song_url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
            "featured_community_slug": "digital-objects",
            "role_title": "Type designer",
            "streak_days": 82,
            "streak_updated_at": now - timedelta(days=1),
            "profile_note": "Рисую шрифты. Заказы через личку.",
            "last_seen_at": now - timedelta(minutes=18),
        },
        "maya": {
            "website_url": "https://unixgram.com/u/maya",
            "birthday": date(1999, 2, 21),
            "github_url": "https://github.com/maya",
            "telegram_url": "https://t.me/maya",
            "profile_song_title": "Warm Light",
            "profile_song_artist": "Quiet Objects",
            "profile_song_url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3",
            "featured_community_slug": "digital-objects",
            "role_title": "Digital collector",
            "streak_days": 39,
            "streak_updated_at": now - timedelta(days=2),
            "profile_note": "Коллекционирую подарки и обмениваюсь редкостями.",
            "last_seen_at": now - timedelta(hours=1),
        },
    }
    for username, values in detail_specs.items():
        details = await session.get(UserProfileDetails, users[username].id)
        if details is None:
            details = UserProfileDetails(user_id=users[username].id)
            session.add(details)
        for field, value in values.items():
            setattr(details, field, value)

    story_specs = [
        (
            "story:leon:night-city",
            "leon",
            "Night city",
            "https://images.unsplash.com/photo-1519608487953-e999c86e7455?w=900&auto=format&fit=crop",
            now - timedelta(days=3),
            now - timedelta(days=2),
            True,
        ),
        (
            "story:leon:studio",
            "leon",
            "In the studio",
            "https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=900&auto=format&fit=crop",
            now - timedelta(hours=4),
            now + timedelta(hours=20),
            False,
        ),
        (
            "story:artem:type",
            "artem",
            "Letters in progress",
            "https://images.unsplash.com/photo-1561214115-f2f134cc4912?w=900&auto=format&fit=crop",
            now - timedelta(hours=8),
            now + timedelta(hours=16),
            True,
        ),
        (
            "story:maya:objects",
            "maya",
            "Objects of the week",
            "https://images.unsplash.com/photo-1634017839464-5c339ebe3cb4?w=900&auto=format&fit=crop",
            now - timedelta(hours=12),
            now + timedelta(hours=12),
            True,
        ),
    ]
    for key, username, title, media_url, created_at, expires_at, highlight in story_specs:
        story = await session.get(ProfileStory, demo_id(key))
        if story is None:
            story = ProfileStory(id=demo_id(key), author_id=users[username].id)
            session.add(story)
        story.title = title
        story.media_url = media_url
        story.created_at = created_at
        story.expires_at = expires_at
        story.highlight = highlight

    follow_specs = [
        ("leon", "artem"),
        ("artem", "leon"),
        ("artem", "maya"),
        ("maya", "leon"),
        ("maya", "artem"),
    ]
    for follower_name, following_name in follow_specs:
        existing = await session.scalar(
            select(Follow).where(
                Follow.follower_id == users[follower_name].id,
                Follow.following_id == users[following_name].id,
            )
        )
        if existing is None:
            session.add(
                Follow(
                    id=demo_id(f"follow:{follower_name}:{following_name}"),
                    follower_id=users[follower_name].id,
                    following_id=users[following_name].id,
                    created_at=now - timedelta(days=30),
                )
            )

    await _sync_demo_follow_counts(session, users)

    reply_specs = [
        (
            "reply:artem:leon-night",
            "post:leon:night",
            "artem",
            "The light and type work beautifully together.",
            now - timedelta(minutes=20),
        ),
        (
            "reply:maya:leon-night",
            "post:leon:night",
            "maya",
            "Saving this route for the weekend.",
            now - timedelta(minutes=16),
        ),
    ]
    for key, post_key, author_name, content, created_at in reply_specs:
        if await session.get(PostComment, demo_id(key)) is None:
            session.add(
                PostComment(
                    id=demo_id(key),
                    post_id=demo_id(post_key),
                    author_id=users[author_name].id,
                    content=content,
                    created_at=created_at,
                )
            )


async def _seed_assets(session: AsyncSession, users: dict[str, User], now: datetime) -> None:
    username_specs = [
        ("leon", "leon", UsernameStatus.RESERVED, None),
        ("north", "leon", UsernameStatus.LISTED, 860),
        ("afterglow", "leon", UsernameStatus.RESERVED, None),
        ("still", "leon", UsernameStatus.RESERVED, None),
        ("mono", "artem", UsernameStatus.LISTED, 1240),
        ("type", "artem", UsernameStatus.RESERVED, None),
        ("quiet", "maya", UsernameStatus.RESERVED, None),
        ("aurora", None, UsernameStatus.AVAILABLE, None),
        ("film", None, UsernameStatus.AVAILABLE, None),
    ]
    for username, owner_name, state, price in username_specs:
        asset = await session.scalar(
            select(UsernameAsset).where(func.lower(UsernameAsset.username) == username)
        )
        if asset is None:
            asset = UsernameAsset(
                id=demo_id(f"username:{username}"),
                username=username,
                owner_id=users[owner_name].id if owner_name else None,
                status=state,
                price=Decimal(price) if price else None,
                currency="STARS",
                reserved_at=now - timedelta(days=90) if owner_name else None,
                listed_at=now - timedelta(days=3) if state == UsernameStatus.LISTED else None,
            )
            session.add(asset)
            await session.flush()
            if owner_name:
                session.add(
                    UsernameOwnershipEvent(
                        asset_id=asset.id,
                        to_user_id=users[owner_name].id,
                        action="reserved",
                        created_at=asset.reserved_at or now,
                    )
                )
        else:
            asset.currency = "STARS"

# A demo item needs a design, a serial, an owner and a price if it is listed. Its model,
# backdrop and symbol are drawn from the design's real pools by `_pick`, so no invented variant
# name can end up in the database and the demo set stays valid as the catalogue is re-imported.
# (key, design slug, serial, owner, value, days held, price if listed)
DemoGift = tuple[str, str, int, str, int, int, int | None]

DEMO_GIFTS: tuple[DemoGift, ...] = (
    ("gift:prism:7", "ion-gem", 7, "leon", 1900, 16, None),
    ("gift:signal:42", "snake-box", 42, "leon", 820, 12, None),
    ("gift:neon:14", "record-player", 14, "maya", 1100, 21, 1450),
    ("gift:afterglow:3", "input-key", 3, "artem", 2400, 30, 2900),
    ("gift:rose:11", "eternal-rose", 11, "maya", 4200, 9, 5600),
    ("gift:skull:19", "electric-skull", 19, "nikita", 3600, 7, 4400),
    ("gift:cigar:88", "vintage-cigar", 88, "artem", 1250, 25, None),
    ("gift:globe:64", "snow-globe", 64, "nikita", 900, 18, 1180),
    ("gift:bear:1207", "toy-bear", 1207, "maya", 180, 4, None),
    ("gift:lamp:12", "genie-lamp", 12, "leon", 2700, 6, None),
    ("gift:dice:512", "vice-cream", 512, "nikita", 310, 11, 420),
    ("gift:orb:88", "crystal-ball", 88, "artem", 2100, 14, None),
)


def _pick(pool: Sequence[Any], key: str, salt: str) -> Any | None:
    """
    Choose one pool entry deterministically from a demo key.

    Demo rows have to be stable across seeds — a screenshot should not change every restart —
    but they must also be real variants of the real design, so this indexes the imported pool
    instead of naming a variant that may not exist.
    """
    if not pool:
        return None
    digest = hashlib.sha256(f"{key}:{salt}".encode()).digest()
    return pool[int.from_bytes(digest[:4], "big") % len(pool)]


async def _seed_demo_gifts(
    session: AsyncSession, users: dict[str, User], now: datetime
) -> None:
    """Minted items the demo accounts already hold, a third of them listed for resale."""
    for spec in DEMO_GIFTS:
        key, design_slug, serial, owner_name, value, days, price = spec
        design = DESIGN_BY_SLUG[design_slug]
        rolled_model = _pick(design.models, key, "model")
        rolled_backdrop = _pick(design.backdrops, key, "backdrop")
        rolled_symbol = _pick(design.symbols, key, "symbol")
        model = rolled_model.name if rolled_model else ""
        backdrop = rolled_backdrop.name if rolled_backdrop else ""
        symbol = rolled_symbol.name if rolled_symbol else ""
        gift = await session.get(Gift, demo_id(key))
        fresh = gift is None
        if gift is None:
            gift = Gift(
                id=demo_id(key),
                owner_id=users[owner_name].id,
                received_at=now - timedelta(days=days),
            )
            session.add(gift)
        gift.slug = f"{design.slug}-{serial:03d}"
        gift.name = design.name
        gift.description = design.description
        gift.serial_number = serial
        gift.edition_size = design.edition_size
        gift.rarity = design.rarity
        # Artwork is fetched from the design's own sticker, so no item carries a bitmap URL.
        gift.image_url = None
        gift.tg_name = design.tg_name
        gift.model_name = model
        gift.pattern = symbol
        if rolled_backdrop is not None:
            gift.accent = rolled_backdrop.center
            gift.backdrop_edge = rolled_backdrop.edge
            gift.pattern_color = rolled_backdrop.pattern
            gift.text_color = rolled_backdrop.text
        # Only ever priced on first creation. Re-applying it on every seed put a gift somebody
        # had already bought straight back on the market the next time the API restarted.
        if fresh and price:
            gift.sale_price_stars = price
            gift.listed_at = now - timedelta(days=min(days, 2))
        # Demo history is already upgraded — it carries rolled models, backdrops and symbols,
        # so it has to read as collectible rather than as a shelf of plain gifts.
        gift.upgraded_at = gift.upgraded_at or gift.received_at
        await session.flush()
        traits: dict[str, str | int | float] = {
            "model": model,
            "backdrop": backdrop,
            "symbol": symbol,
            "model_rarity_percent": giftart.percent(rolled_model),
            "backdrop_rarity_percent": giftart.percent(rolled_backdrop),
            "symbol_rarity_percent": giftart.percent(rolled_symbol),
        }
        collectible = await session.get(GiftCollectible, gift.id)
        if collectible is None:
            session.add(
                GiftCollectible(
                    gift_id=gift.id,
                    model=model,
                    backdrop=backdrop,
                    symbol=symbol,
                    traits=traits,
                    value_stars=value,
                    provenance_hash=hashlib.sha256(str(gift.id).encode()).hexdigest(),
                    creator_username="gram",
                    minted_at=now - timedelta(days=days + 90),
                )
            )
        else:
            collectible.model = model
            collectible.backdrop = backdrop
            collectible.symbol = symbol
            collectible.traits = traits
            collectible.value_stars = value
    showcase = await session.scalar(
        select(GiftShowcase).where(
            GiftShowcase.user_id == users["leon"].id, GiftShowcase.slot == "featured"
        )
    )
    if showcase is None:
        session.add(
            GiftShowcase(
                user_id=users["leon"].id,
                gift_id=demo_id("gift:prism:7"),
                slot="featured",
            )
        )


async def _seed_community(session: AsyncSession, users: dict[str, User], now: datetime) -> None:
    community = await session.scalar(select(Community).where(Community.slug == "digital-objects"))
    if community is not None:
        # Channel metadata is refreshed on every run so existing rows gain new fields.
        community.category = "Цифровые объекты"
        community.location = "Киев"
        community.website_url = "https://gram.local/objects"
    if community is None:
        community = Community(
            id=demo_id("community:digital-objects"),
            slug="digital-objects",
            title="Цифровые объекты",
            description="Коллекции, подарки, иллюстрация и культура владения.",
            avatar_url="https://images.unsplash.com/photo-1634017839464-5c339ebe3cb4?w=320&auto=format&fit=crop",
            owner_id=users["leon"].id,
            category="Цифровые объекты",
            location="Киев",
            website_url="https://gram.local/objects",
            members_count=3,
            created_at=now - timedelta(days=60),
        )
        session.add(community)
        await session.flush()
        session.add_all(
            [
                CommunityMember(community_id=community.id, user_id=users["leon"].id, role="owner"),
                CommunityMember(
                    community_id=community.id, user_id=users["artem"].id, role="member"
                ),
                CommunityMember(community_id=community.id, user_id=users["maya"].id, role="member"),
                CommunityPost(
                    id=demo_id("community-post:welcome"),
                    community_id=community.id,
                    author_id=users["leon"].id,
                    content="Делитесь историями своих коллекционных объектов и находками недели.",
                    created_at=now - timedelta(days=2),
                ),
            ]
        )


async def _repair_notes_and_notifications(
    session: AsyncSession, users: dict[str, User], now: datetime
) -> None:
    note = await session.get(UserNote, demo_id("note:leon:artem"))
    if note is None:
        session.add(
            UserNote(
                id=demo_id("note:leon:artem"),
                viewer_id=users["leon"].id,
                target_id=users["artem"].id,
                text="Познакомились на книжной ярмарке. Любит моноширинные шрифты.",
                updated_at=now - timedelta(days=6),
            )
        )
    notification = await session.get(Notification, demo_id("notification:welcome"))
    if notification is None:
        session.add(
            Notification(
                id=demo_id("notification:welcome"),
                user_id=users["leon"].id,
                kind=NotificationKind.SYSTEM,
                text="Профиль готов: выбирайте имена, коллекции и сообщества.",
                created_at=now - timedelta(minutes=5),
            )
        )


# Designs are drawn by the client from `art`, a model palette and a symbol pattern, so the
# catalogue stores keys and variant pools instead of a bitmap per design.
async def _seed_gift_catalog(session: AsyncSession, now: datetime) -> None:
    """Purchasable designs behind the "Купить подарок" sheet."""
    for position, design in enumerate(DESIGNS):
        first = design.backdrops[0] if design.backdrops else None
        model = await session.scalar(select(GiftModel).where(GiftModel.slug == design.slug))
        if model is None:
            model = GiftModel(
                id=demo_id(f"gift-model:{design.slug}"), slug=design.slug, created_at=now
            )
            session.add(model)
        model.name = design.name
        model.description = design.description
        # Artwork is served by `/api/gifts/art/...` from the design's own sticker, so no row
        # stores a bitmap URL of its own.
        model.image_url = None
        model.tg_name = design.tg_name
        model.tg_gift_id = design.tg_gift_id
        model.art = design.slug
        model.category = design.category
        model.accent = first.center if first else "#1c1c26"
        model.backdrop_edge = first.edge if first else "#08080a"
        model.rarity = design.rarity
        model.price_stars = design.price_stars
        model.edition_size = design.edition_size
        # The stored singulars are the fallback a mint uses if a pool is ever emptied.
        model.model_name = design.models[0].name if design.models else ""
        model.backdrop = first.name if first else ""
        model.symbol = design.symbols[0].name if design.symbols else ""
        model.models_pool = [
            {"name": item.name, "permille": item.permille} for item in design.models
        ]
        model.backdrops_pool = [
            {
                "name": item.name,
                "permille": item.permille,
                "center": item.center,
                "edge": item.edge,
                "pattern": item.pattern,
                "text": item.text,
            }
            for item in design.backdrops
        ]
        model.symbols_pool = [
            {"name": item.name, "permille": item.permille} for item in design.symbols
        ]
        model.limited = design.limited
        model.on_market = design.on_market
        model.available = True
        model.position = position
    await session.flush()
    # Designs that predate the imported catalogue are withdrawn from the storefront rather than
    # deleted: items minted from them still point at these rows for their name and edition.
    await session.execute(
        update(GiftModel)
        .where(GiftModel.slug.not_in([design.slug for design in DESIGNS]))
        .values(available=False, on_market=False)
    )


def _design_slug(gift_slug: str) -> str:
    """`vintage-cigar-007` -> `vintage-cigar`, matching how a mint builds the slug."""
    head, _, tail = gift_slug.rpartition("-")
    return head if head and tail.isdigit() else gift_slug


# Designs invented before the real Telegram catalogue was imported, mapped onto their closest
# real counterpart. Most of the old names were already Telegram gift names, so only the ones
# that differ are listed. Items keep their serial, owner and provenance; only what they depict
# changes, which is the honest way to retire a placeholder without deleting somebody's history.
LEGACY_DESIGNS: dict[str, str] = {
    "signal-crystal": "ion-gem",
    "liberty-torch": "liberty-figure",
    "paper-cup": "holiday-drink",
    "tape-zero": "record-player",
    "aurora-vault": "snake-box",
    "story-book": "timeless-book",
    "afterglow-key": "input-key",
    "gift-sack": "loot-bag",
    "mini-trophy": "victory-medal",
    "field-backpack": "swag-bag",
    "paper-rocket": "stellar-rocket",
    "birthday-candle": "b-day-candle",
    "lucky-dice": "clover-pin",
    "swim-flamingo": "pool-float",
    "paper-lantern": "chill-flame",
    "desert-cactus": "spring-basket",
    "instant-camera": "tama-gadget",
    "pocket-radio": "record-player",
    "party-sparkler": "party-sparkler",
    "letter-press": "fine-pen",
    "homemade-cake": "homemade-cake",
    "storm-charge": "astral-shard",
    "scout-drone": "surge-board",
    "arcade-pad": "tama-gadget",
    "santa-figure": "santa-hat",
    "swiss-watch": "swiss-watch",
}


async def _realign_minted_gifts(session: AsyncSession) -> int:
    """
    Point every minted item at a real Telegram design, keeping its history intact.

    Two jobs in one pass, because both are "make this item agree with the catalogue": retire the
    invented designs onto their real counterparts, and re-derive the fields artwork is built
    from. Serial, owner, transfers, offers and showcases are never touched — a collector should
    not lose a #7 because the catalogue behind it was replaced.
    """
    designs = {model.slug: model for model in (await session.scalars(select(GiftModel))).all()}
    gifts = (await session.scalars(select(Gift))).all()
    realigned = 0
    for gift in gifts:
        stored = _design_slug(gift.slug)
        slug = LEGACY_DESIGNS.get(stored, stored)
        design = designs.get(slug)
        source = giftart.BY_SLUG.get(slug)
        if design is None or source is None:
            continue
        key = str(gift.id)
        rolled_model = _pick(source.models, key, "model")
        rolled_backdrop = _pick(source.backdrops, key, "backdrop")
        rolled_symbol = _pick(source.symbols, key, "symbol")
        if slug != stored:
            gift.slug = f"{slug}-{gift.serial_number:03d}"
            gift.name = design.name
            gift.description = design.description
            gift.rarity = design.rarity
            gift.edition_size = design.edition_size
            realigned += 1
        gift.image_url = None
        gift.tg_name = design.tg_name or design.name
        gift.art = slug
        if rolled_model:
            gift.model_name = rolled_model.name
        if rolled_symbol:
            gift.pattern = rolled_symbol.name
        if rolled_backdrop:
            gift.accent = rolled_backdrop.center
            gift.backdrop_edge = rolled_backdrop.edge
            gift.pattern_color = rolled_backdrop.pattern
            gift.text_color = rolled_backdrop.text
        collectible = await session.get(GiftCollectible, gift.id)
        if collectible is not None and rolled_model and rolled_backdrop and rolled_symbol:
            collectible.model = rolled_model.name
            collectible.backdrop = rolled_backdrop.name
            collectible.symbol = rolled_symbol.name
            collectible.traits = {
                "model": rolled_model.name,
                "backdrop": rolled_backdrop.name,
                "symbol": rolled_symbol.name,
                "model_rarity_percent": giftart.percent(rolled_model),
                "backdrop_rarity_percent": giftart.percent(rolled_backdrop),
                "symbol_rarity_percent": giftart.percent(rolled_symbol),
            }
    return realigned


TRENDING_POSTS: tuple[tuple[str, str, str, int], ...] = (
    ("trend:leon:night", "leon", "Ночная съёмка на плёнку и немного тишины. #night #photo", 40),
    ("trend:leon:gifts", "leon", "Разобрал коллекцию: серийники, история владельцев. #gifts #collect", 92),
    ("trend:artem:type", "artem", "Новая типографика для тихих интерфейсов. #type #design", 150),
    ("trend:artem:music", "artem", "Собрал плейлист для работы вечером. #music #night", 220),
    ("trend:maya:objects", "maya", "Цифровые объекты как память о людях. #collect #design", 300),
    ("trend:maya:light", "maya", "Тёплый свет и длинные тени. #photo #light", 380),
    ("trend:nikita:indie", "nikita", "Инди-релизы недели: пять находок. #music #indie", 460),
    ("trend:nikita:city", "nikita", "Город меняется быстрее, чем карты. #night #city", 540),
)


async def _seed_trending_posts(
    session: AsyncSession, users: dict[str, User], now: datetime
) -> None:
    """Hashtag posts so Explore trends and tag pages have real content locally."""
    for key, author, content, minutes in TRENDING_POSTS:
        post = await session.get(Post, demo_id(key))
        if post is None:
            session.add(
                Post(
                    id=demo_id(key),
                    author_id=users[author].id,
                    content=content,
                    created_at=now - timedelta(minutes=minutes),
                )
            )
        else:
            post.content = content
    await session.flush()


async def seed_database(session: AsyncSession) -> bool:
    """Create or repair the local demo universe without dropping existing data."""
    before = await session.scalar(select(func.count()).select_from(User)) or 0
    now = datetime.now(UTC)
    users = await _upsert_demo_users(session, now)
    await _seed_accounts(session, users, now)
    # After assets so the reclaim wins over any reservation the asset pass would recreate.
    await _seed_feed_and_chats(session, users, now)
    await _seed_assets(session, users, now)
    await _claim_official_handle(session, users["gram"], now)
    await _seed_gift_catalog(session, now)
    # Demo items read their name, edition and artwork from the catalogue, so they follow it.
    await _seed_demo_gifts(session, users, now)
    # Then every minted item is realigned onto a real design, history untouched.
    await _realign_minted_gifts(session)
    await _seed_trending_posts(session, users, now)
    await _seed_community(session, users, now)
    await _seed_profile_parity(session, users, now)
    await _repair_notes_and_notifications(session, users, now)
    await session.commit()
    return before == 0
