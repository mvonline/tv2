"""Focused tests for the HLS proxy's memory bounds."""

from __future__ import annotations

import asyncio
import unittest

import hls_proxy
from starlette.requests import Request


class SegmentMemoryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.cache_limit = hls_proxy.SEGMENT_CACHE_MAX_BYTES
        self.buffer_limit = hls_proxy.MAX_ACTIVE_SEGMENT_BUFFERS
        hls_proxy._segment_cache.clear()
        hls_proxy._segment_cache_bytes = 0
        hls_proxy._active_segment_buffers = 0
        hls_proxy._segment_inflight.clear()
        hls_proxy._active_upstream_segments = 0

    def tearDown(self) -> None:
        hls_proxy.SEGMENT_CACHE_MAX_BYTES = self.cache_limit
        hls_proxy.MAX_ACTIVE_SEGMENT_BUFFERS = self.buffer_limit
        hls_proxy._segment_cache.clear()
        hls_proxy._segment_cache_bytes = 0
        hls_proxy._active_segment_buffers = 0
        hls_proxy._segment_inflight.clear()
        hls_proxy._active_upstream_segments = 0

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


class SegmentCoalescingTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.original_get_client = hls_proxy.get_client
        hls_proxy._segment_cache.clear()
        hls_proxy._segment_cache_bytes = 0
        hls_proxy._segment_inflight.clear()
        hls_proxy._active_segment_buffers = 0
        hls_proxy._active_upstream_segments = 0

    async def asyncTearDown(self) -> None:
        hls_proxy.get_client = self.original_get_client
        hls_proxy._segment_cache.clear()
        hls_proxy._segment_cache_bytes = 0
        hls_proxy._segment_inflight.clear()
        hls_proxy._active_segment_buffers = 0
        hls_proxy._active_upstream_segments = 0

    async def test_concurrent_request_reuses_leaders_segment(self) -> None:
        class FakeResponse:
            status_code = 200
            headers = {"content-type": "video/mp2t", "content-length": "6"}

            async def aiter_bytes(self, _size: int):
                yield b"abc"
                await asyncio.sleep(0)
                yield b"def"

            async def aclose(self) -> None:
                return None

        class FakeClient:
            sends = 0

            def build_request(self, _method: str, url: str, headers: dict):
                return url, headers

            async def send(self, _request, stream: bool):
                self.sends += 1
                return FakeResponse()

        fake_client = FakeClient()

        async def fake_get_client():
            return fake_client

        hls_proxy.get_client = fake_get_client
        request = Request(
            {
                "type": "http",
                "method": "GET",
                "scheme": "https",
                "server": ("example.test", 443),
                "path": "/proxy/hls",
                "query_string": b"",
                "headers": [(b"host", b"example.test")],
            }
        )
        url = "https://gg.hls2.xyz/live/channel/segment.ts?nimblesessionid=1"

        leader = await hls_proxy.proxy_hls(request, url)
        follower_task = asyncio.create_task(hls_proxy.proxy_hls(request, url))
        await asyncio.sleep(0)
        leader_body = b"".join([chunk async for chunk in leader.body_iterator])
        follower = await follower_task

        self.assertEqual(leader_body, b"abcdef")
        self.assertEqual(follower.body, b"abcdef")
        self.assertEqual(fake_client.sends, 1)
        self.assertEqual(hls_proxy._active_upstream_segments, 0)


if __name__ == "__main__":
    unittest.main()
