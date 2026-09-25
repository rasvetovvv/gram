"""
Resolving a music link into the card a post shows.

Only SoundCloud for now, through its public oEmbed endpoint: it needs no key, and it answers
with the title, the uploader and the artwork, which is exactly what the card draws. The lookup
is cached in memory, because a link pasted into ten posts is still one track.
"""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

OEMBED = "https://soundcloud.com/oembed"
HTTP_OK = 200
FETCH_TIMEOUT = 6
# Both the canonical host and the share shortener people actually paste.
LINK_PATTERN = re.compile(
    r"https?://(?:(?:www|m)\.)?(?:soundcloud\.com|on\.soundcloud\.com)/[^\s<>\"']+",
    re.IGNORECASE,
)
# `title` arrives as "Track by Artist"; the artist is also given on its own.
ARTWORK_SIZE = re.compile(r"-t\d+x\d+\.jpg")

_cache: dict[str, dict[str, Any] | None] = {}


def find_link(text: str) -> str | None:
    """The first SoundCloud link in a post's text, if any."""
    match = LINK_PATTERN.search(text or "")
    return match.group(0).rstrip(".,;)") if match else None


def _fetch(url: str) -> dict[str, Any] | None:
    query = urllib.parse.urlencode({"format": "json", "url": url})
    request = urllib.request.Request(  # noqa: S310 - fixed https host, query-encoded input
        f"{OEMBED}?{query}",
        headers={"User-Agent": "gram-music/1.0"},
    )
    try:
        with urllib.request.urlopen(request, timeout=FETCH_TIMEOUT) as response:  # noqa: S310
            if response.status != HTTP_OK:
                return None
            return json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, ValueError, OSError):
        # A dead link must not stop a post from being published.
        return None


def _track_id(html: str) -> str | None:
    """oEmbed returns an iframe whose src carries the track id, which is worth keeping."""
    match = re.search(r"tracks(?:%2F|/)(\d+)", html or "")
    return match.group(1) if match else None


def resolve(url: str) -> dict[str, Any] | None:
    """
    Metadata for one link, or `None` when it cannot be resolved.

    Shape matches `PostMusic`: title, artist, cover_url, provider, external_url, external_id.
    """
    if url in _cache:
        return _cache[url]
    payload = _fetch(url)
    if not payload or not payload.get("title"):
        _cache[url] = None
        return None
    artwork = payload.get("thumbnail_url") or ""
    # The default artwork is 500px; ask for the crisper one the card can use.
    if artwork:
        artwork = ARTWORK_SIZE.sub("-t500x500.jpg", artwork)
    resolved = {
        "title": str(payload["title"])[:200],
        "artist": (str(payload.get("author_name") or "") or None),
        "cover_url": artwork or None,
        "provider": "soundcloud",
        "external_url": url,
        "external_id": _track_id(str(payload.get("html") or "")),
    }
    _cache[url] = resolved
    return resolved
