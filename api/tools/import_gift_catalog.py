"""Import the real Telegram collectible-gift catalogue into a committed JSON file.

Run manually; the result is checked in so seeding stays deterministic and works with no
network. One request lists the gifts, then one request per gift returns everything about it —
models, backdrops (with resolved hex colours) and symbols, each with its real drop rate.

    python api/tools/import_gift_catalog.py

Artwork itself is not downloaded here: it is fetched and cached at runtime by
`app.giftart`, so this file stays metadata only.

Data and artwork come from api.changes.tg — thanks to @GiftChanges for the API.
"""

from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

API = "https://api.changes.tg"
OUT = Path(__file__).resolve().parents[1] / "app" / "gift_catalog.json"
TIMEOUT = 30
RETRIES = 3
PAUSE = 0.15


def fetch(path: str) -> Any:
    """GET a JSON document, retrying transient failures rather than losing the whole run."""
    url = f"{API}/{urllib.parse.quote(path)}"
    last: Exception | None = None
    for attempt in range(RETRIES):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "gram-catalog-import"})  # noqa: S310
            with urllib.request.urlopen(request, timeout=TIMEOUT) as response:  # noqa: S310
                return json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            last = exc
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"{url}: {last}")


def variant(entry: dict[str, Any]) -> dict[str, Any]:
    """
    Normalise one model/backdrop/symbol entry to a name and a per-mille drop rate.

    `/gift/:gift` reports every pool the same way — `{name, rarity}` as a percentage — so the
    conversion is one place. The dedicated `/models/:gift` endpoint uses `rarityPermille`
    instead; accepting both keeps this working if the shapes are ever swapped.
    """
    permille = entry.get("rarityPermille")
    if permille is None:
        permille = float(entry.get("rarity") or 0) * 10
    return {"name": entry["name"], "permille": round(float(permille), 1)}


def backdrop(entry: dict[str, Any], palette: dict[str, dict[str, str]]) -> dict[str, Any]:
    """A gift's backdrop, coloured from the global palette.

    `/gift/:gift` says which backdrops a gift can roll and how often, but carries no colours;
    the four hex values come from `/backdrops`, where backdrop names are global.
    """
    hexes = palette.get(entry["name"], {})
    return {
        **variant(entry),
        "center": hexes.get("centerColor", "#1c1c26"),
        "edge": hexes.get("edgeColor", "#08080a"),
        "pattern": hexes.get("patternColor", "#ffffff"),
        "text": hexes.get("textColor", "#ffffff"),
    }


def main() -> int:
    palette = {
        item["name"]: item.get("hex") or {} for item in fetch("backdrops")
    }
    print(f"{len(palette)} backdrops in the global palette", flush=True)
    names = fetch("gifts")
    print(f"{len(names)} gifts to import", flush=True)
    gifts: list[dict[str, Any]] = []
    for index, name in enumerate(names, start=1):
        detail = fetch(f"gift/{name}")
        header = detail.get("gift") or {}
        gifts.append(
            {
                "name": header.get("name", name),
                "id": header.get("id", ""),
                "custom_emoji_id": header.get("customEmojiId", ""),
                "models": [variant(item) for item in detail.get("models") or []],
                "backdrops": [
                    backdrop(item, palette) for item in detail.get("backdrops") or []
                ],
                "symbols": [variant(item) for item in detail.get("symbols") or []],
            }
        )
        print(f"  [{index:>3}/{len(names)}] {name}", flush=True)
        time.sleep(PAUSE)

    payload = {
        "source": API,
        "attribution": "thanks to @GiftChanges for this API (api.changes.tg)",
        "gifts": gifts,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    models = sum(len(gift["models"]) for gift in gifts)
    symbols = sum(len(gift["symbols"]) for gift in gifts)
    uncoloured = sum(
        1 for gift in gifts for item in gift["backdrops"] if item["center"] == "#1c1c26"
    )
    size = OUT.stat().st_size / 1_048_576
    print(f"\nwrote {OUT} ({size:.1f} MB)")
    print(f"{len(gifts)} gifts, {models} models, {symbols} symbols")
    print(f"backdrops missing a palette entry: {uncoloured}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
