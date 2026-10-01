/**
 * Edge HLS proxy for streams the operator is authorized to redistribute.
 *
 * Playlists are rewritten through this Worker. Immutable media segments use
 * Cloudflare's Cache API, keyed without Nimble's volatile session id while the
 * original session-bearing URL is still used for the upstream request.
 */

const ALLOWED_SUFFIXES = [".hls2.xyz", ".presstv.ir", ".telewebion.ir"]
const VOLATILE_QUERY_PARAMS = new Set(["nimblesessionid"])

const BASE_UPSTREAM_HEADERS = {
  Accept: "*/*",
  "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Sec-Fetch-Site": "cross-site",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Dest": "empty",
  DNT: "1",
}

export function allowedHost(hostname) {
  const host = hostname.toLowerCase()
  return ALLOWED_SUFFIXES.some((suffix) => host.endsWith(suffix))
}

export function stripVolatileQuery(rawUrl) {
  const url = new URL(rawUrl)
  for (const key of [...url.searchParams.keys()]) {
    if (VOLATILE_QUERY_PARAMS.has(key.toLowerCase())) {
      url.searchParams.delete(key)
    }
  }
  return url.toString()
}

function upstreamHeaders(hostname, range) {
  const telewebion =
    hostname === "telewebion.ir" || hostname.endsWith(".telewebion.ir")
  const embedder = telewebion
    ? "https://www.telewebion.com"
    : "https://www.aparatchii.com"
  const headers = new Headers(BASE_UPSTREAM_HEADERS)
  headers.set("Origin", embedder)
  headers.set("Referer", `${embedder}/`)
  if (range) headers.set("Range", range)
  return headers
}

function proxyUrl(target, incomingUrl) {
  const proxy = new URL(incomingUrl)
  proxy.search = ""
  proxy.hash = ""
  proxy.searchParams.set("url", target)
  return proxy.toString()
}

function rewriteLine(line, playlistUrl, incomingUrl) {
  const trimmed = line.trim()
  if (!trimmed) return line

  const uriMatch = trimmed.match(/URI="([^"]+)"/)
  if (uriMatch) {
    try {
      const absolute = new URL(uriMatch[1], playlistUrl)
      if (allowedHost(absolute.hostname)) {
        return trimmed.replace(
          uriMatch[0],
          `URI="${proxyUrl(absolute.toString(), incomingUrl)}"`,
        )
      }
    } catch {
      return line
    }
  }

  if (trimmed.startsWith("#")) return line
  try {
    const absolute = new URL(trimmed, playlistUrl)
    if (allowedHost(absolute.hostname)) {
      return proxyUrl(absolute.toString(), incomingUrl)
    }
  } catch {
    return line
  }
  return line
}

export function rewritePlaylist(body, playlistUrl, incomingUrl) {
  return body
    .split(/\r?\n/)
    .map((line) => rewriteLine(line, playlistUrl, incomingUrl))
    .join("\n")
}

function corsHeaders(contentType, cacheControl) {
  return new Headers({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Range",
    "Content-Type": contentType,
    "Cache-Control": cacheControl,
  })
}

function copyRepresentationHeaders(from, to) {
  for (const name of [
    "accept-ranges",
    "content-encoding",
    "content-length",
    "content-range",
    "etag",
    "last-modified",
  ]) {
    const value = from.get(name)
    if (value) to.set(name, value)
  }
}

function upstreamError(status) {
  const permanent = [400, 401, 403, 404, 410, 451].includes(status)
  return new Response(
    `${permanent ? "Channel unavailable upstream" : "Upstream error"} (${status})`,
    {
      status,
      headers: corsHeaders("text/plain; charset=utf-8", "no-store"),
    },
  )
}

async function fetchAllowed(target, range) {
  let current = new URL(target)
  for (let redirects = 0; redirects <= 4; redirects += 1) {
    const response = await fetch(current.toString(), {
      headers: upstreamHeaders(current.hostname, range),
      redirect: "manual",
    })
    if (response.status < 300 || response.status >= 400) return response

    const location = response.headers.get("location")
    if (!location) return response
    const next = new URL(location, current)
    if (
      !["http:", "https:"].includes(next.protocol) ||
      next.username ||
      next.password ||
      !allowedHost(next.hostname)
    ) {
      throw new Error("Upstream redirected outside the host allowlist")
    }
    current = next
  }
  throw new Error("Too many upstream redirects")
}

async function proxyManifest(target, request) {
  const upstream = await fetchAllowed(target)
  if (!upstream.ok) return upstreamError(upstream.status)

  const body = await upstream.text()
  const resolvedUrl = upstream.url || target.toString()
  return new Response(rewritePlaylist(body, resolvedUrl, request.url), {
    headers: corsHeaders("application/vnd.apple.mpegurl", "no-cache"),
  })
}

function segmentCacheKey(target, request) {
  const key = new URL(request.url)
  key.search = ""
  key.hash = ""
  key.searchParams.set("url", stripVolatileQuery(target.toString()))
  return new Request(key.toString(), { method: "GET" })
}

async function proxySegment(target, request, context) {
  const range = request.headers.get("Range")
  const cacheKey = segmentCacheKey(target, request)

  if (!range) {
    const cached = await caches.default.match(cacheKey)
    if (cached) return cached
  }

  const upstream = await fetchAllowed(target, range)
  if (!upstream.ok && upstream.status !== 206) {
    return upstreamError(upstream.status)
  }

  const headers = corsHeaders(
    upstream.headers.get("content-type") || "application/octet-stream",
    range ? "no-store" : "public, max-age=30, s-maxage=60",
  )
  copyRepresentationHeaders(upstream.headers, headers)
  const response = new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  })

  if (!range && upstream.status === 200) {
    context.waitUntil(caches.default.put(cacheKey, response.clone()))
  }
  return response
}

export default {
  async fetch(request, _environment, context) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders("text/plain", "no-store"),
      })
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405 })
    }

    const incoming = new URL(request.url)
    if (incoming.pathname === "/healthz") {
      return Response.json({ status: "ok" })
    }
    const rawTarget = incoming.searchParams.get("url")
    if (!rawTarget) {
      return new Response("Missing url query parameter", { status: 400 })
    }

    let target
    try {
      target = new URL(rawTarget)
    } catch {
      return new Response("Invalid url", { status: 400 })
    }
    if (
      !["http:", "https:"].includes(target.protocol) ||
      target.username ||
      target.password ||
      !allowedHost(target.hostname)
    ) {
      return new Response("Host not allowed", { status: 403 })
    }

    try {
      const lowerPath = target.pathname.toLowerCase()
      const manifest = lowerPath.includes(".m3u8") || lowerPath.endsWith(".m3u")
      const response = manifest
        ? await proxyManifest(target, request)
        : await proxySegment(target, request, context)
      return request.method === "HEAD"
        ? new Response(null, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          })
        : response
    } catch {
      return new Response("Upstream unreachable", {
        status: 504,
        headers: corsHeaders("text/plain; charset=utf-8", "no-store"),
      })
    }
  },
}
