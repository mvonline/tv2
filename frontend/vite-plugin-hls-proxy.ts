import { Readable } from "node:stream"
import type { Connect, PreviewServer, ViteDevServer } from "vite"

/** Same allowlist as backend `hls_proxy.allowed_host` / `config.stream_requires_proxy`. */
const ALLOWED_SUFFIXES = [".hls2.xyz", ".presstv.ir", ".telewebion.ir"]

function allowedHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  return ALLOWED_SUFFIXES.some((s) => h.endsWith(s))
}

/** Nimble/CDN expects embedder Origin + Referer (same as aparatchii.com in the browser). */
const UPSTREAM_HEADERS: Record<string, string> = {
  Referer: "https://www.aparatchii.com/",
  Origin: "https://www.aparatchii.com",
  Accept: "*/*",
  "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Sec-Fetch-Site": "cross-site",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Dest": "empty",
  DNT: "1",
}

/** Telewebion checks its own embedder origin, not aparatchii.com. */
const TELEWEBION_HEADERS: Record<string, string> = {
  ...UPSTREAM_HEADERS,
  Referer: "https://www.telewebion.com/",
  Origin: "https://www.telewebion.com",
}

function upstreamHeaders(hostname: string): Record<string, string> {
  const h = hostname.toLowerCase()
  return h.endsWith(".telewebion.ir") || h === "telewebion.ir"
    ? TELEWEBION_HEADERS
    : UPSTREAM_HEADERS
}

/**
 * Same caching strategy as `backend/hls_proxy.py`, for the same reason: a cold
 * TLS handshake to the CDN costs 170-2800 ms vs ~100 ms pooled, media playlists
 * are identical between viewers within a target duration, and segments are
 * immutable. Without this, every dev reload pays full upstream latency.
 */
const MANIFEST_TTL_MS = 1500
const SEGMENT_TTL_MS = 60_000
const SEGMENT_MAX_BYTES = 8 * 1024 * 1024
const SEGMENT_CACHE_MAX_BYTES = 192 * 1024 * 1024

type ManifestEntry = { expires: number; body: string }
type SegmentEntry = { expires: number; contentType: string; body: Buffer }

const manifestCache = new Map<string, ManifestEntry>()
const manifestInflight = new Map<string, Promise<string>>()
const segmentCache = new Map<string, SegmentEntry>()
const segmentPrefetching = new Set<string>()
let segmentCacheBytes = 0

function manifestCached(key: string): string | null {
  const hit = manifestCache.get(key)
  if (!hit) return null
  if (hit.expires < Date.now()) {
    manifestCache.delete(key)
    return null
  }
  return hit.body
}

function segmentCached(url: string): SegmentEntry | null {
  const hit = segmentCache.get(url)
  if (!hit) return null
  if (hit.expires < Date.now()) {
    segmentCache.delete(url)
    segmentCacheBytes -= hit.body.length
    return null
  }
  // Map preserves insertion order, so re-inserting marks this most recent.
  segmentCache.delete(url)
  segmentCache.set(url, hit)
  return hit
}

function segmentStore(url: string, contentType: string, body: Buffer): void {
  if (body.length > SEGMENT_MAX_BYTES) return
  const existing = segmentCache.get(url)
  if (existing) segmentCacheBytes -= existing.body.length
  segmentCache.set(url, { expires: Date.now() + SEGMENT_TTL_MS, contentType, body })
  segmentCacheBytes += body.length
  while (segmentCacheBytes > SEGMENT_CACHE_MAX_BYTES) {
    const oldest = segmentCache.keys().next()
    if (oldest.done) break
    const entry = segmentCache.get(oldest.value)
    segmentCache.delete(oldest.value)
    if (entry) segmentCacheBytes -= entry.body.length
  }
}

/** Absolute proxyable media URLs listed in a playlist, in playlist order. */
function playlistEntries(body: string, playlistUrl: string): string[] {
  const base = new URL(playlistUrl)
  const out: string[] = []
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    try {
      const u = new URL(trimmed, base)
      if (allowedHost(u.hostname)) out.push(u.href)
    } catch {
      /* ignore */
    }
  }
  return out
}

/**
 * hls.js starts at the live edge, so after serving a media playlist begin
 * fetching its last segment — by the time the player asks, it is in memory.
 */
function scheduleLiveEdgePrefetch(body: string, playlistUrl: string): void {
  const entries = playlistEntries(body, playlistUrl)
  const target = entries[entries.length - 1]
  if (!target || target.toLowerCase().includes(".m3u")) return
  if (segmentPrefetching.has(target) || segmentCached(target)) return
  segmentPrefetching.add(target)
  void (async () => {
    try {
      const r = await fetch(target, {
        headers: upstreamHeaders(new URL(target).hostname),
      })
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer())
        segmentStore(target, r.headers.get("content-type") ?? "application/octet-stream", buf)
      }
    } catch {
      /* Best effort; the real request will fetch it. */
    } finally {
      segmentPrefetching.delete(target)
    }
  })()
}

function normalizeProxyPath(viteBase: string): string {
  if (viteBase === "/" || viteBase === "") return "/proxy/hls"
  const b = viteBase.replace(/\/$/, "")
  return `${b}/proxy/hls`
}

function rewritePlaylistLine(
  line: string,
  playlistBase: URL,
  proxySelfOrigin: string,
): string {
  const trimmed = line.trim()
  if (!trimmed) return line

  const uriInTag = trimmed.match(/URI="([^"]+)"/)
  if (uriInTag) {
    const inner = uriInTag[1]
    try {
      const u = new URL(inner, playlistBase)
      if (allowedHost(u.hostname)) {
        const proxied = `${proxySelfOrigin}?url=${encodeURIComponent(u.href)}`
        return line.replace(uriInTag[0], `URI="${proxied}"`)
      }
    } catch {
      /* ignore */
    }
  }

  if (trimmed.startsWith("#")) return line

  try {
    const u = new URL(trimmed, playlistBase)
    if (allowedHost(u.hostname)) {
      return `${proxySelfOrigin}?url=${encodeURIComponent(u.href)}`
    }
  } catch {
    /* ignore */
  }

  return line
}

function rewritePlaylist(
  body: string,
  playlistUrl: string,
  proxySelfOrigin: string,
): string {
  const base = new URL(playlistUrl)
  return body
    .split(/\r?\n/)
    .map((line) => rewritePlaylistLine(line, base, proxySelfOrigin))
    .join("\n")
}

function installHlsProxy(
  middlewares: Connect.Server,
  viteBase: string,
): void {
  const basePath = normalizeProxyPath(viteBase)

  middlewares.use((req, res, next) => {
    const rawUrl = req.url ?? ""
    const pathname = rawUrl.split("?")[0].replace(/\/+/g, "/") || "/"
    if (pathname !== basePath && !pathname.endsWith("/proxy/hls")) {
      next()
      return
    }

    const full = new URL(rawUrl, "http://127.0.0.1")
    const target = full.searchParams.get("url")
    if (!target) {
      res.statusCode = 400
      res.setHeader("Content-Type", "text/plain; charset=utf-8")
      res.end("Missing url query parameter")
      return
    }

    let targetUrl: URL
    try {
      targetUrl = new URL(target)
    } catch {
      res.statusCode = 400
      res.end("Invalid url")
      return
    }

    if (!allowedHost(targetUrl.hostname)) {
      res.statusCode = 403
      res.setHeader("Content-Type", "text/plain; charset=utf-8")
      res.end("Proxy: host not allowed")
      return
    }

    if (req.method === "OPTIONS") {
      res.statusCode = 204
      res.setHeader("Access-Control-Allow-Origin", "*")
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS")
      res.setHeader("Access-Control-Allow-Headers", "*")
      res.end()
      return
    }

    if (req.method !== "GET") {
      res.statusCode = 405
      res.end("Method Not Allowed")
      return
    }

    const proto = (req.headers["x-forwarded-proto"] as string) || "http"
    const host = req.headers.host ?? "localhost"
    const proxySelfOrigin = `${proto}://${host}${basePath}`

    const lowerTarget = target.toLowerCase()
    const looksLikeManifest =
      lowerTarget.includes(".m3u8") || lowerTarget.includes(".m3u")

    if (!looksLikeManifest) {
      const cached = segmentCached(target)
      if (cached) {
        res.statusCode = 200
        res.setHeader("Content-Type", cached.contentType)
        res.setHeader("Access-Control-Allow-Origin", "*")
        res.setHeader("Cache-Control", "public, max-age=30")
        res.end(cached.body)
        return
      }
    }

    void (async () => {
      try {
        if (looksLikeManifest) {
          const key = `${proxySelfOrigin}|${target}`
          const fresh = manifestCached(key)
          if (fresh !== null) {
            res.statusCode = 200
            res.setHeader("Content-Type", "application/vnd.apple.mpegurl")
            res.setHeader("Access-Control-Allow-Origin", "*")
            res.setHeader("Cache-Control", "no-cache")
            res.end(fresh)
            return
          }
          // Single-flight: concurrent requests for one playlist share a fetch.
          let pending = manifestInflight.get(key)
          if (!pending) {
            pending = (async () => {
              const r = await fetch(target, {
                headers: upstreamHeaders(targetUrl.hostname),
              })
              if (!r.ok) {
                const err = new Error(String(r.status)) as Error & { status?: number }
                err.status = r.status
                throw err
              }
              const text = await r.text()
              scheduleLiveEdgePrefetch(text, target)
              const rewritten = rewritePlaylist(text, target, proxySelfOrigin)
              manifestCache.set(key, {
                expires: Date.now() + MANIFEST_TTL_MS,
                body: rewritten,
              })
              return rewritten
            })()
            manifestInflight.set(key, pending)
            void pending.catch(() => {}).finally(() => manifestInflight.delete(key))
          }
          const rewritten = await pending
          res.statusCode = 200
          res.setHeader("Content-Type", "application/vnd.apple.mpegurl")
          res.setHeader("Access-Control-Allow-Origin", "*")
          res.setHeader("Cache-Control", "no-cache")
          res.end(rewritten)
          return
        }

        const r = await fetch(target, {
          headers: upstreamHeaders(targetUrl.hostname),
        })
        const ct = r.headers.get("content-type") ?? ""

        if (!r.ok) {
          res.statusCode = r.status
          res.setHeader("Content-Type", "text/plain; charset=utf-8")
          res.setHeader("Access-Control-Allow-Origin", "*")
          res.end(`Upstream error (${r.status})`)
          return
        }

        res.statusCode = 200
        res.setHeader("Content-Type", ct || "application/octet-stream")
        res.setHeader("Access-Control-Allow-Origin", "*")
        res.setHeader("Cache-Control", "public, max-age=30")

        if (!r.body) {
          res.end()
          return
        }

        // Stream the segment through instead of buffering it whole: a 4 MB
        // segment otherwise adds its entire download time to time-to-first-byte.
        // Chunks are accumulated on the side so the next request is a cache hit.
        const chunks: Buffer[] = []
        let total = 0
        let cacheable = true
        const source = Readable.fromWeb(r.body as Parameters<typeof Readable.fromWeb>[0])
        source.on("data", (chunk: Buffer) => {
          if (!cacheable) return
          total += chunk.length
          if (total > SEGMENT_MAX_BYTES) {
            cacheable = false
            chunks.length = 0
            return
          }
          chunks.push(chunk)
        })
        source.on("end", () => {
          if (cacheable && chunks.length) {
            segmentStore(target, ct || "application/octet-stream", Buffer.concat(chunks))
          }
        })
        source.on("error", () => {
          cacheable = false
          res.destroy()
        })
        source.pipe(res)
      } catch (e) {
        const status = (e as { status?: number }).status
        res.statusCode = typeof status === "number" ? status : 502
        res.setHeader("Content-Type", "text/plain; charset=utf-8")
        res.setHeader("Access-Control-Allow-Origin", "*")
        res.end(
          typeof status === "number"
            ? `Upstream error (${status})`
            : e instanceof Error
              ? e.message
              : String(e),
        )
      }
    })()
  })
}

export function hlsProxyPlugin(viteBase: string) {
  return {
    name: "hls-proxy",
    configureServer(server: ViteDevServer) {
      installHlsProxy(server.middlewares, viteBase)
    },
    configurePreviewServer(server: PreviewServer) {
      installHlsProxy(server.middlewares, viteBase)
    },
  }
}
