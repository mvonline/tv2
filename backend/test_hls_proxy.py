"""Focused tests for the HLS proxy's memory bounds."""

from __future__ import annotations

import unittest

import hls_proxy


class SegmentMemoryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.cache_limit = hls_proxy.SEGMENT_CACHE_MAX_BYTES
        self.buffer_limit = hls_proxy.MAX_ACTIVE_SEGMENT_BUFFERS
        hls_proxy._segment_cache.clear()
        hls_proxy._segment_cache_bytes = 0
        hls_proxy._active_segment_buffers = 0

    def tearDown(self) -> None:
        hls_proxy.SEGMENT_CACHE_MAX_BYTES = self.cache_limit
        hls_proxy.MAX_ACTIVE_SEGMENT_BUFFERS = self.buffer_limit
        hls_proxy._segment_cache.clear()
        hls_proxy._segment_cache_bytes = 0
        hls_proxy._active_segment_buffers = 0

    def test_segment_cache_evicts_to_byte_limit(self) -> None:
        hls_proxy.SEGMENT_CACHE_MAX_BYTES = 5

        hls_proxy._segment_store("https://gg.hls2.xyz/a.ts", "video/mp2t", b"aaa")
        hls_proxy._segment_store("https://gg.hls2.xyz/b.ts", "video/mp2t", b"bbb")

        self.assertIsNone(hls_proxy._segment_cached("https://gg.hls2.xyz/a.ts"))
        self.assertEqual(
            hls_proxy._segment_cached("https://gg.hls2.xyz/b.ts"),
            ("video/mp2t", b"bbb"),
        )
        self.assertEqual(hls_proxy._segment_cache_bytes, 3)

    def test_segment_buffer_reservations_are_bounded(self) -> None:
        hls_proxy.SEGMENT_CACHE_MAX_BYTES = 32 * 1024 * 1024
        hls_proxy.MAX_ACTIVE_SEGMENT_BUFFERS = 2

        self.assertTrue(hls_proxy._reserve_segment_buffer())
        self.assertTrue(hls_proxy._reserve_segment_buffer())
        self.assertFalse(hls_proxy._reserve_segment_buffer())

        hls_proxy._release_segment_buffer()
        self.assertTrue(hls_proxy._reserve_segment_buffer())


if __name__ == "__main__":
    unittest.main()
