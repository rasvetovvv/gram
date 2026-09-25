"""Moderation and staff-tool contracts, kept apart from the public API surface."""

from __future__ import annotations

import re
import uuid
from datetime import datetime
from typing import Annotated, Any, Literal, Self
from urllib.parse import urlsplit

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas import ApiModel, StarPayoutOut, UserCompact, UsernameInput

ReportTarget = Literal["user", "post", "comment", "message", "community"]
ReportReason = Literal["spam", "abuse", "fraud", "sensitive", "impersonation", "other"]
VerificationTier = Literal["official", "creator", "signal", "founder"]

REASON_LABELS: dict[str, str] = {
    "spam": "Спам",
    "abuse": "Оскорбления",
    "adult": "18+ без пометки",
    "violence": "Насилие",
    "fraud": "Мошенничество",
    "sensitive": "Недопустимый контент",
    "impersonation": "Выдаёт себя за другого",
    "other": "Другое",
}

# What the tick stands for, read out in the popover behind it. A mark that cannot say what was
# checked is decoration; these are the four things staff can actually confirm.
VERIFICATION_LABELS: dict[str, str] = {
    "official": "официальный аккаунт",
    "creator": "автор",
    "signal": "личность подтверждена",
    "founder": "основатель",
}


class ReportCreate(BaseModel):
    target_type: ReportTarget
    target_id: Annotated[str, Field(min_length=1, max_length=64)]
    reason: ReportReason = "other"
    text: Annotated[str | None, Field(max_length=500)] = None


class ReportOut(ApiModel):
    id: uuid.UUID
    reporter: UserCompact | None
    target_type: str
    target_id: str
    # Whose content it was, so a moderator can act on the account and not only on the item.
    subject: UserCompact | None = None
    reason: str
    reason_label: str
    text: str | None = None
    excerpt: str | None = None
    status: str
    resolution: str | None = None
    resolved_by: UserCompact | None = None
    resolved_at: datetime | None = None
    created_at: datetime
    # How many complaints the same target already has, which is what turns one report into a
    # pattern worth acting on.
    target_reports: int = 1


class ReportResolve(BaseModel):
    """
    What the moderator decided.

    `hide` and `ban` act on the reported thing as well as closing the report, so one decision
    is one request — a moderator should not have to remember to also press the other button.
    """

    action: Literal["dismiss", "note", "hide", "ban"] = "note"
    resolution: Annotated[str | None, Field(max_length=240)] = None


LegalReportKind = Literal[
    "copyright",
    "trademark",
    "privacy",
    "illegal_content",
    "impersonation",
    "abuse",
    "fraud_spam",
    "account_access",
    "technical",
    "other",
]
LegalReporterRole = Literal[
    "rights_holder",
    "authorized_agent",
    "content_subject",
    "platform_user",
    "other",
]
MIN_REPORTER_NAME_LENGTH = 2


class LegalReportCreate(BaseModel):
    """A privacy-minimised public notice for legal, safety, or support review."""

    kind: LegalReportKind
    reporter_role: LegalReporterRole
    reporter_name: Annotated[str, Field(min_length=2, max_length=100)]
    reporter_email: Annotated[str, Field(min_length=5, max_length=254)]
    country: Annotated[str | None, Field(max_length=80)] = None
    account_username: Annotated[str | None, Field(max_length=32)] = None
    content_urls: Annotated[list[Annotated[str, Field(max_length=500)]], Field(max_length=10)] = (
        Field(default_factory=list)
    )
    original_work: Annotated[str | None, Field(max_length=3000)] = None
    details: Annotated[str, Field(min_length=30, max_length=5000)]
    requested_action: Annotated[str | None, Field(max_length=1000)] = None
    electronic_signature: Annotated[str | None, Field(max_length=120)] = None
    good_faith: bool = False
    accuracy_confirmed: bool = False
    consent_to_process: bool = False
    # A visually hidden honeypot. A filled value is accepted but not persisted by the endpoint.
    website: Annotated[str | None, Field(max_length=200)] = None

    @field_validator("reporter_email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not re.fullmatch(
            r"[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+",
            normalized,
        ):
            raise ValueError("Укажите корректный email")
        return normalized

    @field_validator("reporter_name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if len(normalized) < MIN_REPORTER_NAME_LENGTH:
            raise ValueError("Укажите имя")
        return normalized

    @field_validator(
        "country",
        "account_username",
        "original_work",
        "requested_action",
        "electronic_signature",
        "website",
    )
    @classmethod
    def blank_is_none(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None

    @field_validator("account_username")
    @classmethod
    def normalize_account_username(cls, value: str | None) -> str | None:
        if not value:
            return None
        normalized = value.removeprefix("@").lower()
        if not re.fullmatch(r"[a-z0-9_]{3,32}", normalized):
            raise ValueError("Проверьте юзернейм GRAM")
        return normalized

    @field_validator("content_urls")
    @classmethod
    def validate_content_urls(cls, values: list[str]) -> list[str]:
        normalized: list[str] = []
        for value in values:
            url = value.strip()
            parsed = urlsplit(url)
            if parsed.scheme != "https" or not parsed.netloc:
                raise ValueError("Каждая ссылка должна начинаться с https://")
            if (parsed.hostname or "").lower() not in {"vexory.xyz", "www.vexory.xyz"}:
                raise ValueError("Укажите прямую ссылку на материал в GRAM")
            if url not in normalized:
                normalized.append(url)
        return normalized

    @model_validator(mode="after")
    def validate_declarations(self) -> Self:
        if not self.accuracy_confirmed or not self.consent_to_process:
            raise ValueError("Подтвердите точность сведений и обработку данных")
        content_kinds = {
            "copyright",
            "trademark",
            "privacy",
            "illegal_content",
            "impersonation",
            "abuse",
            "fraud_spam",
        }
        if self.kind in content_kinds and not self.content_urls:
            raise ValueError("Добавьте хотя бы одну ссылку на материал или профиль")
        if self.kind in {"copyright", "trademark"}:
            if not self.original_work:
                raise ValueError("Опишите оригинальную работу или объект права")
            if not self.good_faith:
                raise ValueError("Подтвердите добросовестность обращения")
            if not self.electronic_signature:
                raise ValueError("Добавьте электронную подпись")
        return self


class LegalReportReceipt(BaseModel):
    reference_code: str
    status: Literal["received"] = "received"


class LegalReportOut(ApiModel):
    id: uuid.UUID
    reference_code: str
    kind: str
    reporter_role: str
    reporter_name: str
    reporter_email: str
    country: str | None = None
    account_username: str | None = None
    content_urls: list[str]
    original_work: str | None = None
    details: str
    requested_action: str | None = None
    electronic_signature: str | None = None
    status: str
    resolution: str | None = None
    resolved_by: UserCompact | None = None
    resolved_at: datetime | None = None
    created_at: datetime


class LegalReportResolve(BaseModel):
    action: Literal["resolve", "dismiss"] = "resolve"
    resolution: Annotated[str, Field(min_length=3, max_length=500)]


class AdminUserOut(ApiModel):
    id: uuid.UUID
    username: str
    display_name: str
    avatar_url: str | None = None
    bio: str = ""
    location: str | None = None
    role_title: str | None = None
    profile_color: str = "default"
    is_verified: bool = False
    verification_tier: str | None = None
    is_admin: bool = False
    is_premium: bool = False
    is_banned: bool = False
    banned_at: datetime | None = None
    ban_reason: str | None = None
    banned_by: UserCompact | None = None
    joined_at: datetime
    followers_count: int = 0
    # The numbers a moderator decides on: what they hold, what they wrote, what came in.
    stars_balance: int = 0
    gifts_count: int = 0
    posts_count: int = 0
    usernames_count: int = 0
    reports_count: int = 0
    open_reports_count: int = 0


class AdminUserUpdate(BaseModel):
    """Everything staff may rewrite on an account, all optional and all audited."""

    display_name: Annotated[str | None, Field(min_length=1, max_length=80)] = None
    bio: Annotated[str | None, Field(max_length=280)] = None
    location: Annotated[str | None, Field(max_length=80)] = None
    role_title: Annotated[str | None, Field(max_length=100)] = None
    profile_color: Annotated[str | None, Field(max_length=24, pattern=r"^[a-z_]+$")] = None
    avatar_url: Annotated[str | None, Field(max_length=500)] = None
    cover_url: Annotated[str | None, Field(max_length=500)] = None
    is_verified: bool | None = None
    verification_tier: VerificationTier | None = None
    is_admin: bool | None = None
    reason: Annotated[str | None, Field(max_length=240)] = None


class AdminBanRequest(BaseModel):
    reason: Annotated[str, Field(min_length=3, max_length=240)]


class AdminStarsGrant(BaseModel):
    """A negative amount takes stars back, which is the same decision in the other direction."""

    amount: Annotated[int, Field(ge=-1_000_000, le=1_000_000)]
    reason: Annotated[str | None, Field(max_length=240)] = None


class AdminGiftGrant(BaseModel):
    slug: Annotated[str, Field(min_length=1, max_length=80)]
    # Staff can hand over a finished collectible instead of a plain gift, which is what a
    # compensation or a prize usually means.
    upgraded: bool = False
    # Which variant to hand over. Left empty the roll is random, as a player's would be; named,
    # it is exactly what staff chose — the difference between a prize and a lottery ticket.
    model: Annotated[str | None, Field(max_length=80)] = None
    backdrop: Annotated[str | None, Field(max_length=80)] = None
    symbol: Annotated[str | None, Field(max_length=80)] = None
    reason: Annotated[str | None, Field(max_length=240)] = None


class AdminGiftUpdate(BaseModel):
    """Rewrite what a minted collectible shows, or take its upgrade away entirely."""

    model: Annotated[str | None, Field(max_length=80)] = None
    backdrop: Annotated[str | None, Field(max_length=80)] = None
    symbol: Annotated[str | None, Field(max_length=80)] = None
    upgraded: bool | None = None
    reason: Annotated[str | None, Field(max_length=240)] = None


class AdminGiftTransfer(BaseModel):
    username: UsernameInput
    reason: Annotated[str | None, Field(max_length=240)] = None


class AdminDesignUpdate(BaseModel):
    """
    The storefront side of a design: how many exist, what it costs, whether it is on sale.

    `edition_size` is the supply ceiling, so lowering it below what has already been minted is
    refused rather than silently making the count negative.
    """

    edition_size: Annotated[int | None, Field(ge=1, le=10_000_000)] = None
    price_stars: Annotated[int | None, Field(ge=1, le=10_000_000)] = None
    available: bool | None = None
    on_market: bool | None = None
    limited: bool | None = None
    reason: Annotated[str | None, Field(max_length=240)] = None


class AdminDesignOut(ApiModel):
    slug: str
    name: str
    price_stars: int
    edition_size: int
    minted: int
    remaining: int
    limited: bool
    available: bool
    on_market: bool
    models_count: int = 0
    backdrops_count: int = 0
    symbols_count: int = 0


class AdminGiftItem(ApiModel):
    """One minted collectible as the panel lists it: enough to decide, not the whole card."""

    id: uuid.UUID
    slug: str
    name: str
    serial_number: int
    rarity: str
    upgraded: bool = False
    model_name: str = ""
    accent: str = "#1f1f26"
    design_slug: str | None = None
    is_listed: bool = False
    sale_price_stars: int | None = None
    transfers_count: int = 0
    received_at: datetime


class AdminUsernameItem(ApiModel):
    username: str
    status: str
    is_primary: bool = False
    price: float | None = None
    history_count: int = 0


class AdminPostItem(ApiModel):
    id: uuid.UUID
    content: str
    created_at: datetime
    hidden_at: datetime | None = None
    hidden_reason: str | None = None
    community_slug: str | None = None
    likes_count: int = 0
    comments_count: int = 0
    reports_count: int = 0


class AdminInventoryOut(BaseModel):
    """Everything staff can act on for one account, in one request."""

    gifts: list[AdminGiftItem]
    usernames: list[AdminUsernameItem]
    posts: list[AdminPostItem]


class AdminUsernameGrant(BaseModel):
    username: UsernameInput
    reason: Annotated[str | None, Field(max_length=240)] = None


class AdminHideRequest(BaseModel):
    reason: Annotated[str, Field(min_length=3, max_length=240)]


class AdminCommunityUpdate(BaseModel):
    title: Annotated[str | None, Field(min_length=1, max_length=100)] = None
    description: Annotated[str | None, Field(max_length=500)] = None
    category: Annotated[str | None, Field(max_length=60)] = None
    location: Annotated[str | None, Field(max_length=80)] = None
    reason: Annotated[str | None, Field(max_length=240)] = None


class AdminOwnerTransfer(BaseModel):
    """Hand a community to somebody else instead of closing it."""

    username: UsernameInput
    reason: Annotated[str | None, Field(max_length=240)] = None


class AdminAccountDelete(BaseModel):
    """
    Irreversible removal.

    The reason is mandatory and the handle has to be typed again: deleting an account is the one
    staff action with nothing left to review afterwards, so it should be hard to do by accident.
    """

    confirm_username: Annotated[str, Field(min_length=1, max_length=32)]
    reason: Annotated[str, Field(min_length=3, max_length=240)]
    # Communities the account owns block the delete unless staff say what to do with them.
    communities: Literal["transfer", "delete"] = "transfer"


class AdminActionOut(ApiModel):
    id: uuid.UUID
    actor: UserCompact | None
    action: str
    target_type: str
    target_id: str
    target_label: str | None = None
    reason: str | None = None
    # Whatever the action recorded beyond its reason — an amount, a status, a note. The panel
    # shows it verbatim, because a log that summarises is a log that can be wrong.
    details: dict[str, Any] | None = None
    created_at: datetime


class AdminCommunityOut(ApiModel):
    id: uuid.UUID
    slug: str
    title: str
    description: str = ""
    category: str | None = None
    location: str | None = None
    owner: UserCompact | None = None
    members_count: int = 0
    posts_count: int = 0
    reports_count: int = 0
    created_at: datetime


class AdminOverviewOut(BaseModel):
    """The counters that answer "is anything waiting for me" in one request."""

    users: int
    banned_users: int
    admins: int
    verified_users: int
    open_reports: int
    open_legal_reports: int = 0
    resolved_reports: int
    hidden_posts: int
    hidden_comments: int
    communities: int
    gifts: int
    stars_in_circulation: int
    actions_today: int
    # The money side. Two of these are queues somebody has to answer, and the panel says so on
    # its first screen rather than behind a tab.
    pending_payouts: int = 0
    pending_payout_stars: int = 0
    pending_refunds: int = 0
    paid_orders: int = 0
    # Ever charged in Telegram, what came back, and what went out as a payout. The three together
    # are the only honest way to say how much money the site is holding.
    xtr_collected: int = 0
    xtr_refunded: int = 0
    xtr_paid_out: int = 0


class AdminDecision(BaseModel):
    """Approve or refuse, with a note the person on the other side will read."""

    approved: bool
    note: Annotated[str, Field(max_length=240)] = ""


class AdminNote(BaseModel):
    """A note on an action that is not a yes-or-no — marking a payout sent, or failed."""

    note: Annotated[str, Field(max_length=240)] = ""


class AdminPayoutOut(StarPayoutOut):
    """A payout with what a moderator decides on: who asked, and what they hold right now."""

    user: UserCompact
    balance: int
    decided_by: UserCompact | None = None
    # Whether the bot can carry this out by itself, by handing back a charge of the same size.
    # When it can, confirming is the whole job and nobody sends anything by hand.
    automatic: bool = False


class AdminCryptoInvoiceOut(ApiModel):
    """One crypto top-up in the finance log, with the provider's own verdict on it."""

    id: uuid.UUID
    user: UserCompact
    package_slug: str
    stars: int
    price_amount: float
    price_currency: str
    pay_currency: str
    asset_label: str
    network_label: str
    pay_amount: float
    actually_paid: float
    status: str
    provider_status: str
    provider_payment_id: str | None = None
    provider_note: str | None = None
    order_id: str
    created_at: datetime
    credited_at: datetime | None = None


class AdminStarOrderOut(ApiModel):
    """One Telegram Stars purchase, as the finance log lists it."""

    id: uuid.UUID
    user: UserCompact
    package_slug: str
    stars: int
    price_xtr: int
    status: str
    telegram_user_id: int | None = None
    telegram_charge_id: str | None = None
    created_at: datetime
    paid_at: datetime | None = None
    refund_status: str | None = None


class AdminRefundOut(ApiModel):
    """A refund request in the panel, decidable here as well as in the bot."""

    id: uuid.UUID
    purchase_id: uuid.UUID
    user: UserCompact
    stars: int
    price_xtr: int
    balance: int
    reason: str
    status: str
    admin_note: str | None = None
    telegram_charge_id: str | None = None
    telegram_user_id: int | None = None
    # Whether an approval right now would actually go through — the window and the balance are
    # checked again at the moment of the decision, so the panel says it beforehand.
    blocked_reason: str | None = None
    requested_at: datetime
    decided_at: datetime | None = None
    telegram_done_at: datetime | None = None


class AdminLedgerOut(ApiModel):
    """One line of anybody's wallet history. The site-wide version of `/api/stars/ledger`."""

    id: uuid.UUID
    user: UserCompact
    counterparty: UserCompact | None = None
    amount: int
    balance_after: int
    kind: str
    description: str
    entity_type: str | None = None
    entity_id: str | None = None
    created_at: datetime


class AdminBroadcast(BaseModel):
    """
    One notification to many people at once.

    Scoped rather than always-everybody: an announcement about Premium is noise for accounts that
    do not have it, and a note to the other admins is not an announcement at all.
    """

    text: Annotated[str, Field(min_length=3, max_length=240)]
    scope: Literal["all", "premium", "admins", "active"] = "all"

