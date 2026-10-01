"""Durable SQLAlchemy models for accounts, social data, and collectibles."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


def utcnow() -> datetime:
    """Return an aware UTC timestamp."""
    return datetime.now(UTC)


class UsernameStatus(StrEnum):
    AVAILABLE = "available"
    RESERVED = "reserved"
    LISTED = "listed"


class GiftRarity(StrEnum):
    RARE = "rare"
    EPIC = "epic"
    LEGENDARY = "legendary"


class NotificationKind(StrEnum):
    LIKE = "like"
    COMMENT = "comment"
    MESSAGE = "message"
    GIFT = "gift"
    USERNAME = "username"
    FOLLOW = "follow"
    FOLLOW_REQUEST = "follow_request"
    SUBSCRIPTION = "subscription"
    STARS = "stars"
    COMMUNITY = "community"
    SYSTEM = "system"


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    username: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(80))
    avatar_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    cover_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    bio: Mapped[str] = mapped_column(String(280), default="")
    location: Mapped[str | None] = mapped_column(String(80), nullable=True)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    # Which kind of confirmation the mark stands for. Set by staff only, and shown in the
    # popover behind the tick so "подтверждён" says what was actually checked.
    verification_tier: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # Staff. Drawn as the V badge before the name wherever the account appears, and the only
    # flag that grants it — there is no way to buy or claim it.
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    # Moderation. A ban keeps the account and its history — posts stay up, marked — because
    # deleting the trail is what makes moderation unaccountable.
    banned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ban_reason: Mapped[str | None] = mapped_column(String(240), nullable=True)
    banned_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    is_online: Mapped[bool] = mapped_column(Boolean, default=False)
    related_usernames: Mapped[list[str]] = mapped_column(JSON, default=list)
    # Whether the handles shown under "а также" are picked automatically.
    #
    # True — the default, and what every account starts as — means "show everything I own", which is
    # the sensible thing before anybody has expressed a preference. Saving the profile form turns it
    # off, and from then on `related_usernames` is the whole list: that is what makes removing a
    # handle from the profile actually remove it. Without this flag the two states are
    # indistinguishable, and an empty list has to mean either "show all" or "show none" — the first
    # reading is why a removed handle used to come straight back.
    usernames_auto: Mapped[bool] = mapped_column(Boolean, default=True)
    profile_color: Mapped[str] = mapped_column(String(24), default="default")
    badges: Mapped[list[str]] = mapped_column(JSON, default=list)
    # Which of the badges this account has earned it chooses to wear. Kept apart from `badges`
    # because that column is what staff granted: a person picks from what they have, and the
    # picking must not be able to take a grant away.
    badge_slots: Mapped[list[str]] = mapped_column(JSON, default=list)
    followers_count: Mapped[int] = mapped_column(Integer, default=0)
    following_count: Mapped[int] = mapped_column(Integer, default=0)
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AuthIdentity(Base):
    """Private login material kept separate from public profile rows."""

    __tablename__ = "auth_identities"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class PendingRegistration(Base):
    """A verified-email gate before an account can reserve a username or receive a session."""

    __tablename__ = "pending_registrations"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    username: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(80))
    onboarding_complete: Mapped[bool] = mapped_column(Boolean, default=False)
    password_hash: Mapped[str] = mapped_column(String(255))
    code_hash: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    sent_count: Mapped[int] = mapped_column(Integer, default=1)
    last_sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class EmailLoginChallenge(Base):
    """Short-lived pre-auth state; a password alone never becomes a full session."""

    __tablename__ = "email_login_challenges"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    code_hash: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    sent_count: Mapped[int] = mapped_column(Integer, default=1)
    last_sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class UserPreferences(Base):
    """Private/setup state kept additive for pre-auth profile schemas."""

    __tablename__ = "user_preferences"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    interests: Mapped[list[str]] = mapped_column(JSON, default=list)
    onboarding_complete: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class UserSettings(Base):
    """
    Private switches: who may see me, and what may interrupt me.

    Separate from `UserPreferences`, which holds setup state and the public interests list —
    these are decisions about visibility and noise, and they are nobody else's business.
    """

    __tablename__ = "user_settings"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    # Hiding presence hides both the dot and the exact last-seen time; others then see only
    # that the account was around recently, which is true without being a tracker.
    show_online: Mapped[bool] = mapped_column(Boolean, default=True)
    # A private account keeps its profile readable — name, avatar, counts — and closes the
    # content tabs to anyone who does not follow it.
    private_account: Mapped[bool] = mapped_column(Boolean, default=False)
    # Who may open a direct chat: everyone, only people this account follows, or nobody.
    # Enforced when a chat or a message is created, not merely hidden in the UI.
    who_can_message: Mapped[str] = mapped_column(String(20), default="everyone")
    # Two inboxes for things other people can put in your collection without asking. Closing one
    # refuses the handover at the source rather than hiding it afterwards: an unwanted collectible
    # that has already landed is somebody else's property sitting in your profile, and getting rid
    # of it costs the same work as receiving it did. Open by default — a present is normally welcome.
    accept_usernames: Mapped[bool] = mapped_column(Boolean, default=True)
    accept_gifts: Mapped[bool] = mapped_column(Boolean, default=True)
    status_emoji: Mapped[str | None] = mapped_column(String(8), nullable=True)
    status_text: Mapped[str | None] = mapped_column(String(40), nullable=True)
    notify_likes: Mapped[bool] = mapped_column(Boolean, default=True)
    notify_comments: Mapped[bool] = mapped_column(Boolean, default=True)
    notify_follows: Mapped[bool] = mapped_column(Boolean, default=True)
    notify_gifts: Mapped[bool] = mapped_column(Boolean, default=True)
    notify_messages: Mapped[bool] = mapped_column(Boolean, default=True)
    notify_stars: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class UserProfileDetails(Base):
    """Optional public profile fields kept separate from the core user row."""

    __tablename__ = "user_profile_details"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    website_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    birthday: Mapped[date | None] = mapped_column(Date, nullable=True)
    github_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    telegram_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    profile_song_title: Mapped[str | None] = mapped_column(String(120), nullable=True)
    profile_song_artist: Mapped[str | None] = mapped_column(String(120), nullable=True)
    profile_song_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    featured_community_slug: Mapped[str | None] = mapped_column(String(48), nullable=True)
    # A profile may advertise a few of its owner's communities, in the order they chose. The
    # single column above stays the first of them, so every older reader keeps working.
    featured_community_slugs: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    role_title: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # Authored by the profile owner and shown to every visitor, not a viewer-private memo.
    profile_note: Mapped[str | None] = mapped_column(String(200), nullable=True)
    streak_days: Mapped[int] = mapped_column(Integer, default=0)
    streak_updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class ProfileStory(Base):
    """Ephemeral or highlighted media attached to a public profile, or to a channel."""

    __tablename__ = "profile_stories"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    author_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    # Set when the story belongs to a channel rather than to its author's own profile: the
    # reference posts one with `?community=<slug>`, and it then appears only on that channel.
    community_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("communities.id", ondelete="CASCADE"), nullable=True, index=True
    )
    title: Mapped[str] = mapped_column(String(120))
    media_url: Mapped[str] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, index=True
    )
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    highlight: Mapped[bool] = mapped_column(Boolean, default=True)


class StoryView(Base):
    """
    One person's viewing of one story.

    A row per pair rather than a counter: the author is shown *who* watched, and the ring in
    the rail has to know whether *this* reader has already seen it.
    """

    __tablename__ = "story_views"
    __table_args__ = (UniqueConstraint("story_id", "user_id", name="uq_story_view"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    story_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("profile_stories.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class RefreshSession(Base):
    """Server-side record for one rotating refresh credential."""

    __tablename__ = "refresh_sessions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    replaced_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("refresh_sessions.id", ondelete="SET NULL"), nullable=True
    )
    user_agent: Mapped[str | None] = mapped_column(String(300), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class UserNote(Base):
    __tablename__ = "user_notes"
    __table_args__ = (UniqueConstraint("viewer_id", "target_id", name="uq_user_note_pair"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    viewer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    target_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    text: Mapped[str] = mapped_column(String(500), default="")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class Follow(Base):
    __tablename__ = "follows"
    __table_args__ = (
        UniqueConstraint("follower_id", "following_id", name="uq_follow_pair"),
        CheckConstraint("follower_id <> following_id", name="ck_follow_not_self"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    follower_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    following_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class FollowRequest(Base):
    """
    A pending "let me in" for a closed account.

    A private account is not asking to be invisible, it is asking to decide: following it
    writes a request instead of a `Follow`, and only the owner's acceptance turns it into one.
    The row is deleted either way, so a refused request can be sent again later.
    """

    __tablename__ = "follow_requests"
    __table_args__ = (
        UniqueConstraint("requester_id", "target_id", name="uq_follow_request_pair"),
        CheckConstraint("requester_id <> target_id", name="ck_follow_request_not_self"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    requester_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    target_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class UserBlock(Base):
    """
    One person refusing another: no direct chat, no message, in either direction.

    Kept one-directional so unblocking restores only my own decision — if they blocked me
    too, that row is theirs to remove.
    """

    __tablename__ = "user_blocks"
    __table_args__ = (
        UniqueConstraint("blocker_id", "blocked_id", name="uq_user_block_pair"),
        CheckConstraint("blocker_id <> blocked_id", name="ck_user_block_not_self"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    blocker_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    blocked_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Post(Base):
    __tablename__ = "posts"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    author_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    # Set when the post was published into a community rather than onto a profile. One model for
    # both: a channel post that could not be liked, answered or counted was a different product
    # wearing the same word, and every feature had to be built twice.
    community_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("communities.id", ondelete="CASCADE"), nullable=True, index=True
    )
    content: Mapped[str] = mapped_column(Text)
    image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Up to four pictures, in the order the author arranged them. `image_url` stays the first
    # of them, so every older reader of this row keeps working.
    image_urls: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    # One clip, played by our own player rather than the browser's default controls.
    video_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # The author marked it themselves. The post stays in every list it belongs to; only its
    # pictures and clip arrive covered, and the reader decides whether to look.
    sensitive: Mapped[bool] = mapped_column(Boolean, default=False)
    # Hidden by staff. The row stays so the author can be told what happened and why, and so the
    # decision is auditable; only readers other than the author and staff stop seeing it.
    hidden_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    hidden_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    hidden_reason: Mapped[str | None] = mapped_column(String(240), nullable=True)
    # One attached document: where it landed, what the author called it, and how big it is, so
    # a reader can decide before downloading. Served only as an attachment, never inline.
    file_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    file_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    file_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # A poll's options, in the order the author wrote them: `["Да", "Нет"]`. The question is the
    # post's own text, as in the reference — a poll is a post that asks something, not a widget
    # with a title of its own. Votes are rows, so nothing here is a running total that can lie.
    poll_options: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    # An outbound link the author attached on purpose, drawn as a card under the text.
    link_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    link_title: Mapped[str | None] = mapped_column(String(120), nullable=True)
    # Every view, including repeats by the same reader. The unique count is the number of
    # `post_views` rows; this one is why a post can be read 184 times by 179 people.
    views_total: Mapped[int] = mapped_column(Integer, default=0)
    # A resolved music link — title, artist, artwork, provider, external url — kept as one
    # blob because it is written and read whole and never queried by part.
    music: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    # Set the first time the author rewrites the text, which is what puts «ред.» next to the
    # date. A rewritten post keeps its id, its likes and its comments.
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # An author keeps one post at the top of their profile. Pinning another one unpins this,
    # so the column doubles as "which one" and "since when".
    pinned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # A Premium author may write now and publish later. Until this moment passes the post exists
    # only for its author: no feed, no profile, no direct link. Nothing schedules anything —
    # visibility is `publish_at <= now`, so the post appears by itself when the time comes and no
    # background job can forget it.
    publish_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, index=True
    )


class PostView(Base):
    """
    One row per reader per post.

    The counter used to be a formula over likes and comments, which meant a post nobody opened
    still claimed hundreds of views. Rows cannot lie about that.
    """

    __tablename__ = "post_views"
    __table_args__ = (UniqueConstraint("post_id", "user_id", name="uq_post_view"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    post_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("posts.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PostLike(Base):
    __tablename__ = "post_likes"
    __table_args__ = (UniqueConstraint("post_id", "user_id", name="uq_post_like"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    post_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("posts.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PostComment(Base):
    __tablename__ = "post_comments"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    post_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("posts.id", ondelete="CASCADE"), index=True
    )
    author_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    content: Mapped[str] = mapped_column(String(1000))
    # A reply points at the comment it answers, which is what lets a thread collapse under it.
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("post_comments.id", ondelete="CASCADE"), nullable=True, index=True
    )
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    # Removed by staff. Same reasoning as a hidden post: the row survives so its author can be
    # told, and so the removal can be reviewed afterwards.
    hidden_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    hidden_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    hidden_reason: Mapped[str | None] = mapped_column(String(240), nullable=True)


class PostCommentLike(Base):
    """One person's like on one comment; the count is the number of rows."""

    __tablename__ = "post_comment_likes"
    __table_args__ = (UniqueConstraint("comment_id", "user_id", name="uq_comment_like"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    comment_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("post_comments.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PostBookmark(Base):
    __tablename__ = "post_bookmarks"
    __table_args__ = (UniqueConstraint("post_id", "user_id", name="uq_post_bookmark"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    post_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("posts.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PostRepost(Base):
    __tablename__ = "post_reposts"
    __table_args__ = (UniqueConstraint("post_id", "user_id", name="uq_post_repost"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    post_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("posts.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PostDraft(Base):
    """
    A post that is not published yet.

    Kept on the server rather than in the browser, because a draft that only exists on the
    machine that typed it is a note, not a draft: the point is to start on a phone and finish at
    a desk. It carries exactly what the composer holds, so loading one restores the whole thing.
    """

    __tablename__ = "post_drafts"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    author_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    # Set when the draft is meant for a channel, so it is offered back in the right composer.
    community_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("communities.id", ondelete="CASCADE"), nullable=True
    )
    content: Mapped[str] = mapped_column(Text, default="")
    image_urls: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    video_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    file_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    file_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    file_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    poll_options: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    sensitive: Mapped[bool] = mapped_column(Boolean, default=False)
    link_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    link_title: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class PostPollVote(Base):
    """
    One person's answer to one poll.

    Unique per post, and not changeable: a poll whose results move as people reconsider is a
    survey, and the reference's is a snapshot. Refusing the second vote says so out loud.
    """

    __tablename__ = "post_poll_votes"
    __table_args__ = (UniqueConstraint("post_id", "user_id", name="uq_post_poll_vote"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    post_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("posts.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    option_index: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PostMute(Base):
    """
    One person's silence over one post.

    Muting is about notifications only: the post stays in the feed, its counters keep moving,
    and nothing about it interrupts the muter again — theirs or someone else's.
    """

    __tablename__ = "post_mutes"
    __table_args__ = (UniqueConstraint("post_id", "user_id", name="uq_post_mute"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    post_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("posts.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ContentReport(Base):
    """
    A complaint, whatever it is about.

    Posts, accounts, conversations, single messages and communities are all reported on the
    same terms, so they are one table with a `target_kind` rather than five tables that would
    drift apart. One row per person per target: complaining twice is the same complaint, and
    the second one replaces the reason instead of stacking.

    `target_id` is a string because not every target is a uuid — a community is named by its
    slug, and pretending otherwise would mean a join that cannot exist.
    """

    __tablename__ = "content_reports"
    __table_args__ = (
        UniqueConstraint("target_kind", "target_id", "reporter_id", name="uq_content_report"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    target_kind: Mapped[str] = mapped_column(String(20), index=True)
    target_id: Mapped[str] = mapped_column(String(64), index=True)
    reporter_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    reason: Mapped[str] = mapped_column(String(40))
    comment: Mapped[str | None] = mapped_column(String(300), nullable=True)
    # Whose content it was, when that is known: it turns "how many complaints does this account
    # have" into one query instead of five joins, which is what the profile warning needs.
    subject_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # A snapshot of what was reported, because the original can be edited or deleted before
    # anyone reviews it, and a moderator judging a blank row is judging nothing.
    excerpt: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # The review state. Open complaints are the queue and the thing that marks an account;
    # resolved ones stay for the record but stop counting against anybody.
    status: Mapped[str] = mapped_column(String(16), default="open", index=True)
    resolution: Mapped[str | None] = mapped_column(String(240), nullable=True)
    resolved_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class LegalReport(Base):
    """A public legal, safety, or support request submitted without requiring an account."""

    __tablename__ = "legal_reports"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    kind: Mapped[str] = mapped_column(String(32), index=True)
    reporter_role: Mapped[str] = mapped_column(String(24))
    reporter_name: Mapped[str] = mapped_column(String(100))
    reporter_email: Mapped[str] = mapped_column(String(254), index=True)
    country: Mapped[str | None] = mapped_column(String(80), nullable=True)
    account_username: Mapped[str | None] = mapped_column(String(32), nullable=True)
    content_urls: Mapped[list[str]] = mapped_column(JSON, default=list)
    original_work: Mapped[str | None] = mapped_column(Text, nullable=True)
    details: Mapped[str] = mapped_column(Text)
    requested_action: Mapped[str | None] = mapped_column(Text, nullable=True)
    electronic_signature: Mapped[str | None] = mapped_column(String(120), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="open", index=True)
    resolution: Mapped[str | None] = mapped_column(String(500), nullable=True)
    resolved_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class Chat(Base):
    __tablename__ = "chats"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    title: Mapped[str | None] = mapped_column(String(100), nullable=True)
    is_group: Mapped[bool] = mapped_column(Boolean, default=False)
    # `kind` carries what `is_group` cannot: a secret chat and a saved-messages chat are both
    # non-group, yet each is drawn and treated differently. `is_group` stays in sync so
    # existing rows and queries keep working.
    kind: Mapped[str] = mapped_column(String(16), default="direct")
    avatar_url: Mapped[str | None] = mapped_column(String(300), nullable=True)
    owner_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # A secret group is end-to-end encrypted with per-member sender keys: its message bodies are
    # ciphertext the server cannot read. `kind` stays "group" so every existing group query and
    # view keeps working; this flag only gates the no-plaintext-preview path and the client's
    # sender-key fan-out. Non-group chats carry their secrecy in `kind == "secret"` instead.
    is_secret: Mapped[bool] = mapped_column(Boolean, default=False)
    # A public group is one anybody with its link may walk into; a private one is entered only by
    # the owner's invitation. The code *is* the link, so clearing it closes the door on every
    # link already sent.
    is_public: Mapped[bool] = mapped_column(Boolean, default=False)
    invite_code: Mapped[str | None] = mapped_column(
        String(24), nullable=True, unique=True, index=True
    )
    # Auto-delete is a property of the conversation, not of one reader: both sides watch the
    # same messages disappear. Zero means off, which is what every existing chat gets.
    autodelete_seconds: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ChatMember(Base):
    __tablename__ = "chat_members"
    __table_args__ = (UniqueConstraint("chat_id", "user_id", name="uq_chat_member"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    chat_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("chats.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    last_read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    # Pin, archive and "delete" are per-person views of a shared chat: my pinning it must
    # not move it for the other side, and my clearing it must not erase their history.
    pinned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cleared_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # "Пометить непрочитанным" survives having already read the chat, so it cannot be
    # derived from `last_read_at` — it is a flag the reader sets by hand.
    marked_unread: Mapped[bool] = mapped_column(Boolean, default=False)
    # Muting silences my notifications for this chat while still counting the unread, the way
    # the reference does: the badge stays, the toast does not.
    muted: Mapped[bool] = mapped_column(Boolean, default=False)


class ChatFolder(Base):
    """A personal grouping of conversations, like the folder strip above the chat list."""

    __tablename__ = "chat_folders"
    __table_args__ = (UniqueConstraint("user_id", "title", name="uq_chat_folder_title"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(40))
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ChatFolderItem(Base):
    __tablename__ = "chat_folder_items"
    __table_args__ = (UniqueConstraint("folder_id", "chat_id", name="uq_chat_folder_item"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    folder_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("chat_folders.id", ondelete="CASCADE"), index=True
    )
    chat_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("chats.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    chat_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("chats.id", ondelete="CASCADE"), index=True
    )
    sender_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    content: Mapped[str] = mapped_column(Text)
    # An attached image sits beside the text rather than inside it, so a picture and its
    # caption stay one message.
    media_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # What `media_url` actually is. NULL reads as "image": every row written before clips were
    # accepted held a picture, so the absent value is already the truth about them.
    media_kind: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # One attached document, described well enough that a reader can decide before downloading.
    # Handed back only as a download, never inline — see `download_post_file`.
    file_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    file_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    file_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, index=True
    )
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Pins and similar events are stored as messages so they keep their place in the
    # timeline; the client draws them as a centred notice instead of a bubble.
    is_service: Mapped[bool] = mapped_column(Boolean, default=False)
    pinned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reply_to_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("messages.id", ondelete="SET NULL"), nullable=True
    )
    forwarded_from_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # A sent gift is announced in the chat and rendered as a card, so the message points at
    # the collectible instead of only describing it in text.
    gift_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("gifts.id", ondelete="SET NULL"), nullable=True
    )
    # A gift dropped into a group belongs to nobody until a member takes it, so the card
    # carries its own claim state rather than a recipient.
    gift_claimable: Mapped[bool] = mapped_column(Boolean, default=False)
    gift_claimed_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # A story shared into the chat points at the story itself, so the bubble shows what it is
    # now — expired, or deleted by its author — instead of a copy that outlives the original.
    story_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("profile_stories.id", ondelete="SET NULL"), nullable=True
    )


class RealtimeOutbox(Base):
    """One durable per-user event committed in the same transaction as its domain mutation."""

    __tablename__ = "realtime_outbox"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    event_type: Mapped[str] = mapped_column(String(96))
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    idempotency_key: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, index=True
    )
    next_attempt_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, index=True
    )
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    last_error_class: Mapped[str | None] = mapped_column(String(48), nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    published_cursor: Mapped[int | None] = mapped_column(BigInteger, nullable=True)


class MessageReaction(Base):
    """
    One reaction per person per message.

    The unique pair is deliberate: reacting again with the same emoji clears it, and a
    different emoji replaces it, which is how the reference behaves.
    """

    __tablename__ = "message_reactions"
    __table_args__ = (UniqueConstraint("message_id", "user_id", name="uq_message_reaction"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    message_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("messages.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    emoji: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class MessageHide(Base):
    """A message removed for one participant only ("удалить у себя")."""

    __tablename__ = "message_hides"
    __table_args__ = (UniqueConstraint("message_id", "user_id", name="uq_message_hide"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    message_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("messages.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class StarWallet(Base):
    __tablename__ = "star_wallets"
    __table_args__ = (CheckConstraint("balance >= 0", name="ck_star_wallet_nonnegative"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    balance: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class StarPurchase(Base):
    """
    An order for site stars, charged in Telegram Stars inside our own bot.

    The row exists before the money does: the site mints it, the buyer opens the bot through a
    deep link carrying `payload`, and the bot reports the charge back. `telegram_charge_id` is
    unique because Telegram may deliver the same successful payment twice, and a second credit
    for one payment is the one mistake a wallet must never make.
    """

    __tablename__ = "star_purchases"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    package_slug: Mapped[str] = mapped_column(String(32))
    # What the buyer receives here, and what Telegram charges for it.
    stars: Mapped[int] = mapped_column(Integer)
    price_xtr: Mapped[int] = mapped_column(Integer)
    # The deep-link token. It is the invoice payload too, so the bot never has to trust a number
    # typed by whoever opened the chat.
    payload: Mapped[str] = mapped_column(String(48), unique=True, index=True)
    # pending | paid | cancelled | expired | refunded | paid_out
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    telegram_user_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    telegram_charge_id: Mapped[str | None] = mapped_column(
        String(128), nullable=True, unique=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, index=True
    )
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Which payout consumed this charge, when one did. Telegram has no call that sends Stars to a
    # person, but `refundStarPayment` returns them — so a withdrawal can be carried out by handing
    # back a charge of exactly the right size. That charge is then spent: it cannot also be
    # refunded through the refund flow, and this is what says so. Plain column, no constraint:
    # `_add_missing_columns` adds columns to existing tables and cannot add a foreign key.
    payout_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)


class StarRefund(Base):
    """
    A request to give a Telegram Stars payment back.

    The decision is a person's, not a rule's: the buyer states a reason, an admin answers it in
    Telegram, and only then does anything move. Both conditions are checked again at that moment —
    the two-week window may have closed and the stars may have been spent since the request.

    Money moves in one order and only one: the site debits first, Telegram refunds second. The
    other way round leaves a buyer holding both halves if the debit turns out to be impossible.
    """

    __tablename__ = "star_refunds"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    purchase_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("star_purchases.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    reason: Mapped[str] = mapped_column(Text)
    # pending | approved | declined | failed
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    admin_note: Mapped[str | None] = mapped_column(String(240), nullable=True)
    decided_by_telegram_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    # When the bot handed this request to an admin, so one request is announced once.
    notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    requested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, index=True
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # When Telegram actually gave the money back. An approval on the site is only half of it:
    # `refundStarPayment` still has to be called, and it must be called exactly once, whether the
    # approval came from the bot's buttons or from the admin panel.
    telegram_done_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class StarPayout(Base):
    """
    A request to take site stars out of GRAM as Telegram Stars.

    The mirror image of `StarPurchase` at the same rate — twenty of ours for one of theirs — with
    one difference that decides the whole design: Telegram has no API for sending Stars to a
    person, so the last step is a human's. The site therefore does what it alone can do, and does
    it first: the stars leave the balance the moment the request is made, so nobody can spend the
    same stars twice while a payout waits. An admin then confirms or refuses in the panel, and the
    stars come back on a refusal or a failure.
    """

    __tablename__ = "star_payouts"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    # What leaves here, and what has to arrive in Telegram.
    stars: Mapped[int] = mapped_column(Integer)
    price_xtr: Mapped[int] = mapped_column(Integer)
    # Where it goes. The id is what an earlier purchase through the bot taught us; the username is
    # what the requester typed when we know nothing, and then an admin resolves it by hand.
    telegram_user_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    telegram_username: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # pending | approved | paid | declined | failed | cancelled
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    admin_note: Mapped[str | None] = mapped_column(String(240), nullable=True)
    decided_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    decided_by_telegram_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    # When the bot told the admins about it, so an approved payout is announced once.
    notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    requested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, index=True
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class StarLedger(Base):
    __tablename__ = "star_ledger"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    amount: Mapped[int] = mapped_column(Integer)
    balance_after: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(40))
    description: Mapped[str] = mapped_column(String(240))
    counterparty_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    entity_type: Mapped[str | None] = mapped_column(String(40), nullable=True)
    entity_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    correlation_id: Mapped[uuid.UUID] = mapped_column(default=uuid.uuid4, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class CryptoInvoice(Base):
    """
    One crypto top-up: an address to send to, and the credit it becomes when the money lands.

    The row exists before the money does, exactly like `StarPurchase`. What differs is who confirms
    it: Telegram tells our bot about a charge, whereas here *we* ask NOWPayments what happened.
    Nothing is credited on a callback's word — a callback only says "look again", and the look is an
    authenticated read of the payment by its provider id.

    `credited_at` is the idempotency latch. A provider may deliver the same `finished` state to a
    callback, to a poll from the buyer's open browser tab and to an admin's refresh within the same
    second; whichever gets there first sets this, and the others find it set and do nothing. That is
    the one mistake a wallet must never make.
    """

    __tablename__ = "crypto_invoices"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    package_slug: Mapped[str] = mapped_column(String(32))
    # What the buyer receives here, and the fiat price the crypto amount was quoted from.
    stars: Mapped[int] = mapped_column(Integer)
    price_amount: Mapped[float] = mapped_column(Float)
    price_currency: Mapped[str] = mapped_column(String(8), default="uah")
    # Which coin and network, and how much of it the provider asked for.
    pay_currency: Mapped[str] = mapped_column(String(24))
    pay_amount: Mapped[float] = mapped_column(Float, default=0)
    pay_address: Mapped[str] = mapped_column(String(200), default="")
    # Some chains need a memo/tag beside the address; sending without it loses the payment.
    payin_extra_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    network_label: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Ours, and how a callback finds the row. Carries no secret: the credit is decided by re-reading
    # the payment from the provider, so a guessed order id buys nothing.
    order_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    # The provider's own id. Unique so two rows can never claim one payment.
    provider_payment_id: Mapped[str | None] = mapped_column(
        String(64), nullable=True, unique=True, index=True
    )
    # waiting | confirming | confirmed | sending | finished | partially_paid | failed | refunded |
    # expired — the provider's vocabulary, stored verbatim so an admin sees what it actually said.
    provider_status: Mapped[str] = mapped_column(String(24), default="waiting", index=True)
    # How much really arrived, which is how an underpayment is recognised.
    actually_paid: Mapped[float] = mapped_column(Float, default=0)
    # pending | paid | expired | cancelled | underpaid | failed — ours, for the UI.
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )
    # Set once, when the stars are actually added. The latch described above.
    credited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # What the provider last told us, for an admin looking at a payment that went wrong.
    provider_note: Mapped[str | None] = mapped_column(String(400), nullable=True)


class CryptoPayoutDetails(Base):
    """
    Where an approved crypto withdrawal has to go.

    A separate table rather than more columns on `StarPayout` for one reason: a Telegram payout and
    a crypto payout are different destinations, not different flavours of one. Keeping the address,
    coin and network out here means the Telegram path is untouched by this feature and a payout with
    no crypto details is unambiguously a Telegram payout.

    The address is validated against the provider before the request is accepted — a wrong checksum
    is a typo, and finding it after an admin has sent the money is finding it too late.
    """

    __tablename__ = "crypto_payout_details"

    payout_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("star_payouts.id", ondelete="CASCADE"), primary_key=True
    )
    # The coin the person wants, its human label and the network — all three are shown to the admin
    # who sends it, because "USDT" without a network is not an instruction.
    currency: Mapped[str] = mapped_column(String(24))
    asset_label: Mapped[str] = mapped_column(String(24), default="")
    network_label: Mapped[str] = mapped_column(String(64), default="")
    address: Mapped[str] = mapped_column(String(200))
    extra_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    # What the payout is worth in fiat and in the coin, quoted when the request was made. Stored
    # rather than recomputed so the admin pays what the person was promised.
    fiat_amount: Mapped[float] = mapped_column(Float, default=0)
    fiat_currency: Mapped[str] = mapped_column(String(8), default="uah")
    quoted_amount: Mapped[float] = mapped_column(Float, default=0)
    quoted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    # Filled by the admin when the transfer is done: the chain's own receipt.
    tx_hash: Mapped[str | None] = mapped_column(String(160), nullable=True)
    # If the payout is ever sent through the provider's API rather than by hand.
    provider_payout_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    provider_status: Mapped[str | None] = mapped_column(String(24), nullable=True)


class CreatorSubscription(Base):
    __tablename__ = "creator_subscriptions"
    __table_args__ = (
        UniqueConstraint("subscriber_id", "creator_id", name="uq_creator_subscription"),
        CheckConstraint("subscriber_id <> creator_id", name="ck_subscription_not_self"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    subscriber_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    creator_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    price_stars: Mapped[int] = mapped_column(Integer)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    current_period_ends: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class CreatorSettings(Base):
    __tablename__ = "creator_settings"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    paid_subscription_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    monthly_price: Mapped[int] = mapped_column(Integer, default=50)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class PremiumEntitlement(Base):
    __tablename__ = "premium_entitlements"
    __table_args__ = (UniqueConstraint("user_id", "plan", name="uq_premium_user_plan"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    plan: Mapped[str] = mapped_column(String(30), default="monthly")
    price_stars: Mapped[int] = mapped_column(Integer, default=500)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Premium can be a present, and the present has a sender worth naming in the sheet and in
    # the notice. Null means the holder bought it themselves.
    gifted_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class Community(Base):
    __tablename__ = "communities"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(String(48), unique=True, index=True)
    title: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(String(500), default="")
    avatar_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    cover_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    category: Mapped[str | None] = mapped_column(String(60), nullable=True)
    location: Mapped[str | None] = mapped_column(String(80), nullable=True)
    website_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_private: Mapped[bool] = mapped_column(Boolean, default=False)
    # Granted by staff, like a person's tick: a channel cannot claim or buy it.
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    members_count: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class CommunityMember(Base):
    __tablename__ = "community_members"
    __table_args__ = (UniqueConstraint("community_id", "user_id", name="uq_community_member"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    community_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("communities.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[str] = mapped_column(String(20), default="member")
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class CommunityPost(Base):
    """
    Deprecated: community posts are `Post` rows with a `community_id` now.

    The table is kept because its rows are the history of everything published before the two
    models were merged; they are copied into `posts` once, when the new column appears.
    """

    __tablename__ = "community_posts"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    community_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("communities.id", ondelete="CASCADE"), index=True
    )
    author_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    content: Mapped[str] = mapped_column(Text)
    image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class UsernameAsset(Base):
    __tablename__ = "username_assets"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    username: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    owner_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # A handle can point at a channel instead of a person. One namespace: `@gram` is either
    # somebody's account, somebody's channel or nobody's — never two of those at once.
    community_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("communities.id", ondelete="SET NULL"), nullable=True, index=True
    )
    status: Mapped[UsernameStatus] = mapped_column(
        Enum(UsernameStatus, native_enum=False, length=20), default=UsernameStatus.AVAILABLE
    )
    price: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    currency: Mapped[str] = mapped_column(String(12), default="STARS")
    reserved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    listed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # An owner who is keeping the handle stops being asked for a price.
    offers_disabled: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class UsernameOffer(Base):
    """
    A bid on a handle, with the bidder's stars held until the owner answers.

    Held rather than promised: an accepted offer that cannot be paid is worse than no offer, so
    the amount leaves the bidder's wallet when they bid and comes back if the offer does not
    become a sale.
    """

    __tablename__ = "username_offers"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    asset_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("username_assets.id", ondelete="CASCADE"), index=True
    )
    bidder_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    amount_stars: Mapped[int] = mapped_column(Integer)
    # pending | accepted | declined | withdrawn | cancelled
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, index=True
    )
    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class UsernameOwnershipEvent(Base):
    __tablename__ = "username_ownership_events"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    asset_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("username_assets.id", ondelete="CASCADE"), index=True
    )
    from_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    to_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    action: Mapped[str] = mapped_column(String(30))
    price_stars: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AnonymousNumber(Base):
    """
    A collectible anonymous +888 number, in the spirit of Telegram's anonymous numbers.

    A number is a scarce identifier in a shared pool of every valid +888 XXXX XXXX. Rows are
    created lazily — the pool is virtual, so only a curated showcase and any number somebody
    actually buys ever exist here. `number` is the twelve digits after the country code,
    stored without spaces or the leading +888 (e.g. "88888888"), and is globally unique.

    Only one number may be *held* by an account at a time (enforced in the API, not the schema,
    because a released or sold row keeps its history with owner_id cleared). Status mirrors the
    handle market: available (curated, nobody owns it), reserved (owned, kept) and listed
    (owned, on sale).
    """

    __tablename__ = "anonymous_numbers"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    number: Mapped[str] = mapped_column(String(15), unique=True, index=True)
    owner_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    status: Mapped[UsernameStatus] = mapped_column(
        Enum(UsernameStatus, native_enum=False, length=20), default=UsernameStatus.AVAILABLE
    )
    price: Mapped[int | None] = mapped_column(Integer, nullable=True)
    currency: Mapped[str] = mapped_column(String(12), default="STARS")
    # Whether the number is one of the curated showcase lots the platform sells at its floor.
    curated: Mapped[bool] = mapped_column(Boolean, default=False)
    reserved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    listed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class NumberOwnershipEvent(Base):
    __tablename__ = "number_ownership_events"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    number_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("anonymous_numbers.id", ondelete="CASCADE"), index=True
    )
    from_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    to_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    action: Mapped[str] = mapped_column(String(30))
    price_stars: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Gift(Base):
    __tablename__ = "gifts"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(String(80), unique=True)
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(String(240), default="")
    serial_number: Mapped[int] = mapped_column(Integer)
    edition_size: Mapped[int] = mapped_column(Integer)
    rarity: Mapped[GiftRarity] = mapped_column(
        Enum(GiftRarity, native_enum=False, length=20), default=GiftRarity.RARE
    )
    image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    accent: Mapped[str] = mapped_column(String(32), default="#8B5CF6")
    # Artwork is drawn by the client from three keys rather than fetched as a bitmap: `art`
    # selects the object, `pattern` the symbol scattered behind it, and accent/backdrop_edge
    # are the resolved backdrop ramp. Denormalised onto the item so a compact card in a chat
    # or a profile can animate without joining the collectible row.
    art: Mapped[str] = mapped_column(String(40), default="orb")
    pattern: Mapped[str] = mapped_column(String(40), default="star")
    backdrop_edge: Mapped[str] = mapped_column(String(32), default="#08080a")
    # Canonical Telegram gift name and the rolled model, denormalised so any surface can build
    # an artwork URL from the item alone. The two extra backdrop colours are Telegram's own:
    # `pattern_color` tints the symbol layer, `text_color` the caption over the backdrop.
    tg_name: Mapped[str] = mapped_column(String(80), default="")
    model_name: Mapped[str] = mapped_column(String(80), default="")
    pattern_color: Mapped[str] = mapped_column(String(32), default="#ffffff")
    text_color: Mapped[str] = mapped_column(String(32), default="#ffffff")
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    # Who bought it and what they wrote, so a received gift can be presented as a gift and
    # not only as an item. `sender_hidden` is the reference's "Скрыть моё имя".
    sender_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    sender_hidden: Mapped[bool] = mapped_column(Boolean, default=False)
    message: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # Deprecated: the wrapped-box mechanic it drove is gone. Kept only because the schema is
    # migrated additively and old rows still carry the value.
    opened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # A gift arrives plain — the design's own artwork, no model, no backdrop, no symbol. Paying
    # the upgrade fee rolls all three from the real pools, which is the moment it becomes a
    # collectible. Null means still plain, and `model_name` is empty while that holds.
    upgraded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Set by the owner to sell outright. A listed item can be bought with one action instead
    # of only receiving offers, which is the difference between a market and a bid box.
    sale_price_stars: Mapped[int | None] = mapped_column(Integer, nullable=True)
    listed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Owners curate what their profile shows. A hidden item stays theirs, keeps its provenance
    # and can still be sold — it simply does not appear in the public collection.
    hidden_in_profile: Mapped[bool] = mapped_column(Boolean, default=False)
    # An owner who is not selling stops being asked: offers on this item are refused outright.
    offers_disabled: Mapped[bool] = mapped_column(Boolean, default=False)
    # Pinned items open the collection, newest pin first, however old the item itself is. This
    # is about order in the list; the showcase slots are about the two places on the header.
    pinned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class GiftModel(Base):
    """A purchasable collectible design; each purchase mints one numbered `Gift`."""

    __tablename__ = "gift_models"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(String(240), default="")
    image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    accent: Mapped[str] = mapped_column(String(32), default="#1f1f26")
    backdrop_edge: Mapped[str] = mapped_column(String(32), default="#08080a")
    rarity: Mapped[GiftRarity] = mapped_column(
        Enum(GiftRarity, native_enum=False, length=20), default=GiftRarity.RARE
    )
    price_stars: Mapped[int] = mapped_column(Integer, default=25)
    edition_size: Mapped[int] = mapped_column(Integer, default=1000)
    model_name: Mapped[str] = mapped_column(String(80), default="Original")
    backdrop: Mapped[str] = mapped_column(String(80), default="Midnight")
    symbol: Mapped[str] = mapped_column(String(80), default="GRAM")
    limited: Mapped[bool] = mapped_column(Boolean, default=False)
    on_market: Mapped[bool] = mapped_column(Boolean, default=False)
    available: Mapped[bool] = mapped_column(Boolean, default=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    # Drawing key for the animated artwork, and the shelf the design is filed under.
    art: Mapped[str] = mapped_column(String(40), default="orb")
    category: Mapped[str] = mapped_column(String(40), default="classic", index=True)
    # The design's canonical Telegram name and gift id. `tg_name` is what artwork URLs are
    # built from; the slug is ours and stays stable even if a display name is re-cased.
    tg_name: Mapped[str] = mapped_column(String(80), default="")
    tg_gift_id: Mapped[str] = mapped_column(String(32), default="")
    # Each mint draws one entry from each pool, which is what makes two copies of the same
    # design look different. Entries are `{name, permille}` — Telegram's own drop rates — and
    # backdrops carry their four colours as well. Empty pools fall back to the singular
    # `model_name`/`backdrop`/`symbol` above, so a design is never unmintable for want of
    # variants.
    models_pool: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    backdrops_pool: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    symbols_pool: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class GiftCollectible(Base):
    __tablename__ = "gift_collectibles"

    gift_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("gifts.id", ondelete="CASCADE"), primary_key=True
    )
    model: Mapped[str] = mapped_column(String(80))
    backdrop: Mapped[str] = mapped_column(String(80))
    symbol: Mapped[str] = mapped_column(String(80))
    traits: Mapped[dict[str, str | int | float]] = mapped_column(JSON, default=dict)
    value_stars: Mapped[int] = mapped_column(Integer, default=0)
    provenance_hash: Mapped[str] = mapped_column(String(64), unique=True)
    creator_username: Mapped[str] = mapped_column(String(32), default="gram")
    minted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class GiftShowcase(Base):
    __tablename__ = "gift_showcases"
    __table_args__ = (
        UniqueConstraint("user_id", "slot", name="uq_gift_showcase_slot"),
        UniqueConstraint("user_id", "gift_id", name="uq_gift_showcase_gift"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    gift_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("gifts.id", ondelete="CASCADE"))
    slot: Mapped[str] = mapped_column(String(20))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class GiftTransfer(Base):
    __tablename__ = "gift_transfers"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    gift_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("gifts.id", ondelete="CASCADE"), index=True
    )
    from_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    to_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    note: Mapped[str | None] = mapped_column(String(200), nullable=True)
    transferred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class GiftOffer(Base):
    __tablename__ = "gift_offers"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    gift_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("gifts.id", ondelete="CASCADE"), index=True
    )
    buyer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    seller_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    amount_stars: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    kind: Mapped[NotificationKind] = mapped_column(
        Enum(NotificationKind, native_enum=False, length=20)
    )
    text: Mapped[str] = mapped_column(String(240))
    entity_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, index=True
    )


class AdminAction(Base):
    """
    Every staff decision, append-only.

    Moderation without a trail is indistinguishable from abuse, so each action records who did
    it, to what, and why — including the ones that only granted something.
    """

    __tablename__ = "admin_actions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    action: Mapped[str] = mapped_column(String(40), index=True)
    target_type: Mapped[str] = mapped_column(String(16))
    target_id: Mapped[str] = mapped_column(String(64))
    target_label: Mapped[str | None] = mapped_column(String(120), nullable=True)
    reason: Mapped[str | None] = mapped_column(String(240), nullable=True)
    details: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, index=True
    )


# ─── End-to-end encryption key directory ─────────────────────────────────────────────────────
#
# The server is a blind key directory and ciphertext relay for E2EE (secret) chats. Every column
# below holds a PUBLIC key or opaque ciphertext. No private key and no plaintext ever reaches
# these tables — that is the whole point: a database dump reveals who has a device and their
# public keys, never anything readable. Compare to `Message.content`, which stays plaintext for
# ordinary chats where server search, moderation and the bot must keep working.


class DeviceIdentity(Base):
    """One end-to-end encryption device belonging to a user.

    A user may have several (one per browser/device). The identity DH key and the Ed25519 signing
    key are long-lived public halves; the private halves live only on the device. `signed_prekey`
    is rotated periodically and signed by the signing key so a fetcher can trust it.
    """

    __tablename__ = "e2ee_devices"
    __table_args__ = (
        UniqueConstraint("user_id", "device_public_id", name="uq_e2ee_device"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    # A client-chosen stable id for this device, so re-publishing updates rather than duplicates.
    device_public_id: Mapped[str] = mapped_column(String(64))
    # Base64 X25519 identity public key used in the X3DH DH combinations.
    identity_dh_public: Mapped[str] = mapped_column(String(64))
    # Base64 Ed25519 public key that signs this device's prekey bundle.
    identity_signing_public: Mapped[str] = mapped_column(String(64))
    signed_prekey_id: Mapped[int] = mapped_column(Integer)
    signed_prekey_public: Mapped[str] = mapped_column(String(64))
    signed_prekey_signature: Mapped[str] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class OneTimePreKey(Base):
    """A single-use X25519 prekey (public half only), consumed atomically by one initiator.

    The pool lets someone start a secret chat with an offline device while retaining strong
    forward secrecy. `claimed_by` / `claimed_at` mark consumption; the row is kept (not deleted)
    so a replay of the same first message is detectably re-using a spent key rather than silently
    succeeding.
    """

    __tablename__ = "e2ee_one_time_prekeys"
    __table_args__ = (
        UniqueConstraint("device_id", "prekey_id", name="uq_e2ee_otk"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    device_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("e2ee_devices.id", ondelete="CASCADE"), index=True
    )
    prekey_id: Mapped[int] = mapped_column(Integer)
    prekey_public: Mapped[str] = mapped_column(String(64))
    claimed_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
