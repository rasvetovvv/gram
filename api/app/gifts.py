"""The storefront layer over the real Telegram gift catalogue.

`giftart` owns the imported facts — which gifts exist, their models, backdrops and symbols, and
Telegram's own drop rates. This module owns what is ours: the slug, the shelf a design is filed
under, its Stars price and its edition size. Those four are deliberately not taken from the
source, because Stars here are a simulated local economy and Telegram publishes no price or
supply through this API.

Ordering is the one real signal available for tiering: `/gifts` returns designs roughly in
release order, oldest first, and the earliest releases are the prestigious ones. So position in
that list drives price, edition size and rarity rather than a hash nobody can reason about.

Gift names, drop rates and palettes come from api.changes.tg —
thanks to @GiftChanges for this API.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app import giftart
from app.models import GiftRarity

CATEGORIES: tuple[tuple[str, str], ...] = (
    ("classic", "Классика"),
    ("holiday", "Праздники"),
    ("party", "Вечеринка"),
    ("mystic", "Мистика"),
    ("luxury", "Роскошь"),
    ("retro", "Ретро"),
    ("nature", "Природа"),
    ("tech", "Техно"),
)
CATEGORY_LABELS: dict[str, str] = dict(CATEGORIES)

# Shelves are assigned from the name because the source has no notion of a category. First
# match wins, so the more specific words are listed first inside each shelf.
CATEGORY_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("holiday", ("santa", "xmas", "winter", "snow", "jingle", "sleigh", "candy cane",
                 "stocking", "wreath", "holiday", "easter", "big year", "spring")),
    ("mystic", ("potion", "witch", "voodoo", "hex", "skull", "evil", "amulet", "crystal",
                "genie", "spell", "astral", "restless", "faith", "moon", "snake", "jack-in")),
    ("luxury", ("ring", "watch", "diamond", "gem", "signet", "top hat", "perfume", "cigar",
                "oscar", "medal", "cup", "bracelet", "locket", "pendant", "papakha",
                "stilettos", "brick", "money", "swag", "bling")),
    ("party", ("cake", "candle", "lollipop", "pop", "sparkler", "muffin", "cookie", "brownie",
               "cream", "wine", "drink", "cupcake", "bundle", "loot", "berry", "ramen",
               "mousse", "jar", "bunny", "chimp")),
    ("nature", ("rose", "flower", "peach", "frog", "agaric", "bird", "basket", "posy",
                "bouquet", "clover", "sakura", "cat", "pepe", "float", "flame", "socks")),
    ("tech", ("rocket", "sword", "helmet", "gadget", "algorithm", "intelligence", "dryer",
              "board", "key", "arm", "shard", "strike", "glasses")),
    ("retro", ("record", "book", "pen", "notepad", "calendar", "binky", "tongue", "hat",
               "bow tie", "figure", "lider", "low rider", "westside", "sign", "dogg",
               "charm", "box", "pack", "pin")),
)

# Release order drives the tier: (share of the catalogue, rarity, price, edition, limited).
TIERS: tuple[tuple[float, GiftRarity, int, int, bool], ...] = (
    (0.10, GiftRarity.LEGENDARY, 300, 200, True),
    (0.25, GiftRarity.LEGENDARY, 180, 500, True),
    (0.50, GiftRarity.EPIC, 90, 1500, False),
    (0.75, GiftRarity.EPIC, 55, 3000, False),
    (1.00, GiftRarity.RARE, 25, 8000, False),
)


@dataclass(frozen=True, slots=True)
class GiftDesign:
    """One purchasable design: imported facts plus the four fields the storefront owns."""

    slug: str
    name: str
    tg_name: str
    tg_gift_id: str
    description: str
    category: str
    rarity: GiftRarity
    price_stars: int
    edition_size: int
    limited: bool
    on_market: bool

    @property
    def upgrade_price_stars(self) -> int:
        """
        What it costs to turn a plain gift into a collectible.

        A quarter of the gift's own price, floored at 25 ★: the upgrade is the cheap, tempting
        step — the roll is the point, not the toll — but it still has to scale with a design
        whose plain version cost thousands.
        """
        return max(25, round(self.price_stars / 4 / 5) * 5)

    @property
    def models(self) -> tuple[giftart.Variant, ...]:
        source = giftart.BY_SLUG.get(self.slug)
        return source.models if source else ()

    @property
    def backdrops(self) -> tuple[giftart.Backdrop, ...]:
        source = giftart.BY_SLUG.get(self.slug)
        return source.backdrops if source else ()

    @property
    def symbols(self) -> tuple[giftart.Variant, ...]:
        source = giftart.BY_SLUG.get(self.slug)
        return source.symbols if source else ()


def categorise(name: str) -> str:
    lowered = name.lower()
    for category, words in CATEGORY_RULES:
        if any(word in lowered for word in words):
            return category
    return "classic"


def _tier(position: int, total: int) -> tuple[GiftRarity, int, int, bool]:
    share = (position + 1) / max(1, total)
    for cutoff, rarity, price, edition, limited in TIERS:
        if share <= cutoff:
            return rarity, price, edition, limited
    return GiftRarity.RARE, 25, 8000, False


def _describe(gift: giftart.TelegramGift) -> str:
    """A factual one-liner: what varies, and how rare the rarest variant is."""
    rarest = min((item.permille for item in gift.models), default=0)
    return (
        f"Коллекционный подарок Telegram. {len(gift.models)} моделей, "
        f"{len(gift.backdrops)} фонов, {len(gift.symbols)} узоров; "
        f"самая редкая модель — {rarest / 10:.1f}%."
    )


def _build() -> tuple[GiftDesign, ...]:
    total = len(giftart.GIFTS)
    designs: list[GiftDesign] = []
    for position, gift in enumerate(giftart.GIFTS):
        rarity, price, edition, limited = _tier(position, total)
        designs.append(
            GiftDesign(
                slug=gift.slug,
                name=gift.name,
                tg_name=gift.name,
                tg_gift_id=gift.gift_id,
                description=_describe(gift),
                category=categorise(gift.name),
                rarity=rarity,
                price_stars=price,
                edition_size=edition,
                limited=limited,
                # Every third design starts on the market so the shelf is not empty on day one.
                on_market=position % 3 == 0,
            )
        )
    return tuple(designs)


DESIGNS: tuple[GiftDesign, ...] = _build()
DESIGN_BY_SLUG: dict[str, GiftDesign] = {design.slug: design for design in DESIGNS}


def slugify(name: str) -> str:
    """Re-exported so callers do not need to reach into `giftart` for it."""
    return giftart.slugify(name)


def legacy_slug(value: str) -> str:
    """Normalise a stored slug for lookup: `vintage-cigar-007` -> `vintage-cigar`."""
    return re.sub(r"-\d+$", "", value)
