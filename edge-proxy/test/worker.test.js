import test from "node:test"
import assert from "node:assert/strict"

import {
  allowedHost,
  rewritePlaylist,
  stripVolatileQuery,
} from "../src/index.js"

test("host allowlist rejects suffix tricks", () => {
  assert.equal(allowedHost("gg.hls2.xyz"), true)
  assert.equal(allowedHost("video.telewebion.ir"), true)
  assert.equal(allowedHost("hls2.xyz.evil.example"), false)
})

test("segment cache identity excludes Nimble session ids", () => {
  assert.equal(
    stripVolatileQuery(
      "https://gg.hls2.xyz/live/a/1.ts?nimblesessionid=123&quality=hd",
    ),
    "https://gg.hls2.xyz/live/a/1.ts?quality=hd",
  )
})

test("playlist resources are rewritten through the edge endpoint", () => {
  const result = rewritePlaylist(
    '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin?nimblesessionid=7"\nseg.ts?nimblesessionid=7',
    "https://gg.hls2.xyz/live/a/chunks.m3u8?nimblesessionid=7",
    "https://tv2-hls-edge.example.workers.dev/proxy/hls?url=old",
  )

  assert.match(result, /url=https%3A%2F%2Fgg\.hls2\.xyz%2Flive%2Fa%2Fkey\.bin/)
  assert.match(result, /url=https%3A%2F%2Fgg\.hls2\.xyz%2Flive%2Fa%2Fseg\.ts/)
  assert.equal(result.includes("url=old"), false)
})
