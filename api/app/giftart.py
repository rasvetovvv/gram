"""The real Telegram collectible-gift catalogue, and a runtime cache for its artwork.

Metadata is read from `gift_catalog.json`, imported by `tools/import_gift_catalog.py` and
committed, so seeding is deterministic and needs no network. Artwork is fetched on first use
and cached under `MEDIA_ROOT/giftart`, so a warm container serves it with no external call —
one of the reference product's own asset URLs went 404 within two days, which is exactly the
failure this cache exists to survive.

`.tgs` is a gzip stream whose inflation is byte-identical to the API's `.json` form, so the
cached bytes are served as `application/json` with `Content-Encoding: gzip`: 20 KB on the wire
instead of 114 KB, and the browser inflates it without a client-side gunzip library.

Gift names, drop rates, palettes and artwork come from api.changes.tg —
thanks to @GiftChanges for this API.
"""

from __future__ import annotations

import asyncio
import json
import re
import secrets
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.config import MEDIA_ROOT

SOURCE_API = "https://api.changes.tg"
ATTRIBUTION = "thanks to @GiftChanges for this API (api.changes.tg)"
CATALOG_PATH = Path(__file__).resolve().parent / "gift_catalog.json"
ART_ROOT = MEDIA_ROOT / "giftart"
ART_KINDS = ("original", "model", "symbol")
ART_SIZES = (64, 128, 256, 512)
FETCH_TIMEOUT = 25


@dataclass(frozen=True, slots=True)
class Variant:
    """One rollable trait: its display name and its real per-mille drop rate."""

    name: str
    permille: float


@dataclass(frozen=True, slots=True)
class Backdrop(Variant):
    center: str
    edge: str
    pattern: str
    text: str


@dataclass(frozen=True, slots=True)
class TelegramGift:
    slug: str
    name: str
    gift_id: str
    models: tuple[Variant, ...]
    backdrops: tuple[Backdrop, ...]
    symbols: tuple[Variant, ...]


def slugify(name: str) -> str:
    """`B-Day Candle` -> `b-day-candle`, `Durov's Cap` -> `durovs-cap`."""
    cleaned = re.sub(r"[^a-z0-9]+", "-", name.lower().replace("'", ""))
    return cleaned.strip("-")


def _entry(entry: dict[str, Any]) -> TelegramGift:
    return TelegramGift(
        slug=slugify(entry["name"]),
        name=entry["name"],
        gift_id=entry.get("id", ""),
        models=tuple(Variant(item["name"], float(item["permille"])) for item in entry["models"]),
        backdrops=tuple(
            Backdrop(
                item["name"],
                float(item["permille"]),
                item["center"],
                item["edge"],
                item["pattern"],
                item["text"],
            )
            for item in entry["backdrops"]
        ),
        symbols=tuple(Variant(item["name"], float(item["permille"])) for item in entry["symbols"]),
    )


def _load() -> tuple[TelegramGift, ...]:
    payload: dict[str, Any] = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    return tuple(_entry(entry) for entry in payload.get("gifts", []))


GIFTS: tuple[TelegramGift, ...] = _load()
BY_SLUG: dict[str, TelegramGift] = {gift.slug: gift for gift in GIFTS}
BY_NAME: dict[str, TelegramGift] = {gift.name.lower(): gift for gift in GIFTS}


def find(reference: str) -> TelegramGift | None:
    """Resolve a gift by slug or by display name, however a caller happens to hold it."""
    key = reference.strip()
    return BY_SLUG.get(key.lower()) or BY_NAME.get(key.lower()) or BY_SLUG.get(slugify(key))


def roll(pool: tuple[Variant, ...] | tuple[Backdrop, ...]) -> Variant | Backdrop | None:
    """
    Draw one trait using its real drop rate.

    Rates are per mille and sum to 1000 across a pool, so this reproduces Telegram's own
    distribution rather than approximating it: a 3‰ model really is rolled three times in a
    thousand. `secrets` avoids ruff's warning about `random` and costs nothing here.
    """
    if not pool:
        return None
    total = sum(item.permille for item in pool) or float(len(pool))
    target = secrets.randbelow(max(1, int(total * 10))) / 10
    for item in pool:
        target -= item.permille or 1.0
        if target < 0:
            return item
    return pool[-1]


def percent(item: Variant | Backdrop | None) -> float:
    """Per mille is the source's unit; collectors are shown a percentage."""
    return round((item.permille if item else 0) / 10, 2)


def _remote_url(kind: str, gift: TelegramGift, variant: str, ext: str, size: int | None) -> str:
    name = urllib.parse.quote(gift.name)
    path = (
        f"{kind}/{name}"
        if kind == "original"
        else f"{kind}/{name}/{urllib.parse.quote(variant)}"
    )
    query = f"?size={size}" if size and ext == "png" else ""
    return f"{SOURCE_API}/{path}.{ext}{query}"


def cache_path(kind: str, gift: TelegramGift, variant: str, ext: str, size: int | None) -> Path:
    stem = "original" if kind == "original" else slugify(variant)
    suffix = f"@{size}" if size and ext == "png" else ""
    return ART_ROOT / kind / gift.slug / f"{stem}{suffix}.{ext}"


def resolve(kind: str, gift_ref: str, variant: str, ext: str) -> tuple[TelegramGift, str] | None:
    """
    Validate a request against the catalogue before it can become a URL or a path.

    Only names present in the imported catalogue are accepted, which is what makes the proxy
    safe: an attacker cannot steer the outbound fetch or the cache path, because neither is
    built from user text — both are built from a matched catalogue entry.
    """
    if kind not in ART_KINDS or ext not in {"tgs", "png"}:
        return None
    gift = find(gift_ref)
    if gift is None:
        return None
    if kind == "original":
        return gift, ""
    pool = gift.models if kind == "model" else gift.symbols
    wanted = slugify(variant)
    match = next((item for item in pool if slugify(item.name) == wanted), None)
    return (gift, match.name) if match else None


def _download(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "gram-gift-art"})  # noqa: S310
    with urllib.request.urlopen(request, timeout=FETCH_TIMEOUT) as response:  # noqa: S310
        return bytes(response.read())


async def ensure(
    kind: str, gift: TelegramGift, variant: str, ext: str, size: int | None = None
) -> Path | None:
    """
    Return the cached asset, downloading it once if this is the first request for it.

    The blocking fetch runs in a worker thread so one cold asset cannot stall the event loop.
    A failed download returns None rather than raising: a missing sticker should degrade to a
    coloured backdrop, not to a broken page.
    """
    target = cache_path(kind, gift, variant, ext, size)
    if target.exists() and target.stat().st_size:
        return target
    url = _remote_url(kind, gift, variant, ext, size)
    try:
        payload = await asyncio.to_thread(_download, url)
    except (urllib.error.URLError, TimeoutError, OSError):
        return None
    if not payload:
        return None
    target.parent.mkdir(parents=True, exist_ok=True)
    # Written beside the target and moved into place, so a reader never sees a partial file.
    staging = target.with_suffix(f"{target.suffix}.part")
    staging.write_bytes(payload)
    staging.replace(target)
    return target


async def prefetch_originals(limit: int | None = None) -> int:
    """
    Warm the cache with each design's own sticker plus a grid-sized still.

    These are the two assets every storefront tile needs, 120 of each and about 3 MB in total,
    so a container that has been online once can render the whole catalogue offline.
    """
    warmed = 0
    for gift in GIFTS[: limit or len(GIFTS)]:
        for ext, size in (("tgs", None), ("png", 128)):
            if await ensure("original", gift, "", ext, size):
                warmed += 1
    return warmed
