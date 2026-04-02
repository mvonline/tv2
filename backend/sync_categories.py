"""
Ensure SQLite `categories` table contains every `ai_category` slug present in channels.json.

Run after scrape / ai_categorize (e.g. in CI). New slugs get a default label and sort_order.

Usage:
  python sync_categories.py
  CHANNELS_JSON=path/to/channels.json python sync_categories.py
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from category_db import connect, ensure_slugs_from_iterable, init_db


def main() -> None:
    path = os.environ.get(
        "CHANNELS_JSON",
        str(ROOT / "data" / "channels.json"),
    )
    path = os.path.abspath(path)
    if not os.path.isfile(path):
        print(f"Not found: {path}", file=sys.stderr)
        sys.exit(1)

    with open(path, encoding="utf-8") as f:
        payload = json.load(f)

    slugs: set[str] = set()
    for ch in payload.get("channels") or []:
        raw = ((ch.get("ai_category") or "other").strip().lower() or "other")
        slugs.add(raw)

    init_db()
    with connect() as conn:
        added = ensure_slugs_from_iterable(conn, slugs)

    print(
        f"Category sync: {len(slugs)} unique ai_category values, {added} new DB row(s).",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
