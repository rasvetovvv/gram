"""Pydantic v2 request and response contracts."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, ValidationInfo, field_validator

from app.models import GiftRarity, NotificationKind, UsernameStatus

MIN_USERNAME_LENGTH = 3
MAX_USERNAME_LENGTH = 32
Username = Annotated[
    str,
    Field(
        min_length=MIN_USERNAME_LENGTH,
        max_length=MAX_USERNAME_LENGTH,
        pattern=r"^[a-zA-Z][a-zA-Z0-9_]*$",
    ),
]
Password = Annotated[str, Field(min_length=10, max_length=128)]


def _normalize_handle(value: object) -> object:
    """Recipients are typed, pasted or linked as `@Name`, so handles are normalized first."""
    return value.strip().removeprefix("@").lower() if isinstance(value, str) else value


UsernameInput = Annotated[
    str,
    BeforeValidator(_normalize_handle),
    Field(
        min_length=MIN_USERNAME_LENGTH,
        max_length=MAX_USERNAME_LENGTH,
        pattern=r"^[a-z][a-z0-9_]*$",
    ),
]
MAX_INTEREST_LENGTH = 40
CommunitySlug = Annotated[
    str, Field(min_length=3, max_length=48, pattern=r"^[a-zA-Z][a-zA-Z0-9_-]*$")
]


class ApiModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class GiftCompact(ApiModel):
    id: uuid.UUID
    slug: str
    name: str
    image_url: str | None
    accent: str
    rarity: GiftRarity
    serial_number: int
    # The client draws the artwork from these three keys, so even the smallest embed of a
    # gift — a chat bubble, a name marker — animates without a second request.
    art: str = "orb"
    pattern: str = "star"
    backdrop_edge: str = "#08080a"
    # The rolled model names the artwork; `pattern_color` tints the symbol layer behind it.
    # Both are empty until the gift is upgraded, and the client then draws the plain original.
    model_name: str = ""
    pattern_color: str = "#ffffff"
    # A plain gift shows the design's own artwork on a neutral surface; only an upgraded one
    # carries a rolled model, backdrop and symbol.
    upgraded: bool = True
    message: str | None = None


class UserCompact(ApiModel):
    id: uuid.UUID
    username: str
    display_name: str
    avatar_url: str | None
    is_verified: bool
    verified: bool = False
    verification_tier: str | None = None
    is_online: bool
    profile_color: str = "default"
    # Premium travels with the compact user so the mark can sit beside a name in a feed or
    # a chat, not only on a profile. Populated from one batched lookup per list.
    is_premium: bool = False
    # The platform account is presented differently everywhere it appears (chat header,
    # chat list), so its status travels with the compact user rather than being re-derived.
    is_official: bool = False
    # Staff, drawn as the V badge before the name. Not for sale and not claimable.
    is_admin: bool = False
    role_title: str | None = None
    # The gift the owner put in their name slot, drawn bare beside the name wherever they
    # appear. Filled from one batched lookup per list, like premium above.
    name_gift: GiftCompact | None = None


class ProfileBadge(ApiModel):
    id: uuid.UUID
    slug: str
    title: str
    image_url: str | None = None
    description: str
    qualification: str
    rarity: Literal["common", "rare", "epic", "legendary"]
    points: int
    issued_at: datetime | None = None
    issuer: str | None = None
    visible_in_profile: bool = True


class UserProfile(UserCompact):
    cover_url: str | None
    bio: str
    location: str | None
    related_usernames: list[str]
    badges: list[ProfileBadge] = Field(default_factory=list)
    followers_count: int
    following_count: int
    joined_at: datetime
    note: str | None = None
    can_edit_note: bool = False
    is_me: bool = False
    is_following: bool = False
    is_subscribed: bool = False
    # Whether the viewer has blocked this profile, so the chat menu can offer the opposite.
    is_blocked: bool = False
    # The other direction: this profile has blocked the viewer. Said plainly, because a page
    # that silently hides its posts reads as a broken page.
    blocked_me: bool = False
    posts_count: int = 0
    stars_balance: int | None = None
    featured_gift: GiftCompact | None = None
    name_gift: GiftCompact | None = None
    # The gifts scattered over the cover, in slot order. The first one is free to choose; the
    # rest are a premium arrangement, which is why the count matters to the client.
    cover_gifts: list[GiftCompact] = Field(default_factory=list)
    interests: list[str] = Field(default_factory=list)
    onboarding_complete: bool = True
    website_url: str | None = None
    birthday: date | None = None
    github_url: str | None = None
    telegram_url: str | None = None
    profile_song_title: str | None = None
    profile_song_artist: str | None = None
    profile_song_url: str | None = None
    featured_community_slug: str | None = None
    # Up to three of the owner's own communities, in their order. The single slug above is the
    # first of them.
    featured_community_slugs: list[str] = Field(default_factory=list)
    role_title: str | None = None
    streak_days: int = 0
    last_seen_at: datetime | None = None
    # Presence the viewer is allowed to know about: hidden by the owner's own setting, in which
    # case the client says "recently" rather than inventing a time.
    presence_hidden: bool = False
    status_emoji: str | None = None
    status_text: str | None = None
    # A private account shows its profile but closes its content to anyone not following it.
    is_private: bool = False
    can_view_content: bool = True
    # A closed account decides: this says the viewer has asked and is waiting.
    follow_requested: bool = False
    # Only ever filled on one's own profile: how many people are waiting for an answer.
    follow_requests_count: int = 0
    updated_at: datetime | None = None
    paid_subscription_enabled: bool = False
    subscription_price_stars: int | None = None
    is_premium: bool = False


class UserSettingsOut(ApiModel):
    """Everything the settings screen switches, as the account itself sees it."""

    show_online: bool = True
    private_account: bool = False
    # everyone | following | nobody — who may open a direct chat with this account.
    who_can_message: Literal["everyone", "following", "nobody"] = "everyone"
    status_emoji: str | None = None
    status_text: str | None = None
    notify_likes: bool = True
    notify_comments: bool = True
    notify_follows: bool = True
    notify_gifts: bool = True
    notify_messages: bool = True
    notify_stars: bool = True


class UserSettingsUpdate(BaseModel):
    show_online: bool | None = None
    private_account: bool | None = None
    who_can_message: Literal["everyone", "following", "nobody"] | None = None
    status_emoji: Annotated[str | None, Field(max_length=8)] = None
    status_text: Annotated[str | None, Field(max_length=40)] = None
    notify_likes: bool | None = None
    notify_comments: bool | None = None
    notify_follows: bool | None = None
    notify_gifts: bool | None = None
    notify_messages: bool | None = None
    notify_stars: bool | None = None

    @field_validator("status_emoji", "status_text")
    @classmethod
    def blank_clears(cls, value: str | None) -> str | None:
        """An emptied field means "no status", not the empty string."""
        return value.strip() or None if isinstance(value, str) else value


class RegisterRequest(BaseModel):
    email: Annotated[str, Field(min_length=5, max_length=254)]
    username: Username | None = None
    display_name: Annotated[str | None, Field(min_length=1, max_length=80)] = None
    password: Password

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized.count("@") != 1 or "." not in normalized.rsplit("@", 1)[1]:
            raise ValueError("Укажите корректный email")
        return normalized

    @field_validator("username")
    @classmethod
    def normalize_username(cls, value: str | None) -> str | None:
        return value.lower().removeprefix("@") if value else None

    @field_validator("display_name")
    @classmethod
    def normalize_display_name(cls, value: str | None) -> str | None:
        return value.strip() if value else None


class LoginRequest(BaseModel):
    identifier: Annotated[str, Field(min_length=3, max_length=254)]
    password: Annotated[str, Field(min_length=1, max_length=128)]


class AuthResponse(BaseModel):
    user: UserProfile
    access_expires_at: datetime


class DetailResponse(BaseModel):
    detail: str


class ProfileUpdate(BaseModel):
    username: Username | None = None
    display_name: Annotated[str | None, Field(min_length=1, max_length=80)] = None
    bio: Annotated[str | None, Field(max_length=280)] = None
    location: Annotated[str | None, Field(max_length=80)] = None
    avatar_url: Annotated[str | None, Field(max_length=500)] = None
    cover_url: Annotated[str | None, Field(max_length=500)] = None
    related_usernames: Annotated[list[str] | None, Field(max_length=12)] = None
    # Which of the owner's communities the profile shows; every slug has to be theirs.
    featured_community_slugs: Annotated[list[CommunitySlug] | None, Field(max_length=3)] = None
    interests: Annotated[list[str] | None, Field(max_length=12)] = None
    onboarding_complete: bool | None = None
    website_url: Annotated[str | None, Field(max_length=500)] = None
    birthday: date | None = None
    github_url: Annotated[str | None, Field(max_length=500)] = None
    telegram_url: Annotated[str | None, Field(max_length=500)] = None
    profile_song_title: Annotated[str | None, Field(max_length=120)] = None
    profile_song_artist: Annotated[str | None, Field(max_length=120)] = None
    profile_song_url: Annotated[str | None, Field(max_length=500)] = None
    featured_community_slug: CommunitySlug | None = None
    role_title: Annotated[str | None, Field(max_length=100)] = None
    profile_color: Annotated[str | None, Field(max_length=24, pattern=r"^[a-z_]+$")] = None
    streak_days: Annotated[int | None, Field(ge=0, le=100_000)] = None

    @field_validator("username")
    @classmethod
    def normalize_username(cls, value: str | None) -> str | None:
        return value.lower().removeprefix("@") if value else None

    @field_validator("related_usernames")
    @classmethod
    def normalize_related_usernames(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        cleaned: list[str] = []
        for item in value:
            username = item.strip().lower().removeprefix("@")
            if not username:
                continue
            if (
                not MIN_USERNAME_LENGTH <= len(username) <= MAX_USERNAME_LENGTH
                or not username[0].isalpha()
                or not all(
                    character.isascii() and (character.isalnum() or character == "_")
                    for character in username
                )
            ):
                raise ValueError("Некорректный связанный юзернейм")
            if username not in cleaned:
                cleaned.append(username)
        return cleaned

    @field_validator("website_url", "github_url", "telegram_url")
    @classmethod
    def normalize_external_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            return None
        parsed = urlsplit(normalized)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("Ссылка должна использовать HTTP или HTTPS")
        return normalized

    @field_validator("profile_song_url")
    @classmethod
    def normalize_profile_media_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            return None
        parsed = urlsplit(normalized)
        if not normalized.startswith("/") and (
            parsed.scheme not in {"http", "https"} or not parsed.netloc
        ):
            raise ValueError("Ссылка должна использовать HTTP или HTTPS")
        return normalized

    @field_validator(
        "profile_song_title", "profile_song_artist", "featured_community_slug", "role_title"
    )
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        normalized = value.strip() if value else ""
        return normalized or None

    @field_validator("birthday")
    @classmethod
    def birthday_is_not_in_future(cls, value: date | None) -> date | None:
        if value is not None and value > datetime.now(UTC).date():
            raise ValueError("День рождения не может быть в будущем")
        return value

    @field_validator("interests")
    @classmethod
    def normalize_interests(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        cleaned = list(dict.fromkeys(item.strip() for item in value if item.strip()))
        if any(len(item) > MAX_INTEREST_LENGTH for item in cleaned):
            raise ValueError("Интерес не может быть длиннее 40 символов")
        return cleaned


class NoteUpsert(BaseModel):
    content: Annotated[str, Field(max_length=200)] = ""


class ProfileNote(ApiModel):
    """Owner-authored note shown on their profile to every visitor."""

    content: str | None
    updated_at: datetime


class FollowState(BaseModel):
    username: str
    is_following: bool
    followers_count: int
    following_count: int
    # True when the account is closed and the follow became a request instead.
    requested: bool = False


class FollowRequestOut(ApiModel):
    """Someone waiting to be let into a closed account."""

    id: uuid.UUID
    user: UserCompact
    created_at: datetime


MAX_POST_IMAGES = 4


class PostCreate(BaseModel):
    content: Annotated[str, Field(min_length=1, max_length=4000)]
    image_url: Annotated[str | None, Field(max_length=500)] = None
    # Several pictures arrive as a list; the first one also fills `image_url`.
    image_urls: Annotated[list[str] | None, Field(max_length=MAX_POST_IMAGES)] = None
    # One clip. Pictures and a clip are exclusive in the composer, but the field is independent
    # so an older client that sends both is not refused.
    video_url: Annotated[str | None, Field(max_length=500)] = None
    # Two to four answers. The question is the post's own text.
    poll_options: (
        Annotated[
            list[Annotated[str, Field(min_length=1, max_length=MAX_POLL_OPTION_LENGTH)]] | None,
            Field(min_length=MIN_POLL_OPTIONS, max_length=MAX_POLL_OPTIONS),
        ]
    ) = None
    link_url: Annotated[str | None, Field(max_length=500)] = None
    link_title: Annotated[str | None, Field(max_length=120)] = None

    @field_validator("link_url")
    @classmethod
    def link_is_http(cls, value: str | None) -> str | None:
        """Only http(s): a `javascript:` or `data:` link in a card would be an attack surface."""
        if not value:
            return None
        cleaned = value.strip()
        if not cleaned:
            return None
        parts = urlsplit(cleaned)
        if parts.scheme not in {"http", "https"} or not parts.netloc:
            raise ValueError("Ссылка должна начинаться с http:// или https://")
        return cleaned

    @field_validator("content")
    @classmethod
    def content_is_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Публикация не может быть пустой")
        return value.strip()


MIN_POLL_OPTIONS = 2
MAX_POLL_OPTIONS = 4
MAX_POLL_OPTION_LENGTH = 60


class PollOption(ApiModel):
    """One answer and how many people chose it."""

    index: int
    text: str
    votes: int


class PostPollOut(ApiModel):
    """
    A poll as a reader sees it.

    `my_choice` is what decides whether the client draws buttons or results: counts are public
    once anyone has voted, and hiding them from the person who just voted would be theatre.
    """

    options: list[PollOption]
    total_votes: int
    my_choice: int | None = None


class PostMusic(ApiModel):
    """A resolved music link, shaped like the card that draws it."""

    title: str
    artist: str | None = None
    cover_url: str | None = None
    provider: Literal["soundcloud"] = "soundcloud"
    external_url: str
    external_id: str | None = None


class FeedPost(ApiModel):
    id: uuid.UUID
    author: UserCompact
    content: str
    image_url: str | None
    media_url: str | None
    image_urls: list[str] = Field(default_factory=list)
    video_url: str | None = None
    poll: PostPollOut | None = None
    link_url: str | None = None
    link_title: str | None = None
    created_at: datetime
    like_count: int
    likes_count: int
    liked_by_me: bool
    is_liked: bool
    comment_count: int = 0
    comments_count: int = 0
    reposts_count: int = 0
    # Recorded, not derived: `views_count` counts every read, `unique_views_count` the readers.
    views_count: int = 0
    unique_views_count: int = 0
    viewed_by_me: bool = False
    is_bookmarked: bool = False
    is_reposted: bool = False
    music: PostMusic | None = None
    # Set once the author has rewritten the text; the card then draws «ред.» after the date.
    edited_at: datetime | None = None
    # The one post an author keeps at the top of their profile.
    is_pinned: bool = False
    # Whether the reader has switched off notifications about this post.
    is_muted: bool = False
    # Stars this post earned, and whether this reader is among the people who sent them.
    stars_count: int = 0
    starred_by_me: bool = False
    # What the reader may do with it, so the menu is built from the server's answer rather
    # than from a client-side guess about who owns what.
    can_edit: bool = False
    can_delete: bool = False
    # Set when the post was published into a community. A channel post is published *as* the
    # channel, so the card needs its name, its picture and whether it is verified — the person
    # who pressed the button is not the author anyone should read.
    community_slug: str | None = None
    community_title: str | None = None
    community_avatar_url: str | None = None
    community_verified: bool = False


class PostEdit(BaseModel):
    """A rewrite of one's own post: the text, and the link card it carries."""

    content: Annotated[str, Field(min_length=1, max_length=4000)]
    link_url: Annotated[str | None, Field(max_length=500)] = None
    link_title: Annotated[str | None, Field(max_length=120)] = None

    @field_validator("link_url")
    @classmethod
    def link_is_http(cls, value: str | None) -> str | None:
        """Same rule as when the post was written: http(s) only, never a script url."""
        return PostCreate.link_is_http(value)

    @field_validator("content")
    @classmethod
    def content_is_not_blank(cls, value: str) -> str:
        return PostCreate.content_is_not_blank(value)


class PostReportCreate(BaseModel):
    """A complaint about a post: one of the reference's reasons, plus optional detail."""

    reason: Literal["spam", "abuse", "adult", "fraud", "violence", "other"]
    comment: Annotated[str | None, Field(max_length=300)] = None


class UserReportCreate(PostReportCreate):
    """A complaint about an account, on the same terms as one about a post."""


class UploadedMedia(ApiModel):
    """Where a just-uploaded picture now lives, so the composer can preview and attach it."""

    url: str


class PostViewReceipt(ApiModel):
    """What the client gets back when it reports that a post was actually on screen."""

    recorded: bool
    views_count: int
    unique_views_count: int


class PostCommentCreate(BaseModel):
    content: Annotated[str, Field(min_length=1, max_length=1000)]
    # Set to answer another comment rather than the post itself.
    parent_id: uuid.UUID | None = None

    @field_validator("content")
    @classmethod
    def content_is_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Комментарий не может быть пустым")
        return value.strip()


class PostCommentOut(ApiModel):
    id: uuid.UUID
    post_id: uuid.UUID
    author: UserCompact
    content: str
    created_at: datetime
    edited_at: datetime | None = None
    parent_id: uuid.UUID | None = None
    replies_count: int = 0
    likes_count: int = 0
    liked_by_me: bool = False
    # Editing and deleting are the author's own; the post's author may also delete.
    can_edit: bool = False
    can_delete: bool = False


class PostCommentEdit(BaseModel):
    content: Annotated[str, Field(min_length=1, max_length=1000)]

    @field_validator("content")
    @classmethod
    def not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Комментарий не может быть пустым")
        return value.strip()


class ProfileStoryCreate(BaseModel):
    title: Annotated[str, Field(min_length=1, max_length=120)]
    media_url: Annotated[str, Field(min_length=1, max_length=500)]
    # Publish into a channel the author owns instead of onto their own profile.
    community_slug: CommunitySlug | None = None
    expires_at: datetime | None = None
    highlight: bool = True

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError(
                "Название истории не может быть пустым"
            )
        return normalized

    @field_validator("media_url")
    @classmethod
    def validate_media_url(cls, value: str) -> str:
        normalized = value.strip()
        parsed = urlsplit(normalized)
        if not normalized.startswith("/") and (
            parsed.scheme not in {"http", "https"} or not parsed.netloc
        ):
            raise ValueError(
                "Ссылка медиа должна использовать HTTP или HTTPS"
            )
        return normalized


class ProfileStoryOut(ApiModel):
    id: uuid.UUID
    author: UserCompact
    title: str
    media_url: str
    created_at: datetime
    expires_at: datetime | None
    highlight: bool


class ProfileReplyParentPost(ApiModel):
    id: uuid.UUID
    author: UserCompact
    content: str
    image_url: str | None
    created_at: datetime


class ProfileReplyOut(ApiModel):
    id: uuid.UUID
    post_id: uuid.UUID
    author: UserCompact
    content: str
    created_at: datetime
    parent_post: ProfileReplyParentPost


class ToggleState(BaseModel):
    active: bool
    count: int


class MessageQuote(ApiModel):
    """Just enough of the replied-to message to render the quote above a bubble."""

    id: uuid.UUID
    sender_name: str
    content: str


class MessageReactionOut(ApiModel):
    emoji: str
    count: int
    mine: bool
    # A couple of avatars is enough for the chip; the full list is not worth the payload.
    users: list[UserCompact]


class ChatMessage(ApiModel):
    id: uuid.UUID
    chat_id: uuid.UUID
    sender_id: uuid.UUID
    sender: UserCompact
    content: str
    # An attached image; the text beside it reads as its caption.
    media_url: str | None = None
    created_at: datetime
    is_mine: bool
    # Two ticks: everyone else in the chat has read past this message of mine.
    read: bool = False
    edited_at: datetime | None = None
    pinned: bool = False
    # Service events (a pin, for instance) render as a centred notice, not a bubble.
    service: bool = False
    reply_to: MessageQuote | None = None
    reactions: list[MessageReactionOut] = []
    gift: GiftCompact | None = None
    # A gift dropped into a group waits for the first member who presses the button.
    gift_claimable: bool = False
    gift_claimed_by: UserCompact | None = None
    # Set on a forwarded copy, so the bubble can name where the text came from.
    forwarded_from: UserCompact | None = None


class MessageCreate(BaseModel):
    content: Annotated[str, Field(min_length=1, max_length=2000)]
    reply_to_id: uuid.UUID | None = None


class MessageEdit(BaseModel):
    content: Annotated[str, Field(min_length=1, max_length=2000)]

    @field_validator("content")
    @classmethod
    def content_is_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Сообщение не может быть пустым")
        return value.strip()


class ReactionToggle(BaseModel):
    emoji: Annotated[str, Field(min_length=1, max_length=16)]


class ChatSummary(ApiModel):
    id: uuid.UUID
    title: str
    is_group: bool
    kind: Literal["direct", "group", "secret", "saved"] = "direct"
    avatar_url: str | None = None
    members_count: int = 2
    participant: UserCompact | None
    peer: UserCompact | None
    last_message: str
    last_message_detail: ChatMessage | None
    unread_count: int
    updated_at: datetime
    pinned: bool = False
    archived: bool = False
    marked_unread: bool = False
    muted: bool = False
    # Seconds after which a message removes itself; 0 is off.
    autodelete_seconds: int = 0
    # A closed conversation reads differently from each side: mine offers to undo it, theirs
    # only explains why the composer is gone.
    peer_blocked: bool = False
    blocked_by_peer: bool = False


class ChatStateUpdate(BaseModel):
    pinned: bool | None = None
    archived: bool | None = None
    marked_unread: bool | None = None
    muted: bool | None = None


class ChatAutodeleteUpdate(BaseModel):
    """The reference offers off, a day, a week and a month — nothing in between."""

    seconds: Literal[0, 86400, 604800, 2592000]


class MessageForward(BaseModel):
    """Copy chosen messages into other conversations, keeping their original author."""

    message_ids: Annotated[list[uuid.UUID], Field(min_length=1, max_length=50)]
    chat_ids: Annotated[list[uuid.UUID], Field(min_length=1, max_length=20)]


class GroupCreate(BaseModel):
    """A group needs a name and at least one other person, as in the reference's two steps."""

    title: Annotated[str, Field(min_length=1, max_length=100)]
    members: Annotated[list[str], Field(min_length=1, max_length=200)]
    avatar_url: Annotated[str | None, Field(max_length=300)] = None

    @field_validator("title")
    @classmethod
    def title_is_not_blank(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Название не может быть пустым")
        return cleaned


class GroupUpdate(BaseModel):
    title: Annotated[str | None, Field(min_length=1, max_length=100)] = None
    avatar_url: Annotated[str | None, Field(max_length=300)] = None


class GroupMembersAdd(BaseModel):
    members: Annotated[list[str], Field(min_length=1, max_length=200)]


class ChatLink(BaseModel):
    """A link lifted out of a message, for the info panel's Ссылки tab."""

    url: str
    message_id: uuid.UUID
    sender_name: str
    created_at: datetime


class ChatMemberOut(ApiModel):
    user: UserCompact
    joined_at: datetime
    is_owner: bool = False


class ChatInfo(ApiModel):
    chat: ChatSummary
    members: list[ChatMemberOut]
    links: list[ChatLink]
    # Gifts are collectibles, not attachments, so they get their own shelf in the panel.
    gifts: list[GiftCompact]
    messages_count: int


class WalletOut(BaseModel):
    balance: int
    currency: Literal["STARS"] = "STARS"
    updated_at: datetime


class StarTopUpRequest(BaseModel):
    amount: Annotated[int, Field(ge=10, le=100_000)]


class StarLedgerOut(ApiModel):
    id: uuid.UUID
    amount: int
    balance_after: int
    kind: str
    description: str
    counterparty: UserCompact | None
    entity_type: str | None
    entity_id: str | None
    correlation_id: uuid.UUID
    created_at: datetime


class StarSendRequest(BaseModel):
    to_username: UsernameInput
    amount: Annotated[int, Field(ge=1, le=1_000_000)]
    message: Annotated[str | None, Field(max_length=160)] = None
    # Support aimed at one post rather than at the person in general: the card then carries a
    # count of what it earned, and the notice about it opens that post.
    post_id: uuid.UUID | None = None


class StarTransferReceipt(BaseModel):
    transfer_id: uuid.UUID
    amount: int
    balance: int
    recipient: UserCompact


class SubscriptionCreate(BaseModel):
    price_stars: Annotated[int, Field(ge=1, le=100_000)] = 50


class SubscriptionOut(ApiModel):
    id: uuid.UUID
    subscriber: UserCompact
    creator: UserCompact
    price_stars: int
    active: bool
    started_at: datetime
    current_period_ends: datetime
    cancelled_at: datetime | None


class CreatorSettingsUpdate(BaseModel):
    paid_subscription_enabled: bool | None = None
    monthly_price: Annotated[int | None, Field(ge=1, le=100_000)] = None


class CreatorSettingsOut(BaseModel):
    paid_subscription_enabled: bool
    monthly_price: int


class CreatorSeriesPoint(BaseModel):
    date: str
    views: int
    followers: int
    stars: int


class CreatorAnalyticsOut(BaseModel):
    period_days: int
    balance: int
    views: int
    followers: int
    earned: int
    engagement: float
    posts: int
    sponsors: int
    series: list[CreatorSeriesPoint]
    top_posts: list[FeedPost]


class PremiumPurchaseRequest(BaseModel):
    plan: Literal["monthly"] = "monthly"


class PremiumGiftRequest(BaseModel):
    """Premium bought for somebody else, which is a different act from buying it for oneself."""

    username: Annotated[str, Field(min_length=1, max_length=32)]
    plan: Literal["monthly"] = "monthly"


class PremiumEntitlementOut(ApiModel):
    id: uuid.UUID
    plan: str
    price_stars: int
    active: bool
    started_at: datetime
    expires_at: datetime
    cancelled_at: datetime | None
    # Who paid, when it was not the holder. A gift that forgets its sender is just a purchase.
    gifted_by: UserCompact | None = None


class PasswordChange(BaseModel):
    current_password: Annotated[str, Field(min_length=1, max_length=128)]
    new_password: Password


class AccountDeleteRequest(BaseModel):
    password: Annotated[str, Field(min_length=1, max_length=128)]


class AuthSessionOut(ApiModel):
    id: uuid.UUID
    created_at: datetime
    expires_at: datetime
    user_agent: str | None = None
    ip_address: str | None = None
    current: bool = False


class AccountSlot(ApiModel):
    """
    One account this browser can switch into without signing in again.

    The refresh token behind it never leaves its httpOnly cookie, so the slot carries only
    what the switcher draws plus which one is live.
    """

    user: UserCompact
    active: bool = False
    expires_at: datetime


class ChatFolderOut(ApiModel):
    id: uuid.UUID
    title: str
    position: int
    chat_ids: list[uuid.UUID] = Field(default_factory=list)
    chats_count: int = 0
    unread_count: int = 0


class ChatFolderCreate(BaseModel):
    title: Annotated[str, Field(min_length=1, max_length=40)]

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str) -> str:
        title = value.strip()
        if not title:
            raise ValueError("Укажите название папки")
        return title


class TrendOut(ApiModel):
    tag: str
    posts_count: int


class CommunityCompact(ApiModel):
    slug: str
    title: str
    avatar_url: str | None = None
    members_count: int
    owner_verified: bool = False


class SearchResults(ApiModel):
    query: str
    people: list[UserCompact] = Field(default_factory=list)
    communities: list[CommunityCompact] = Field(default_factory=list)
    tags: list[TrendOut] = Field(default_factory=list)


class PremiumBenefit(ApiModel):
    slug: str
    title: str
    description: str
    icon: str
    soon: bool = False


class PremiumLimit(ApiModel):
    slug: str
    title: str
    free: int
    premium: int


class PremiumPaymentMethod(ApiModel):
    slug: str
    title: str
    subtitle: str
    kind: Literal["stars", "card", "crypto"]
    available: bool
    badges: list[str] = Field(default_factory=list)


class PremiumPlanOut(ApiModel):
    plan: str
    period_days: int
    price_stars: int
    price_fiat: float
    fiat_currency: str
    benefits: list[PremiumBenefit]
    limits: list[PremiumLimit]
    payment_methods: list[PremiumPaymentMethod]
    entitlement: PremiumEntitlementOut | None = None
    stars_balance: int = 0


class CommunityUpdate(BaseModel):
    """What a channel's owner may change after creating it; the slug is not one of them."""

    title: Annotated[str | None, Field(min_length=1, max_length=100)] = None
    description: Annotated[str | None, Field(max_length=500)] = None
    category: Annotated[str | None, Field(max_length=60)] = None
    location: Annotated[str | None, Field(max_length=80)] = None
    website_url: Annotated[str | None, Field(max_length=500)] = None
    avatar_url: Annotated[str | None, Field(max_length=500)] = None
    cover_url: Annotated[str | None, Field(max_length=500)] = None


class CommunityCreate(BaseModel):
    slug: CommunitySlug
    title: Annotated[str, Field(min_length=1, max_length=100)]
    description: Annotated[str, Field(max_length=500)] = ""
    category: Annotated[str | None, Field(max_length=60)] = None
    location: Annotated[str | None, Field(max_length=80)] = None
    website_url: Annotated[str | None, Field(max_length=500)] = None
    is_private: bool = False

    @field_validator("slug")
    @classmethod
    def normalize_slug(cls, value: str) -> str:
        return value.lower()


class CommunityOut(ApiModel):
    id: uuid.UUID
    slug: str
    title: str
    name: str
    description: str
    avatar_url: str | None
    cover_url: str | None
    owner: UserCompact
    category: str | None = None
    location: str | None = None
    website_url: str | None = None
    is_private: bool
    # Staff-granted, drawn as the tick beside the channel's name wherever it appears.
    is_verified: bool = False
    members_count: int
    is_member: bool
    is_owner: bool
    role: str | None
    posts_count: int
    is_paid: bool = False
    monthly_price: int = 0
    created_at: datetime


class CommunityVerification(BaseModel):
    """Staff granting or withdrawing a channel's tick."""

    verified: bool


class CommunityPostCreate(PostCreate):
    pass


class CommunityPostOut(ApiModel):
    id: uuid.UUID
    community_id: uuid.UUID
    author: UserCompact
    content: str
    image_url: str | None
    created_at: datetime


class GiftModelOut(ApiModel):
    id: uuid.UUID
    slug: str
    name: str
    description: str
    image_url: str | None
    accent: str
    rarity: GiftRarity
    price_stars: int
    # What the owner pays afterwards to roll a model, a backdrop and a symbol.
    upgrade_price_stars: int = 25
    edition_size: int
    minted: int
    remaining: int
    limited: bool
    on_market: bool
    sold_out: bool
    # Drawing keys and the shelf the design is filed under.
    art: str = "orb"
    pattern: str = "star"
    backdrop_edge: str = "#08080a"
    category: str = "classic"
    category_label: str = "Классика"
    # How many ways one design can differ from itself. The full pools are only sent by the
    # design endpoint, because a 52-row storefront does not need 1600 variant names.
    models_count: int = 0
    backdrops_count: int = 0
    symbols_count: int = 0
    # Owners reselling this design right now, so the storefront can offer resale honestly.
    resale_count: int = 0
    resale_floor_stars: int | None = None


class GiftVariantOut(ApiModel):
    name: str
    rarity_percent: float


class GiftMarketOut(ApiModel):
    """One minted item its owner has put up for sale at a fixed price."""

    gift_id: uuid.UUID
    slug: str
    design_slug: str
    name: str
    serial_number: int
    edition_size: int
    rarity: GiftRarity
    accent: str
    backdrop_edge: str
    art: str
    pattern: str
    image_url: str | None
    model: str | None
    backdrop: str | None
    symbol: str | None
    price_stars: int
    value_stars: int
    owner: UserCompact
    listed_at: datetime | None
    is_mine: bool


class GiftDesignOut(GiftModelOut):
    """The storefront row plus everything the purchase sheet shows about one design."""

    models: list[GiftVariantOut] = Field(default_factory=list)
    backdrops: list[GiftVariantOut] = Field(default_factory=list)
    symbols: list[GiftVariantOut] = Field(default_factory=list)
    resale: list[GiftMarketOut] = Field(default_factory=list)


class GiftCategoryOut(ApiModel):
    key: str
    label: str
    count: int


class GiftPurchaseRequest(BaseModel):
    slug: Annotated[str, Field(min_length=1, max_length=80)]
    to_username: UsernameInput | None = None
    # The reference's "Добавить сообщение" and "Скрыть моё имя".
    message: Annotated[str | None, Field(max_length=200)] = None
    hide_my_name: bool = False
    # Collectors buy in runs — several serials of one design in one go. Each mint is still its
    # own numbered item with its own rolled variants; only the payment is batched.
    quantity: Annotated[int, Field(ge=1, le=10)] = 1


class GiftVisibilityUpdate(BaseModel):
    hidden: bool


class OffersToggle(BaseModel):
    """Whether the owner is willing to be asked a price for this item or handle."""

    offers_disabled: bool


class ChatGiftRequest(BaseModel):
    """
    Gifting inside a conversation.

    A group gift can go two ways: addressed to one member, or dropped for whoever takes it
    first. `to_username` and `claimable` are therefore mutually exclusive.
    """

    slug: Annotated[str, Field(min_length=1, max_length=80)]
    to_username: UsernameInput | None = None
    claimable: bool = False
    message: Annotated[str | None, Field(max_length=200)] = None
    hide_my_name: bool = False

    @field_validator("claimable")
    @classmethod
    def one_destination_only(cls, value: bool, info: ValidationInfo) -> bool:
        if value and info.data.get("to_username"):
            raise ValueError("Выберите получателя или открытый подарок, но не оба варианта")
        return value


class UsernameReserve(BaseModel):
    username: UsernameInput


class UsernameListingUpdate(BaseModel):
    for_sale: bool
    price: Annotated[int | None, Field(gt=0, le=1_000_000)] = None


class UsernameAssetOut(ApiModel):
    id: uuid.UUID
    username: str
    owner: UserCompact | None
    owner_username: str
    status: UsernameStatus
    rarity: str
    price: float | None
    currency: str
    is_owned_by_me: bool
    created_at: datetime
    acquired_at: datetime
    offers_count: int = 0
    last_action: str | None = None
    last_action_at: datetime | None = None
    is_primary_handle: bool = False
    # The owner is keeping this handle and refuses offers on it.
    offers_disabled: bool = False


class UsernameHistoryOut(ApiModel):
    id: uuid.UUID
    action: str
    from_user: UserCompact | None
    to_user: UserCompact | None
    price_stars: int | None
    created_at: datetime


class GiftOwner(UserCompact):
    pass


class GiftProvenanceOut(BaseModel):
    id: uuid.UUID | None
    event: str
    from_user: UserCompact | None
    to_user: UserCompact | None
    note: str | None
    occurred_at: datetime
    provenance_hash: str | None = None


class GiftOut(ApiModel):
    id: uuid.UUID
    slug: str
    name: str
    description: str
    serial_number: int
    edition_size: int
    supply: int
    rarity: GiftRarity
    image_url: str | None
    accent: str
    owner: GiftOwner
    owner_username: str
    creator: str
    received_at: datetime
    acquired_at: datetime
    is_owned_by_me: bool
    model: str | None = None
    backdrop: str | None = None
    symbol: str | None = None
    traits: dict[str, str | int | float] = Field(default_factory=dict)
    value_stars: int = 0
    provenance_hash: str | None = None
    showcased_as: str | None = None
    provenance: list[GiftProvenanceOut] = Field(default_factory=list)
    # Drawing keys, so a collectible renders identically wherever it appears.
    art: str = "orb"
    pattern: str = "star"
    backdrop_edge: str = "#08080a"
    model_name: str = ""
    pattern_color: str = "#ffffff"
    text_color: str = "#ffffff"
    design_slug: str | None = None
    category: str | None = None
    # Who sent it and what they wrote. `sender` is withheld when the buyer hid their name.
    sender: UserCompact | None = None
    sender_hidden: bool = False
    # True when the viewer is the one who gave it, which is the only case where a hidden name
    # is still returned — to the person who hid it.
    sent_by_me: bool = False
    message: str | None = None
    # A plain gift is the design's own artwork; upgrading rolls model, backdrop and symbol.
    upgraded_at: datetime | None = None
    upgraded: bool = True
    upgrade_price_stars: int = 25
    # Set while the owner is selling outright, which is what makes "купить" possible at all.
    sale_price_stars: int | None = None
    listed_at: datetime | None = None
    is_listed: bool = False
    hidden_in_profile: bool = False
    # Pinned items lead the collection, newest pin first.
    is_pinned: bool = False
    # The owner is not selling and does not want to be asked.
    offers_disabled: bool = False


class GiftPurchaseOut(ApiModel):
    gifts: list[GiftOut]
    spent_stars: int


class GiftListingUpdate(BaseModel):
    """`price_stars: null` withdraws the item from the market."""

    price_stars: Annotated[int | None, Field(ge=1, le=1_000_000)] = None


class GiftTransferCreate(BaseModel):
    to_username: UsernameInput
    note: Annotated[str | None, Field(max_length=200)] = None


class GiftShowcaseRequest(BaseModel):
    slot: Literal["featured", "cover2", "cover3", "cover4", "name"]


class ProfileShowcaseUpdate(BaseModel):
    featured_gift_id: uuid.UUID | None = None
    name_gift_id: uuid.UUID | None = None


class GiftOfferCreate(BaseModel):
    amount_stars: Annotated[int, Field(ge=1, le=1_000_000)]


class GiftOfferOut(ApiModel):
    id: uuid.UUID
    gift_id: uuid.UUID
    buyer: UserCompact
    seller: UserCompact
    amount_stars: int
    status: str
    created_at: datetime
    resolved_at: datetime | None


class NotificationOut(ApiModel):
    id: uuid.UUID
    kind: NotificationKind
    text: str
    actor: UserCompact | None
    entity_id: str | None
    is_read: bool
    read: bool
    created_at: datetime


class HealthResponse(BaseModel):
    status: str
    service: str
    database: str
