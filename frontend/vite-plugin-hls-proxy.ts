import { gzipSync } from "node:zlib"
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
/** Past the fresh window, serve the old body and refresh behind the response. */
const MANIFEST_STALE_MS = 5000
/** hls.js buffers liveSyncDurationCount segments before playing. */
const PREFETCH_SEGMENTS = 2
/** Keep recently watched channels' sockets and playlists warm. */
const WARM_INTERVAL_MS = 45_000
const WARM_IDLE_EVICT_MS = 300_000
const WARM_MAX_CHANNELS = 8
const SEGMENT_TTL_MS = 60_000
const SEGMENT_MAX_BYTES = 8 * 1024 * 1024
const SEGMENT_CACHE_MAX_BYTES = 192 * 1024 * 1024

/**
 * Nimble mints a fresh ?nimblesessionid= per master fetch and embeds it in every
 * media-playlist and segment URL, while the bytes behind them are identical
 * between sessions. Keying on the raw URL therefore produced a key unique per
 * viewer per reload — the cache never hit for anyone but whoever filled it.
 * Keys drop these params; upstream still gets the original URL for segments,
 * which 404 without a session id.
 */
const VOLATILE_QUERY_PARAMS = new Set(["nimblesessionid"])

/** Upstream said the resource is not there; retrying cannot help. */
const PERMANENT_STATUSES = new Set([400, 401, 403, 404, 410, 451])

function cacheKey(url: string): string {
  try {
    const u = new URL(url)
    for (const name of [...u.searchParams.keys()]) {
      if (VOLATILE_QUERY_PARAMS.has(name.toLowerCase())) u.searchParams.delete(name)
    }
    return u.href
  } catch {
    return url
  }
}

type ManifestEntry = { fresh: number; stale: number; body: string; resolved: string }
type SegmentEntry = { expires: number; contentType: string; body: Buffer }

const manifestCache = new Map<string, ManifestEntry>()
const manifestInflight = new Map<string, Promise<string>>()
const segmentCache = new Map<string, SegmentEntry>()
const segmentPrefetching = new Set<string>()
let segmentCacheBytes = 0

function manifestCached(key: string): { entry: ManifestEntry; fresh: boolean } | null {
  const hit = manifestCache.get(key)
  if (!hit) return null
  const now = Date.now()
  if (now <= hit.fresh) return { entry: hit, fresh: true }
  if (now <= hit.stale) return { entry: hit, fresh: false }
  manifestCache.delete(key)
  return null
}

function manifestStore(url: string, body: string, resolved: string): void {
  const now = Date.now()
  manifestCache.set(cacheKey(url), {
    fresh: now + MANIFEST_TTL_MS,
    stale: now + MANIFEST_STALE_MS,
    body,
    resolved,
  })
}

/**
 * A segment 404 usually means the session id baked into the playlist we served
 * has aged out. Drop that directory's playlists so the next request mints a
 * fresh one instead of handing out the same dead URLs.
 */
function invalidateManifestsFor(segmentUrl: string): void {
  const prefix = cacheKey(segmentUrl).replace(/\/[^/]*$/, "")
  for (const key of [...manifestCache.keys()]) {
    if (key.startsWith(prefix)) manifestCache.delete(key)
  }
}

/**
 * Fetch a playlist and cache it. Session params are dropped on the way out:
 * chunks.m3u8 serves fine without one, so all viewers share one canonical fetch.
 */
async function fetchUpstreamManifest(
  url: string,
  { prefetchSegments = true }: { prefetchSegments?: boolean } = {},
): Promise<ManifestEntry> {
  const canonical = cacheKey(url)
  const r = await fetch(canonical, {
    headers: upstreamHeaders(new URL(url).hostname),
  })
  if (!r.ok) {
    const err = new Error(String(r.status)) as Error & { status?: number }
    err.status = r.status
    throw err
  }
  const body = await r.text()
  manifestStore(url, body, canonical)
  scheduleLiveEdgePrefetch(body, canonical, prefetchSegments)
  return { fresh: 0, stale: 0, body, resolved: canonical }
}

// ── keeping recently watched channels warm ──────────────────────────────────
// A cold TLS handshake to the CDN measured 170-2800 ms versus ~100 ms pooled, so
// recently requested playlists are re-fetched periodically to hold the socket.
const warmTargets = new Map<string, number>()
let warmTimer: ReturnType<typeof setInterval> | null = null

function noteWarmTarget(url: string): void {
  const key = cacheKey(url)
  warmTargets.delete(key)
  warmTargets.set(key, Date.now())
  while (warmTargets.size > WARM_MAX_CHANNELS) {
    const oldest = warmTargets.keys().next()
    if (oldest.done) break
    warmTargets.delete(oldest.value)
  }
  if (warmTimer) return
  warmTimer = setInterval(() => {
    const now = Date.now()
    for (const [target, lastSeen] of [...warmTargets]) {
      if (now - lastSeen > WARM_IDLE_EVICT_MS) {
        warmTargets.delete(target)
        continue
      }
      // Playlists only — see scheduleLiveEdgePrefetch on why the warm loop must
      // never pull segments.
      void fetchUpstreamManifest(target, { prefetchSegments: false }).catch(() => {})
    }
    if (warmTargets.size === 0 && warmTimer) {
      clearInterval(warmTimer)
      warmTimer = null
    }
  }, WARM_INTERVAL_MS)
  // Do not hold the dev server open on this timer.
  warmTimer.unref?.()
}

function segmentCached(rawUrl: string): SegmentEntry | null {
  const url = cacheKey(rawUrl)
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

function segmentStore(rawUrl: string, contentType: string, body: Buffer): void {
  if (body.length > SEGMENT_MAX_BYTES) return
  const url = cacheKey(rawUrl)
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
/**
 * `prefetchSegments = false` warms playlists only. The warm-keep loop must use
 * it: at the measured 2.08 Mbps mean bitrate a segment is ~2.6 MB, so pulling two
 * per channel every 45 s across 8 idle channels burns ~7.4 Mbps for streams
 * nobody is watching. Playlists alone cost ~44 B/s.
 */
function scheduleLiveEdgePrefetch(
  body: string,
  playlistUrl: string,
  prefetchSegments = true,
): void {
  const entries = playlistEntries(body, playlistUrl)
  const last = entries[entries.length - 1]
  if (!last) return

  if (last.toLowerCase().includes(".m3u")) {
    // Master playlist: entries are playlists. Fetching the variant now turns the
    // player's next request — an unavoidable round trip before any media
    // arrives — into a cache hit.
    if (!manifestCached(cacheKey(last))) {
      void fetchUpstreamManifest(last, { prefetchSegments }).catch(() => {})
    }
    return
  }

  if (!prefetchSegments) return

  for (const target of entries.slice(-PREFETCH_SEGMENTS)) {
    const key = cacheKey(target)
    if (segmentPrefetching.has(key) || segmentCached(target)) continue
    segmentPrefetching.add(key)
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
        segmentPrefetching.delete(key)
      }
    })()
  }
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

/**
 * Playlists are text and compress ~2:1 (a 317 B media playlist gzips to 156 B).
 * Segments are NOT compressed and must not be: already-encoded H.264/AAC in
 * MPEG-TS measured a 1.9% saving for ~50 ms of CPU per segment, and compressing
 * them would force buffering each one whole instead of streaming it through.
 * Below the floor, gzip's header costs more than it saves (a 162 B master
 * playlist grew to 168 B).
 */
const GZIP_MIN_BYTES = 256

function sendPlaylist(
  res: Parameters<Connect.NextHandleFunction>[1],
  text: string,
  acceptEncoding: string,
): void {
  res.statusCode = 200
  res.setHeader("Content-Type", "application/vnd.apple.mpegurl")
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Cache-Control", "no-cache")
  res.setHeader("Vary", "Accept-Encoding")
  const raw = Buffer.from(text, "utf-8")
  if (raw.length >= GZIP_MIN_BYTES && acceptEncoding.toLowerCase().includes("gzip")) {
    const packed = gzipSync(raw, { level: 1 })
    if (packed.length < raw.length) {
      res.setHeader("Content-Encoding", "gzip")
      res.end(packed)
      return
    }
  }
  res.end(raw)
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

    const acceptEncoding = (req.headers["accept-encoding"] as string) ?? ""
    if (looksLikeManifest) noteWarmTarget(target)

    void (async () => {
      try {
        if (looksLikeManifest) {
          const key = cacheKey(target)
          const hit = manifestCached(key)
          if (hit) {
            if (!hit.fresh && !manifestInflight.has(key)) {
              // Serve now, refresh behind the response.
              const refresh = fetchUpstreamManifest(target).then((e) => e.body)
              manifestInflight.set(key, refresh)
              void refresh.catch(() => {}).finally(() => manifestInflight.delete(key))
            }
            sendPlaylist(
              res,
              rewritePlaylist(hit.entry.body, hit.entry.resolved, proxySelfOrigin),
              acceptEncoding,
            )
            return
          }
          // Single-flight: concurrent requests for one playlist share a fetch.
          let pending = manifestInflight.get(key)
          if (!pending) {
            pending = fetchUpstreamManifest(target).then((e) => e.body)
            manifestInflight.set(key, pending)
            void pending.catch(() => {}).finally(() => manifestInflight.delete(key))
          }
          const body = await pending
          sendPlaylist(
            res,
            rewritePlaylist(body, cacheKey(target), proxySelfOrigin),
            acceptEncoding,
          )
          return
        }

        const r = await fetch(target, {
          headers: upstreamHeaders(targetUrl.hostname),
        })
        const ct = r.headers.get("content-type") ?? ""

        if (!r.ok) {
          if (PERMANENT_STATUSES.has(r.status)) invalidateManifestsFor(target)
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
