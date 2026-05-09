"""
Fetch channels.json from CHANNELS_JSON_URL before serving (Docker + local uvicorn).

Env:
  CHANNELS_JSON_URL — HTTP(S) URL to download (optional).
  CHANNELS_JSON_PATH — destination file (default: backend/data/channels.json).
  SKIP_CHANNELS_FETCH — set to 1/true to skip download.
"""

from __future__ import annotations

import os
from pathlib import Path

import requests

from config import REQUEST_TIMEOUT_S, USER_AGENT


def channels_json_path() -> Path:
    env = os.environ.get("CHANNELS_JSON_PATH", "").strip()
    if env:
        return Path(env)
    return Path(__file__).resolve().parent / "data" / "channels.json"


def _skip_fetch() -> bool:
    v = os.environ.get("SKIP_CHANNELS_FETCH", "").strip().lower()
    return v in ("1", "true", "yes")


def maybe_fetch_channels_json() -> None:
    """If CHANNELS_JSON_URL is set, download into CHANNELS_JSON_PATH."""
    if _skip_fetch():
        return
    url = os.environ.get("CHANNELS_JSON_URL", "").strip()
    if not url:
        return

    out = channels_json_path()
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(out.suffix + ".tmp")

    print(f"Fetching channels.json from CHANNELS_JSON_URL -> {out}", flush=True)
    r = requests.get(
        url,
        timeout=REQUEST_TIMEOUT_S,
        headers={"User-Agent": USER_AGENT},
    )
    r.raise_for_status()
    tmp.write_bytes(r.content)
    tmp.replace(out)
