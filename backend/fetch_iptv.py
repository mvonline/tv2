"""
Fetch the iptv-org public M3U playlist and merge new channels into channels.json.

- Aparatchi channels already in the file are never touched.
- Channels are deduplicated by stream_url.
- Logos are stored as the remote URL from tvg-logo (not downloaded locally).
- Each channel gets source="iptv-org" so it can be identified later.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import unicodedata
from pathlib import Path
from urllib.parse import urlparse

import requests

from config import REQUEST_TIMEOUT_S, USER_AGENT

IPTV_ORG_M3U_URL = "https://iptv-org.github.io/iptv/index.m3u"
SOURCE_LABEL = "iptv-org"
PAGE_URL_BASE = "https://iptv-org.github.io/iptv"

SESSION = requests.Session()
SESSION.headers.update({"User-Agent": USER_AGENT})


def _default_channels_path() -> Path:
    env = os.environ.get("CHANNELS_JSON_PATH", "").strip()
    if env:
        return Path(env)
    return Path(__file__).resolve().parent / "data" / "channels.json"


def _slugify(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-") or "channel"


def _unique_slug(base: str, seen: set[str]) -> str:
    slug = base
    counter = 1
    while slug in seen:
        slug = f"{base}-{counter}"
        counter += 1
    seen.add(slug)
    return slug


def _stream_type(url: str) -> str:
    low = url.lower().split("?")[0]
    if ".m3u8" in low or ".m3u" in low:
        return "hls"
    if ".mp3" in low:
        return "mp3"
    if ".aac" in low:
        return "aac"
    return "hls"


def _parse_m3u(content: str) -> list[dict]:
    """Parse an M3U/M3U8 playlist; return one dict per stream entry."""
    channels: list[dict] = []
    lines = content.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if line.startswith("#EXTINF:"):
            meta: dict[str, str] = {}
            for m in re.finditer(r'([\w-]+)="([^"]*)"', line):
                key = m.group(1).lower().replace("-", "_")
                meta[key] = m.group(2)

            comma_pos = line.rfind(",")
            display_name = line[comma_pos + 1:].strip() if comma_pos >= 0 else ""

            # Advance past any extra directive lines to find the stream URL
            j = i + 1
            while j < len(lines) and lines[j].strip().startswith("#"):
                j += 1

            if j < len(lines):
                stream_url = lines[j].strip()
                if stream_url and not stream_url.startswith("#"):
                    channels.append({
                        "name": display_name or meta.get("tvg_name", ""),
                        "stream_url": stream_url,
                        "tvg_id": meta.get("tvg_id", ""),
                        "tvg_logo": meta.get("tvg_logo", ""),
                        "tvg_language": meta.get("tvg_language", ""),
                        "tvg_country": meta.get("tvg_country", ""),
                        "group_title": meta.get("group_title", ""),
                    })
                i = j + 1
                continue
        i += 1
    return channels


def run(out_path: Path, m3u_url: str = IPTV_ORG_M3U_URL) -> None:
    # Load existing channels; split by source so aparatchi is never touched
    existing_payload: dict = {}
    all_existing: list[dict] = []
    if out_path.exists():
        with open(out_path, encoding="utf-8") as f:
            existing_payload = json.load(f)
        all_existing = existing_payload.get("channels", [])

    # Non-iptv-org channels (aparatchi + any future sources) are preserved as-is
    non_iptv_channels = [c for c in all_existing if c.get("source") != SOURCE_LABEL]

    existing_stream_urls: set[str] = {
        c["stream_url"] for c in non_iptv_channels if c.get("stream_url")
    }
    seen_slugs: set[str] = {c["slug"] for c in non_iptv_channels if c.get("slug")}

    print(f"Fetching {m3u_url} …", file=sys.stderr)
    try:
        r = SESSION.get(m3u_url, timeout=REQUEST_TIMEOUT_S * 4)
        r.raise_for_status()
        r.encoding = "utf-8"
    except requests.RequestException as e:
        # Non-fatal: leave the existing file untouched so aparatchi channels are safe
        print(f"[warn] Could not fetch iptv-org M3U: {e} — skipping iptv-org update", file=sys.stderr)
        return

    raw_entries = _parse_m3u(r.text)
    print(f"Parsed {len(raw_entries)} entries from M3U", file=sys.stderr)

    new_channels: list[dict] = []
    for raw in raw_entries:
        stream_url = raw.get("stream_url", "").strip()
        if not stream_url or stream_url in existing_stream_urls:
            continue

        name = (raw.get("name") or raw.get("tvg_id") or "Unknown").strip()
        tvg_id = raw.get("tvg_id", "").strip()
        country = raw.get("tvg_country", "").strip()

        # Slug: prefer tvg_id (most unique), then name+country
        if tvg_id:
            slug_base = _slugify(tvg_id)
        elif country:
            slug_base = _slugify(f"{name}-{country}")
        else:
            slug_base = _slugify(name)

        slug = _unique_slug(slug_base, seen_slugs)
        stream_host = urlparse(stream_url).netloc
        group_title = raw.get("group_title", "").strip()
        tvg_logo = raw.get("tvg_logo", "").strip()
        media_type = "radio" if "radio" in name.lower() or "radio" in group_title.lower() else "tv"

        new_channels.append({
            "page_url": f"{PAGE_URL_BASE}/{slug}",
            "name": name,
            "stream_url": stream_url,
            "stream_type": _stream_type(stream_url),
            "stream_host": stream_host,
            "requires_proxy": False,
            "raw_iframe_src": None,
            "logo": tvg_logo or None,
            "category_path": "",
            "slug": slug,
            "media_type": media_type,
            "source": SOURCE_LABEL,
            "group_title": group_title,
            "tvg_id": tvg_id,
            "tvg_language": raw.get("tvg_language", "").strip(),
            "tvg_country": country.upper(),
        })
        existing_stream_urls.add(stream_url)

    all_channels = non_iptv_channels + new_channels

    payload = dict(existing_payload)
    payload["count"] = len(all_channels)
    payload["channels"] = all_channels

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        f"Added {len(new_channels)} iptv-org channels. "
        f"Total: {len(all_channels)} (aparatchi: {len(non_iptv_channels)})",
        file=sys.stderr,
    )


def main() -> None:
    p = argparse.ArgumentParser(description="Fetch iptv-org M3U and merge into channels.json.")
    p.add_argument(
        "-o", "--output",
        type=Path,
        default=_default_channels_path(),
        help="Path to channels.json to update (default: CHANNELS_JSON_PATH env or backend/data/channels.json)",
    )
    p.add_argument(
        "--url",
        default=IPTV_ORG_M3U_URL,
        help=f"M3U playlist URL (default: {IPTV_ORG_M3U_URL})",
    )
    args = p.parse_args()
    run(out_path=args.output, m3u_url=args.url)


if __name__ == "__main__":
    main()
