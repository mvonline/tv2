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
