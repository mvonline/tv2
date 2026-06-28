"""Admin endpoint for manual single-URL channel scraping and channel addition."""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Annotated
from urllib.parse import unquote, urlparse

import requests
from fastapi import APIRouter, Depends, HTTPException, Query
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


class ChannelUpdateRequest(BaseModel):
    page_url: str | None = None
    name: str | None = None
    stream_url: str | None = None
    stream_type: str | None = None
    stream_host: str | None = None
    requires_proxy: bool | None = None
    ai_category: str | None = None
    slug: str | None = None
    logo: str | None = None
    media_type: str | None = None


def _load_channels_payload() -> dict:
    path = _channels_path()
    if not path.exists():
        raise HTTPException(500, "channels.json not found")
    with open(path) as f:
        return json.load(f)


def _write_channels_payload(data: dict) -> None:
    path = _channels_path()
    data["count"] = len(data.get("channels", []))
    with open(path, "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _slug_candidates(slug: str) -> list[str]:
    key = slug.strip()
    decoded = unquote(key)
    candidates = [key, decoded]
    for value in (key, decoded):
        candidates.append(value.replace("https:/", "https://", 1))
        candidates.append(value.replace("http:/", "http://", 1))
    result: list[str] = []
    for value in candidates:
        if value and value not in result:
            result.append(value)
    return result


def _find_channel(channels: list[dict], slug: str) -> tuple[int, dict] | tuple[None, None]:
    keys = set(_slug_candidates(slug))
    for i, ch in enumerate(channels):
        if ch.get("slug") in keys:
            return i, ch
    return None, None


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
    data = _load_channels_payload()

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
    _write_channels_payload(data)

    return {"ok": True, "slug": slug, "channel": new_channel}


@router.get("/admin/channels/full")
def admin_list_channels_full(
    _: None = Depends(require_admin),
    q: str = Query(default=""),
) -> list[dict]:
    """List raw channels from channels.json for admin CRUD."""
    data = _load_channels_payload()
    channels: list[dict] = data.get("channels", [])
    query = q.strip().lower()
    if query:
        channels = [
            c for c in channels
            if query in (c.get("slug") or "").lower()
            or query in (c.get("name") or "").lower()
            or query in (c.get("stream_host") or "").lower()
            or query in (c.get("ai_category") or "").lower()
        ]
    return sorted(channels, key=lambda c: ((c.get("name") or c.get("slug") or "").lower()))


@router.patch("/admin/channels/{slug:path}")
def admin_update_channel(
    slug: str,
    body: ChannelUpdateRequest,
    _: None = Depends(require_admin),
) -> dict:
    """Update a channel inside channels.json."""
    data = _load_channels_payload()
    channels: list[dict] = data.get("channels", [])
    idx, ch = _find_channel(channels, slug)
    if ch is None or idx is None:
        raise HTTPException(404, "Channel not found")

    new_slug = (body.slug if body.slug is not None else ch.get("slug") or slug).strip()
    if not new_slug:
        raise HTTPException(400, "slug required")
    if new_slug != slug and any(c.get("slug") == new_slug for c in channels):
        raise HTTPException(409, "slug already exists")

    updates = body.model_dump(exclude_unset=True)
    for key, value in updates.items():
        if key == "logo":
            ch["logo"] = (value or "").strip() or None
        elif key == "requires_proxy":
            ch["requires_proxy"] = bool(value)
        elif key == "stream_host":
            ch["stream_host"] = (value or "").strip() or None
        elif key == "stream_url":
            stream_url = (value or "").strip() or None
            ch["stream_url"] = stream_url
            if body.stream_host is None:
                ch["stream_host"] = urlparse(stream_url).netloc if stream_url else None
            if body.requires_proxy is None:
                ch["requires_proxy"] = stream_requires_proxy(stream_url)
        elif key in {"name", "stream_type", "ai_category", "slug", "media_type", "page_url"}:
            ch[key] = (value or "").strip() if isinstance(value, str) else value

    channels[idx] = ch
    data["channels"] = channels
    _write_channels_payload(data)
    return {"ok": True, "slug": ch.get("slug"), "channel": ch}


@router.delete("/admin/channels/{slug:path}")
def admin_delete_channel(
    slug: str,
    _: None = Depends(require_admin),
) -> dict:
    """Delete a channel from channels.json."""
    data = _load_channels_payload()
    channels: list[dict] = data.get("channels", [])
    idx, ch = _find_channel(channels, slug)
    if ch is None or idx is None:
        raise HTTPException(404, "Channel not found")
    del channels[idx]
    data["channels"] = channels
    _write_channels_payload(data)
    return {"ok": True, "slug": slug}
