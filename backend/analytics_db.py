"""SQLite analytics — channel views, IPs, user-agents."""

from __future__ import annotations

import os
import sqlite3
import time
from pathlib import Path
from typing import Any


def db_path() -> Path:
    raw = os.environ.get("ANALYTICS_DB_PATH", "").strip()
    if raw:
        return Path(raw)
    return Path(__file__).resolve().parent / "data" / "analytics.db"


def connect() -> sqlite3.Connection:
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    conn = connect()
    try:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS channel_views (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                channel_slug TEXT NOT NULL,
                channel_name TEXT,
                ip           TEXT NOT NULL,
                user_agent   TEXT,
                viewed_at    INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_cv_slug ON channel_views (channel_slug);
            CREATE INDEX IF NOT EXISTS idx_cv_at   ON channel_views (viewed_at);
            CREATE INDEX IF NOT EXISTS idx_cv_ip   ON channel_views (ip);
        """)
        conn.commit()
    finally:
        conn.close()


def record_view(
    channel_slug: str,
    channel_name: str | None,
    ip: str,
    user_agent: str | None,
) -> None:
    conn = connect()
    try:
        conn.execute(
            "INSERT INTO channel_views (channel_slug, channel_name, ip, user_agent, viewed_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (channel_slug, channel_name, ip, user_agent, int(time.time())),
        )
        conn.commit()
    finally:
        conn.close()


def _row(r: sqlite3.Row) -> dict[str, Any]:
    return dict(r)


def get_summary() -> dict[str, Any]:
    conn = connect()
    try:
        today_start = int(time.time()) - (int(time.time()) % 86400)
        row = conn.execute("""
            SELECT
                COUNT(*)                   AS total_views,
                COUNT(DISTINCT ip)         AS unique_ips,
                COUNT(DISTINCT channel_slug) AS unique_channels,
                SUM(CASE WHEN viewed_at >= ? THEN 1 ELSE 0 END) AS today_views
            FROM channel_views
        """, (today_start,)).fetchone()
        return _row(row)
    finally:
        conn.close()


def get_top_channels(days: int = 30, limit: int = 10) -> list[dict[str, Any]]:
    since = int(time.time()) - days * 86400
    conn = connect()
    try:
        rows = conn.execute("""
            SELECT channel_slug, channel_name, COUNT(*) AS views
            FROM channel_views
            WHERE viewed_at >= ?
            GROUP BY channel_slug
            ORDER BY views DESC
            LIMIT ?
        """, (since, limit)).fetchall()
        return [_row(r) for r in rows]
    finally:
        conn.close()


def get_recent_views(limit: int = 50) -> list[dict[str, Any]]:
    conn = connect()
    try:
        rows = conn.execute("""
            SELECT channel_slug, channel_name, ip, user_agent, viewed_at
            FROM channel_views
            ORDER BY viewed_at DESC
            LIMIT ?
        """, (limit,)).fetchall()
        return [_row(r) for r in rows]
    finally:
        conn.close()


def get_views_by_hour(days: int = 7) -> list[dict[str, Any]]:
    since = int(time.time()) - days * 86400
    conn = connect()
    try:
        rows = conn.execute("""
            SELECT
                CAST(strftime('%H', datetime(viewed_at, 'unixepoch')) AS INTEGER) AS hour,
                COUNT(*) AS views
            FROM channel_views
            WHERE viewed_at >= ?
            GROUP BY hour
            ORDER BY hour
        """, (since,)).fetchall()
        return [_row(r) for r in rows]
    finally:
        conn.close()


def get_views_by_day(days: int = 30) -> list[dict[str, Any]]:
    since = int(time.time()) - days * 86400
    conn = connect()
    try:
        rows = conn.execute("""
            SELECT
                strftime('%Y-%m-%d', datetime(viewed_at, 'unixepoch')) AS day,
                COUNT(*) AS views
            FROM channel_views
            WHERE viewed_at >= ?
            GROUP BY day
            ORDER BY day
        """, (since,)).fetchall()
        return [_row(r) for r in rows]
    finally:
        conn.close()
