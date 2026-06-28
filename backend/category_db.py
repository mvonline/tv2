"""SQLite storage for homepage category metadata (slug, label, order, active)."""

from __future__ import annotations

import os
import sqlite3
from pathlib import Path
from typing import Any

# Default labels aligned with ai_categorize taxonomy / frontend
DEFAULT_CATEGORY_ROWS: list[tuple[str, str, int]] = [
    ("sport", "Sport", 10),
    ("movie", "Movies", 20),
    ("news", "News", 30),
    ("music", "Music", 40),
    ("kids", "Kids", 50),
    ("documentary", "Documentary", 60),
    ("religious", "Religious", 70),
    ("entertainment", "Entertainment", 80),
    ("education", "Education", 90),
    ("series", "Series & drama", 100),
    ("lifestyle", "Lifestyle", 110),
    ("international", "International", 120),
    ("radio", "Radio", 130),
    ("other", "Other", 9990),
]


def db_path() -> Path:
    raw = os.environ.get("CATEGORY_DB_PATH", "").strip()
    if raw:
        return Path(raw)
    return Path(__file__).resolve().parent / "data" / "categories.db"


def connect() -> sqlite3.Connection:
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS categories (
            slug TEXT PRIMARY KEY NOT NULL,
            label TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            active INTEGER NOT NULL DEFAULT 1
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS channel_category_overrides (
            channel_slug TEXT PRIMARY KEY NOT NULL,
            category_slug TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS category_channel_order (
            category_slug TEXT NOT NULL,
            channel_slug TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (category_slug, channel_slug)
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS channel_stream_overrides (
            channel_slug TEXT PRIMARY KEY NOT NULL,
            stream_url   TEXT,     -- NULL = keep original
            requires_proxy INTEGER -- NULL = keep original; 0/1 = override
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS featured_channels (
            channel_slug TEXT PRIMARY KEY NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0
        )
        """
    )
    conn.commit()


def seed_if_empty(conn: sqlite3.Connection) -> None:
    n = conn.execute("SELECT COUNT(*) FROM categories").fetchone()[0]
    if n > 0:
        return
    conn.executemany(
        "INSERT INTO categories (slug, label, sort_order, active) VALUES (?, ?, ?, 1)",
        DEFAULT_CATEGORY_ROWS,
    )
    conn.commit()


def init_db() -> None:
    with connect() as c:
        init_schema(c)
        seed_if_empty(c)


def row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "slug": row["slug"],
        "label": row["label"],
        "sort_order": int(row["sort_order"]),
        "active": bool(row["active"]),
    }


def list_categories_public(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT slug, label, sort_order, active FROM categories WHERE active = 1 ORDER BY sort_order, slug"
    ).fetchall()
    return [row_to_dict(r) for r in rows]


def list_all(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT slug, label, sort_order, active FROM categories ORDER BY sort_order, slug"
    ).fetchall()
    return [row_to_dict(r) for r in rows]


def upsert_category(
    conn: sqlite3.Connection,
    slug: str,
    label: str,
    sort_order: int,
    active: bool,
) -> None:
    conn.execute(
        """
        INSERT INTO categories (slug, label, sort_order, active)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(slug) DO UPDATE SET
            label = excluded.label,
            sort_order = excluded.sort_order,
            active = excluded.active
        """,
        (slug.strip().lower(), label.strip(), sort_order, 1 if active else 0),
    )
    conn.commit()


def delete_category(conn: sqlite3.Connection, slug: str) -> bool:
    cur = conn.execute("DELETE FROM categories WHERE slug = ?", (slug.strip().lower(),))
    conn.commit()
    return cur.rowcount > 0


def get_channel_category_overrides(conn: sqlite3.Connection) -> dict[str, str]:
    rows = conn.execute(
        "SELECT channel_slug, category_slug FROM channel_category_overrides"
    ).fetchall()
    return {r["channel_slug"]: r["category_slug"] for r in rows}


def set_channel_category(conn: sqlite3.Connection, channel_slug: str, category_slug: str) -> None:
    conn.execute(
        """
        INSERT INTO channel_category_overrides (channel_slug, category_slug)
        VALUES (?, ?)
        ON CONFLICT(channel_slug) DO UPDATE SET category_slug = excluded.category_slug
        """,
        (channel_slug.strip(), category_slug.strip().lower()),
    )
    conn.commit()


def get_all_channel_orders(conn: sqlite3.Connection) -> dict[str, list[str]]:
    rows = conn.execute(
        "SELECT category_slug, channel_slug FROM category_channel_order ORDER BY category_slug, sort_order"
    ).fetchall()
    result: dict[str, list[str]] = {}
    for r in rows:
        cs = r["category_slug"]
        result.setdefault(cs, []).append(r["channel_slug"])
    return result


def set_category_channel_order(
    conn: sqlite3.Connection, category_slug: str, ordered_slugs: list[str]
) -> None:
    conn.execute(
        "DELETE FROM category_channel_order WHERE category_slug = ?", (category_slug,)
    )
    conn.executemany(
        "INSERT INTO category_channel_order (category_slug, channel_slug, sort_order) VALUES (?, ?, ?)",
        [(category_slug, slug, i) for i, slug in enumerate(ordered_slugs)],
    )
    conn.commit()


def get_featured_channel_slugs(conn: sqlite3.Connection) -> list[str]:
    rows = conn.execute(
        "SELECT channel_slug FROM featured_channels ORDER BY sort_order, channel_slug"
    ).fetchall()
    return [r["channel_slug"] for r in rows]


def set_featured_channel_slugs(conn: sqlite3.Connection, slugs: list[str]) -> None:
    conn.execute("DELETE FROM featured_channels")
    clean: list[str] = []
    for slug in slugs:
        key = slug.strip()
        if key and key not in clean:
            clean.append(key)
    conn.executemany(
        "INSERT INTO featured_channels (channel_slug, sort_order) VALUES (?, ?)",
        [(slug, i) for i, slug in enumerate(clean)],
    )
    conn.commit()


def get_stream_overrides(conn: sqlite3.Connection) -> dict[str, dict]:
    rows = conn.execute(
        "SELECT channel_slug, stream_url, requires_proxy FROM channel_stream_overrides"
    ).fetchall()
    return {
        r["channel_slug"]: {
            "stream_url": r["stream_url"],
            "requires_proxy": None if r["requires_proxy"] is None else bool(r["requires_proxy"]),
        }
        for r in rows
    }


def set_stream_override(
    conn: sqlite3.Connection,
    channel_slug: str,
    stream_url: str | None,
    requires_proxy: bool | None,
) -> None:
    conn.execute(
        """
        INSERT INTO channel_stream_overrides (channel_slug, stream_url, requires_proxy)
        VALUES (?, ?, ?)
        ON CONFLICT(channel_slug) DO UPDATE SET
            stream_url     = excluded.stream_url,
            requires_proxy = excluded.requires_proxy
        """,
        (
            channel_slug.strip(),
            stream_url,
            None if requires_proxy is None else (1 if requires_proxy else 0),
        ),
    )
    conn.commit()


def delete_stream_override(conn: sqlite3.Connection, channel_slug: str) -> bool:
    cur = conn.execute(
        "DELETE FROM channel_stream_overrides WHERE channel_slug = ?",
        (channel_slug.strip(),),
    )
    conn.commit()
    return cur.rowcount > 0


def ensure_slugs_from_iterable(conn: sqlite3.Connection, slugs: set[str]) -> int:
    """Insert missing slugs with default label/sort (end of list). Used by sync script."""
    existing = {
        r[0]
        for r in conn.execute("SELECT slug FROM categories").fetchall()
    }
    added = 0
    max_sort = conn.execute("SELECT COALESCE(MAX(sort_order), 0) FROM categories").fetchone()[0]
    next_sort = int(max_sort) + 10
    for s in sorted(slugs):
        key = s.strip().lower()
        if not key or key in existing:
            continue
        label = key.replace("-", " ").title()
        conn.execute(
            "INSERT INTO categories (slug, label, sort_order, active) VALUES (?, ?, ?, 1)",
            (key, label, next_sort),
        )
        next_sort += 10
        existing.add(key)
        added += 1
    if added:
        conn.commit()
    return added
