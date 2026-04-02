"""Parse channel HTML for stream URL, mode (direct vs iframe/proxy), logo, title."""

from __future__ import annotations

import json
import re
from html import unescape
from typing import Any
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

from config import BASE_URL, stream_requires_proxy


def _abs_url(href: str | None) -> str | None:
    if not href or href.startswith("#"):
        return None
    return urljoin(BASE_URL + "/", href.lstrip("/"))


def _iter_ld_json_objects(soup: BeautifulSoup):
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(script.string or "")
        except json.JSONDecodeError:
            continue
        if isinstance(data, list):
            for block in data:
                yield block
        else:
            yield data


def extract_channel_page(html: str, page_url: str) -> dict[str, Any]:
    soup = BeautifulSoup(html, "lxml")
    out: dict[str, Any] = {
        "page_url": page_url,
        "name": None,
        "stream_url": None,
        "stream_type": None,
        "stream_host": None,
        "requires_proxy": False,
        "logo_url": None,
        "raw_iframe_src": None,
    }

    # Prefer Joomla Article JSON-LD for title + channel artwork (not sidebar promos)
    for block in _iter_ld_json_objects(soup):
        if not isinstance(block, dict) or block.get("@type") != "Article":
            continue
        if block.get("name"):
            out["name"] = block["name"]
        thumb = block.get("thumbnailUrl") or block.get("image")
        if isinstance(thumb, list) and thumb:
            thumb = thumb[0]
        if isinstance(thumb, dict) and thumb.get("url"):
            thumb = thumb["url"]
        if isinstance(thumb, str) and thumb:
            out["logo_url"] = _abs_url(thumb)
        break

    if not out["name"]:
        og = soup.find("meta", property="og:title")
        if og and og.get("content"):
            out["name"] = unescape(og["content"].strip())
    og_img = soup.find("meta", property="og:image")
    if og_img and og_img.get("content") and not out["logo_url"]:
        out["logo_url"] = _abs_url(og_img["content"].strip())

    if not out["name"] and soup.title and soup.title.string:
        out["name"] = soup.title.string.split("-")[0].strip()

    # Fallback: first channel logo in main column only
    if not out["logo_url"]:
        main = soup.find(id="tm-main") or soup.body
        if main:
            for img in main.find_all("img", src=True):
                src = img["src"]
                if "/images/chanells-logo/" in src or "/images/channels-logo/" in src:
                    out["logo_url"] = _abs_url(src)
                    break

    # Direct HLS / progressive: <video crossorigin playsinline><source src="...">
    # gg.* hosts often forbid cross-origin segment fetch (CORS / Referer); mark for backend proxy.
    video = soup.find("video")
    if video:
        src_el = video.find("source", src=True)
        if src_el:
            raw = src_el["src"].strip()
            out["stream_url"] = raw
            t = (src_el.get("type") or "").lower()
            if "mpegurl" in t or raw.lower().endswith(".m3u8"):
                out["stream_type"] = "hls"
            else:
                out["stream_type"] = "direct"
        elif video.get("src"):
            out["stream_url"] = video["src"].strip()
            out["stream_type"] = "direct"

    # HTML5 audio (MP3 / AAC / HLS in <audio>, common on radio pages)
    if not out["stream_url"]:
        audio = soup.find("audio")
        if audio:
            src_el = audio.find("source", src=True)
            if src_el:
                raw = src_el["src"].strip()
                out["stream_url"] = raw
                t = (src_el.get("type") or "").lower()
                lu = raw.lower()
                if "mpegurl" in t or lu.endswith(".m3u8"):
                    out["stream_type"] = "hls"
                elif "mpeg" in t or lu.endswith(".mp3") or "/mp3" in lu:
                    out["stream_type"] = "mp3"
                elif "aac" in t or lu.endswith(".aac"):
                    out["stream_type"] = "aac"
                else:
                    out["stream_type"] = "direct"
            elif audio.get("src"):
                raw = audio["src"].strip()
                out["stream_url"] = raw
                lu = raw.lower()
                out["stream_type"] = (
                    "hls"
                    if lu.endswith(".m3u8")
                    else ("mp3" if ".mp3" in lu else "direct")
                )

    # Embedded player (proxy / third-party)
    if not out["stream_url"]:
        iframe = soup.find("iframe", src=True)
        if iframe:
            raw = iframe["src"].strip()
            out["raw_iframe_src"] = raw
            out["stream_url"] = raw
            out["stream_type"] = "iframe"

    # Regex fallback for m3u8 in inline scripts (if markup changes)
    if not out["stream_url"]:
        m = re.search(
            r'https?://[^\s"\'<>]+\.m3u8[^\s"\'<>]*',
            html,
            re.IGNORECASE,
        )
        if m:
            out["stream_url"] = m.group(0)
            out["stream_type"] = "hls"

    # MP3 / AAC / playlist URLs in inline scripts or text (radio embeds)
    if not out["stream_url"]:
        m = re.search(
            r'https?://[^\s"\'<>]+\.(?:mp3|aac|pls|m3u)(?:\?[^\s"\'<>]*)?',
            html,
            re.IGNORECASE,
        )
        if m:
            raw = m.group(0)
            out["stream_url"] = raw
            lu = raw.lower()
            if lu.endswith(".m3u8"):
                out["stream_type"] = "hls"
            elif lu.endswith(".mp3") or "/mp3" in lu:
                out["stream_type"] = "mp3"
            elif lu.endswith(".aac"):
                out["stream_type"] = "aac"
            else:
                out["stream_type"] = "direct"

    su = out.get("stream_url")
    if su:
        out["stream_host"] = urlparse(su).netloc or None
        out["requires_proxy"] = stream_requires_proxy(su)

    return out
