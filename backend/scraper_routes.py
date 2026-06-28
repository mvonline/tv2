"""Admin endpoint for manual single-URL channel scraping and channel addition."""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Annotated
from urllib.parse import urlparse

import requests
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from category_routes import require_admin
from config import REQUEST_TIMEOUT_S, USER_AGENT, stream_requires_proxy
from extract_stream import extract_channel_page

router = APIRouter(tags=["admin-scraper"])

_SESSION = requests.Session()
_SESSION.headers.update({"User-Agent": USER_AGENT})


def _channels_path() -> Path:
    env = os.environ.get("CHANNELS_JSON_PATH", "").strip()
    if env:
        return Path(env)
    return Path(__file__).resolve().parent / "data" / "channels.json"


class ScrapeRequest(BaseModel):
    url: str


class AddChannelRequest(BaseModel):
    page_url: str
    name: str | None = None
    stream_url: str | None = None
    stream_type: str | None = None
    stream_host: str | None = None
    requires_proxy: bool = False
    ai_category: str = "other"
    slug: str | None = None
    logo_url: str | None = None


@router.post("/admin/scrape")
def admin_scrape_url(
    body: ScrapeRequest,
    _: None = Depends(require_admin),
) -> dict:
    """Fetch a page URL and extract stream metadata."""
    url = body.url.strip()
    if not url:
        raise HTTPException(400, "url required")
    try:
        r = _SESSION.get(url, timeout=REQUEST_TIMEOUT_S, allow_redirects=True)
        r.raise_for_status()
        r.encoding = r.apparent_encoding
        html = r.text
    except requests.RequestException as e:
        raise HTTPException(502, f"Failed to fetch URL: {e}")

    result = extract_channel_page(html, url)

    # Derive slug from URL path
    path = urlparse(url).path.rstrip("/")
    result["slug"] = path.split("/")[-1] if path else "channel"

    # Auto-detect proxy requirement
    if result.get("stream_url"):
        result["requires_proxy"] = stream_requires_proxy(result["stream_url"])

    return result


@router.post("/admin/channels/add")
def admin_add_channel(
    body: AddChannelRequest,
    _: None = Depends(require_admin),
) -> dict:
    """Append a manually scraped or entered channel to channels.json."""
    path = _channels_path()
    if not path.exists():
        raise HTTPException(500, "channels.json not found")

    with open(path) as f:
        data = json.load(f)

    channels: list[dict] = data.get("channels", [])

    slug = (body.slug or "").strip()
    if not slug:
        p = urlparse(body.page_url).path.rstrip("/")
        slug = p.split("/")[-1] if p else "channel"

    # Ensure uniqueness
    existing = {c.get("slug") for c in channels}
    if slug in existing:
        slug = f"{slug}-{int(time.time()) % 100000}"

    stream_host = (body.stream_host or "").strip() or None
    if not stream_host and body.stream_url:
        stream_host = urlparse(body.stream_url).netloc or None

    requires_proxy = body.requires_proxy or stream_requires_proxy(body.stream_url)

    new_channel: dict = {
        "page_url": body.page_url,
        "name": (body.name or slug).strip(),
        "stream_url": body.stream_url,
        "stream_type": body.stream_type,
        "stream_host": stream_host,
        "requires_proxy": requires_proxy,
        "raw_iframe_src": None,
        "logo": None,
        "category_path": "/manual",
        "slug": slug,
        "media_type": "tv",
        "ai_category": body.ai_category or "other",
        "ai_labeled_at": None,
    }

    channels.append(new_channel)
    data["channels"] = channels
    data["count"] = len(channels)

    with open(path, "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    return {"ok": True, "slug": slug, "channel": new_channel}
