"""Download channel logos into the project `logo/` directory."""

from __future__ import annotations

import re
from pathlib import Path
from urllib.parse import urlparse

import requests

from config import REQUEST_TIMEOUT_S

_CT_EXT = {
    "image/svg+xml": ".svg",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
}


def _extension_from_url(url: str) -> str | None:
    path = urlparse(url).path.lower()
    for ext in (".svg", ".png", ".jpg", ".jpeg", ".webp", ".gif"):
        if path.endswith(ext):
            return ".jpg" if ext == ".jpeg" else ext
    return None


def _extension_from_content_type(content_type: str | None) -> str | None:
    if not content_type:
        return None
    main = content_type.split(";")[0].strip().lower()
    return _CT_EXT.get(main)


def _guess_extension(url: str, content_type: str | None) -> str:
    ext = _extension_from_url(url) or _extension_from_content_type(content_type)
    return ext or ".bin"


def _safe_filename_base(channel_path: str) -> str:
    base = channel_path.strip("/").replace("/", "__")
    base = re.sub(r'[<>:"|?*\\]', "_", base)
    base = re.sub(r"_+", "_", base).strip("_")
    return base or "channel"


def download_channel_logo(
    session: requests.Session,
    logo_url: str,
    logo_dir: Path,
    channel_path: str,
) -> str | None:
    """
    Download logo to logo_dir; return path relative to project root (e.g. logo/foo.svg).
    """
    try:
        r = session.get(logo_url, timeout=REQUEST_TIMEOUT_S)
        r.raise_for_status()
    except requests.RequestException:
        return None

    ext = _guess_extension(logo_url, r.headers.get("Content-Type"))
    name = f"{_safe_filename_base(channel_path)}{ext}"
    logo_dir.mkdir(parents=True, exist_ok=True)
    dest = logo_dir / name
    dest.write_bytes(r.content)
    return f"logo/{name}"
