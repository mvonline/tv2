"""
Assign each channel a content topic (sport, movie, news, …) using a simple
name/slug keyword classifier (no external APIs).

Optional hints from the first URL path segment (site menu) and media_type
are used when they clearly indicate category.

Usage:
  python ai_categorize.py -i data/channels.json
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

# Keep in sync with frontend src/lib/topicAccent.ts / types
TAXONOMY: tuple[str, ...] = (
    "sport",
    "movie",
    "news",
    "music",
    "kids",
    "documentary",
    "religious",
    "entertainment",
    "education",
    "series",
    "lifestyle",
    "international",
    "radio",
    "other",
)

AI_MODEL_LABEL = "name-heuristic-v1"

# First path segment of channel URLs → topic hint (site menu)
SEGMENT_HINT: dict[str, str] = {
    "sport-live-tv": "sport",
    "film-live-tv": "movie",
    "series-live-tv": "series",
    "news-live-tv": "news",
    "music-live-tv": "music",
    "kids-live-tv": "kids",
    "scientific-live-tv": "documentary",
    "religion-live-tv": "religious",
    "entertainment-live-tv": "entertainment",
    "politics-live-tv": "news",
    "iranian-live-radio": "radio",
    "irib-live-tv": "news",
    "irib-ostani-live-tv": "news",
}

# First matching rule wins; order matters (more specific before broad).
KEYWORD_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("kids", ("kids", "kid ", "child", "cartoon", "disney", "nickelodeon", "junior", "baby tv", "baby")),
    ("sport", (
        "sport", "varzesh", "football", "soccer", "futbol", "nba", "nfl", "olympic",
        "tennis", "golf", "cricket", "espn", "liga", "world cup", "stadium", "match tv",
        "varsity", "mlb", "nhl", "f1", "formula 1", "wrestling", "ufc", "boxing",
    )),
    ("news", (
        "news", "headline", "breaking", "cnn", "bbc", "sky news", "al jazeera", "aljazeera",
        "press tv", "irib", "payam", "bulletin", "journal", "24h news", "noticias",
    )),
    ("movie", (
        "movie", "film", "cinema", "cine ", " cine", "bollywood", "hollywood", "gem film",
        "premiere", "box office",
    )),
    ("music", (
        "music", "mtv", "hits", "concert", "pop ", " rock", "jazz", "classical", "rap ",
        "hip hop", "radio music",
    )),
    ("documentary", (
        "documentary", "docu", "discovery", "national geographic", "nat geo", "nature",
        "science", "wildlife", "planet", "history channel",
    )),
    ("religious", (
        "religious", "religion", "quran", "koran", "bible", "church", "islamic", "islam ",
        "namaz", "noor", "shia", "sunni", "faith", "spiritual",
    )),
    ("education", (
        "education", "learn", "school", "university", "academy", "course", "lecture",
        "khan", "tutorial",
    )),
    ("series", (
        "series", "serie", "drama", "episode", "serial", "soap", "tv show", "season ",
    )),
    ("lifestyle", (
        "lifestyle", "cooking", "food network", "recipe", "travel", "fashion", "home &",
        "garden", "wellness",
    )),
    ("entertainment", (
        "entertainment", "variety", "reality", "talk show", "comedy", "game show", "talent",
    )),
    ("international", (
        "international", "world ", " global", "europe", "asia tv", "africa", "americas",
    )),
    ("radio", (
        "radio", " fm", " am ", "radionama", "broadcast", "frequency",
    )),
)


def _first_path_segment(page_url: str) -> str:
    try:
        p = urlparse(page_url).path.strip("/").split("/")
        return (p[0] or "").lower()
    except Exception:
        return ""


def categorize_channel(ch: dict[str, Any]) -> str:
    """Single topic from taxonomy using name, slug, and light URL/media hints."""
    seg = _first_path_segment(ch.get("page_url") or "")
    if seg in SEGMENT_HINT:
        return SEGMENT_HINT[seg]
    if ch.get("media_type") == "radio":
        return "radio"

    name = (ch.get("name") or "").lower()
    slug = (ch.get("slug") or "").lower()
    blob = f" {name} {slug} "

    for category, keywords in KEYWORD_RULES:
        for kw in keywords:
            if kw in blob:
                return category

    return "other"


def run(payload: dict[str, Any]) -> None:
    channels: list[dict[str, Any]] = payload.get("channels") or []
    labeled = 0
    for ch in channels:
        ch["ai_category"] = categorize_channel(ch)
        ch["ai_labeled_at"] = (
            datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        )
        labeled += 1

    payload["ai_taxonomy"] = list(TAXONOMY)
    payload["ai_model"] = AI_MODEL_LABEL
    print(
        f"Categorized {labeled} channels ({AI_MODEL_LABEL}, name/slug keywords).",
        file=sys.stderr,
    )


def main() -> None:
    p = argparse.ArgumentParser(
        description="Add ai_category to channels JSON (name-based heuristic, no API).",
    )
    p.add_argument("-i", "--input", type=str, default="data/channels.json")
    args = p.parse_args()

    path = os.path.abspath(args.input)
    if not os.path.isfile(path):
        print(f"Not found: {path}", file=sys.stderr)
        sys.exit(1)

    with open(path, encoding="utf-8") as f:
        payload = json.load(f)

    run(payload)

    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"Wrote {path}", file=sys.stderr)


if __name__ == "__main__":
    main()
