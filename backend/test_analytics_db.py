"""Tests for analytics event deduplication."""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

import analytics_db


class AnalyticsDedupeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.old_db_path = os.environ.get("ANALYTICS_DB_PATH")
        self.old_window = os.environ.get("ANALYTICS_DEDUPE_SECONDS")
        os.environ["ANALYTICS_DB_PATH"] = str(
            Path(self.tempdir.name) / "analytics.db"
        )
        os.environ["ANALYTICS_DEDUPE_SECONDS"] = "30"
        analytics_db.init_db()

    def tearDown(self) -> None:
        if self.old_db_path is None:
            os.environ.pop("ANALYTICS_DB_PATH", None)
        else:
            os.environ["ANALYTICS_DB_PATH"] = self.old_db_path
        if self.old_window is None:
            os.environ.pop("ANALYTICS_DEDUPE_SECONDS", None)
        else:
            os.environ["ANALYTICS_DEDUPE_SECONDS"] = self.old_window
        self.tempdir.cleanup()

    def test_repeated_ip_and_channel_is_recorded_once(self) -> None:
        self.assertTrue(analytics_db.record_view("news", "News", "1.2.3.4", "ua"))
        self.assertFalse(analytics_db.record_view("news", "News", "1.2.3.4", "ua"))
        self.assertTrue(analytics_db.record_view("sport", "Sport", "1.2.3.4", "ua"))

        with analytics_db.connect() as conn:
            count = conn.execute("SELECT COUNT(*) FROM channel_views").fetchone()[0]
        self.assertEqual(count, 2)
