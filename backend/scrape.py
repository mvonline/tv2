"""
Two-level crawl: category pages -> channel pages -> extract stream metadata -> JSON.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

from config import (
    BASE_URL,
    CATEGORY_INDEX_RE,
    CATEGORY_PATHS,
    CHANNEL_PATH_RE,
    REQUEST_TIMEOUT_S,
    USER_AGENT,
)
from extract_stream import extract_channel_page
from logos import download_channel_logo


def _project_root() -> Path:
    """Repo root locally; in Docker only `backend/` is at `/app`, so parent.parent becomes `/`."""
    root = Path(__file__).resolve().parent.parent
    if root == Path("/"):
        return Path("/app")
    return root


PROJECT_ROOT = _project_root()


def _default_logo_dir() -> Path:
    env = os.environ.get("LOGO_DIR", "").strip()
    if env:
        return Path(env)
    return PROJECT_ROOT / "logo"


def _default_channels_output() -> Path:
    env = os.environ.get("CHANNELS_JSON_PATH", "").strip()
    if env:
        return Path(env)
    return Path(__file__).resolve().parent / "data" / "channels.json"


SESSION = requests.Session()
SESSION.headers.update({"User-Agent": USER_AGENT})


def fetch(url: str) -> str:
    r = SESSION.get(url, timeout=REQUEST_TIMEOUT_S)
    r.raise_for_status()
    r.encoding = r.apparent_encoding
    return r.text


def _same_site(host: str) -> bool:
    h = host.lower().removeprefix("www.")
    return h == "aparatchi.com"


def normalize_path(href: str) -> str | None:
    """Return site path starting with /, or None. Handles absolute same-site URLs."""
    if not href:
        return None
    href = href.strip()
    href = href.split("#")[0].split("?")[0]
    if href.startswith(("http://", "https://")):
        pu = urlparse(href)
        if not _same_site(pu.netloc):
            return None
        href = pu.path or "/"
    elif href.startswith("//"):
        pu = urlparse("https:" + href)
        if not _same_site(pu.netloc):
            return None
        href = pu.path or "/"
    if not href.startswith("/"):
        return None
    return href or None


def discover_channel_paths(html: str) -> set[str]:
    soup = BeautifulSoup(html, "lxml")
    found: set[str] = set()
    for a in soup.find_all("a", href=True):
        path = normalize_path(a["href"])
        if not path:
            continue
        if CHANNEL_PATH_RE.match(path):
            found.add(path)
    return found


def discover_category_paths_from_homepage(html: str) -> set[str]:
    """Collect top-level category index links from the homepage (e.g. /sport-live-tv)."""
    soup = BeautifulSoup(html, "lxml")
    found: set[str] = set()
    for a in soup.find_all("a", href=True):
        path = normalize_path(a["href"])
        if not path:
            continue
        path = path.rstrip("/") or "/"
        if CATEGORY_INDEX_RE.match(path):
            found.add(path)
    return found


def resolve_category_seeds(categories: list[str] | None) -> list[str]:
    """
    Default: always scrape every path in CATEGORY_PATHS (order preserved, deduped),
    then append any category index links found on the homepage that are not in config.
    """
    if categories is not None:
        return list(categories)

    seeds: list[str] = []
    seen: set[str] = set()
    for raw in CATEGORY_PATHS:
        p = (raw or "").strip()
        if not p.startswith("/"):
            p = "/" + p
        p = p.rstrip("/") or "/"
        if p not in seen:
            seen.add(p)
            seeds.append(p)

    try:
        home_html = fetch(BASE_URL + "/")
        for p in sorted(discover_category_paths_from_homepage(home_html)):
            if p not in seen:
                seen.add(p)
                seeds.append(p)
    except requests.RequestException as e:
        print(f"[warn] could not fetch homepage for category discovery: {e}", file=sys.stderr)

    print(
        f"Categories to scrape: {len(seeds)} (all {len(CATEGORY_PATHS)} from CATEGORY_PATHS"
        + (" + homepage extras" if len(seeds) > len(CATEGORY_PATHS) else "")
        + ")",
        file=sys.stderr,
    )
    return seeds


def run(
    *,
    delay_s: float,
    out_path: Path,
    categories: list[str] | None,
    logo_dir: Path,
) -> None:
    seeds = resolve_category_seeds(categories)
    channel_paths: set[str] = set()

    for cat in seeds:
        url = BASE_URL + (cat if cat.startswith("/") else "/" + cat)
        try:
            html = fetch(url)
        except requests.RequestException as e:
            print(f"[skip] category {url}: {e}", file=sys.stderr)
            continue
        channel_paths |= discover_channel_paths(html)
        time.sleep(delay_s)

    channels: list[dict] = []
    for path in sorted(channel_paths):
        page_url = BASE_URL + path
        try:
            html = fetch(page_url)
        except requests.RequestException as e:
            print(f"[skip] channel {page_url}: {e}", file=sys.stderr)
            time.sleep(delay_s)
            continue
        meta = extract_channel_page(html, page_url)
        logo_url = meta.pop("logo_url", None)
        if logo_url:
            local = download_channel_logo(SESSION, logo_url, logo_dir, path)
            meta["logo"] = local
            if not local:
                print(f"[warn] logo download failed: {page_url}", file=sys.stderr)
        else:
            meta["logo"] = None
        meta["category_path"] = "/" + path.strip("/").split("/")[0]
        meta["slug"] = path.rstrip("/").split("/")[-1]
        cat = meta["category_path"].lower()
        meta["media_type"] = "radio" if "radio" in cat else "tv"
        channels.append(meta)
        time.sleep(delay_s)

    payload = {
        "source": BASE_URL,
        "count": len(channels),
        "channels": channels,
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(channels)} channels to {out_path}")


def main() -> None:
    p = argparse.ArgumentParser(description="Scrape Aparatchi category and channel pages.")
    p.add_argument(
        "-o",
        "--output",
        type=Path,
        default=_default_channels_output(),
        help="Output JSON path (default: CHANNELS_JSON_PATH env or backend/data/channels.json)",
    )
    p.add_argument(
        "--delay",
        type=float,
        default=1.0,
        help="Seconds between HTTP requests (be polite to the server)",
    )
    p.add_argument(
        "--category",
        action="append",
        dest="categories",
        help="Limit to one or more category paths (e.g. /sport-live-tv). Repeatable.",
    )
    p.add_argument(
        "--logo-dir",
        type=Path,
        default=_default_logo_dir(),
        help="Directory to store downloaded logos (default: LOGO_DIR env or <project>/logo)",
    )
    args = p.parse_args()
    run(
        delay_s=args.delay,
        out_path=args.output,
        categories=args.categories,
        logo_dir=args.logo_dir,
    )


if __name__ == "__main__":
    main()
