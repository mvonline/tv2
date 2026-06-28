"""SQLite storage for XMLTV EPG channel mappings and cached programmes."""

from __future__ import annotations

import os
import sqlite3
import time
from pathlib import Path
from typing import Any


def db_path() -> Path:
    raw = os.environ.get("EPG_DB_PATH", "").strip()
    if raw:
        return Path(raw)
    return Path(__file__).resolve().parent / "data" / "epg.db"


def connect() -> sqlite3.Connection:
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    return conn


def init_schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS epg_channel_map (
            channel_slug TEXT PRIMARY KEY NOT NULL,
            epg_id TEXT NOT NULL,
            epg_url TEXT,
            updated_at INTEGER NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS epg_programmes (
            epg_id TEXT NOT NULL,
            start_ts INTEGER NOT NULL,
            stop_ts INTEGER NOT NULL,
            title TEXT NOT NULL,
            description TEXT,
            category TEXT,
            PRIMARY KEY (epg_id, start_ts, title)
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_epg_programmes_window ON epg_programmes (epg_id, start_ts, stop_ts)")
    conn.commit()


def init_db() -> None:
    with connect() as conn:
        init_schema(conn)


def row_to_mapping(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "channel_slug": row["channel_slug"],
        "epg_id": row["epg_id"],
        "epg_url": row["epg_url"],
        "updated_at": int(row["updated_at"]),
    }


def list_mappings(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT channel_slug, epg_id, epg_url, updated_at FROM epg_channel_map ORDER BY channel_slug"
    ).fetchall()
    return [row_to_mapping(r) for r in rows]


def get_mapping(conn: sqlite3.Connection, channel_slug: str) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT channel_slug, epg_id, epg_url, updated_at FROM epg_channel_map WHERE channel_slug = ?",
        (channel_slug.strip(),),
    ).fetchone()
    return row_to_mapping(row) if row else None


def set_mapping(conn: sqlite3.Connection, channel_slug: str, epg_id: str, epg_url: str | None) -> None:
    conn.execute(
        """
        INSERT INTO epg_channel_map (channel_slug, epg_id, epg_url, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(channel_slug) DO UPDATE SET
            epg_id = excluded.epg_id,
            epg_url = excluded.epg_url,
            updated_at = excluded.updated_at
        """,
        (channel_slug.strip(), epg_id.strip(), (epg_url or "").strip() or None, int(time.time())),
    )
    conn.commit()


def delete_mapping(conn: sqlite3.Connection, channel_slug: str) -> bool:
    cur = conn.execute("DELETE FROM epg_channel_map WHERE channel_slug = ?", (channel_slug.strip(),))
    conn.commit()
    return cur.rowcount > 0


def replace_programmes(conn: sqlite3.Connection, epg_url: str | None, programmes: list[dict[str, Any]]) -> int:
    epg_ids = sorted({p["epg_id"] for p in programmes if p.get("epg_id")})
    if epg_url:
        mapped = conn.execute(
            "SELECT DISTINCT epg_id FROM epg_channel_map WHERE epg_url = ?",
            (epg_url,),
        ).fetchall()
        epg_ids = sorted(set(epg_ids) | {r["epg_id"] for r in mapped})
    for epg_id in epg_ids:
        conn.execute("DELETE FROM epg_programmes WHERE epg_id = ?", (epg_id,))
    conn.executemany(
        """
        INSERT OR REPLACE INTO epg_programmes
            (epg_id, start_ts, stop_ts, title, description, category)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        [
            (
                p["epg_id"],
                int(p["start_ts"]),
                int(p["stop_ts"]),
                p["title"],
                p.get("description"),
                p.get("category"),
            )
            for p in programmes
        ],
    )
    conn.commit()
    return len(programmes)


def list_programmes(conn: sqlite3.Connection, epg_id: str, from_ts: int, to_ts: int) -> list[dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT epg_id, start_ts, stop_ts, title, description, category
        FROM epg_programmes
        WHERE epg_id = ? AND stop_ts > ? AND start_ts < ?
        ORDER BY start_ts
        """,
        (epg_id, from_ts, to_ts),
    ).fetchall()
    return [dict(r) for r in rows]


def now_programme(conn: sqlite3.Connection, epg_id: str, at_ts: int) -> dict[str, Any] | None:
    row = conn.execute(
        """
        SELECT epg_id, start_ts, stop_ts, title, description, category
        FROM epg_programmes
        WHERE epg_id = ? AND start_ts <= ? AND stop_ts > ?
        ORDER BY start_ts DESC
        LIMIT 1
        """,
        (epg_id, at_ts, at_ts),
    ).fetchone()
    return dict(row) if row else None
