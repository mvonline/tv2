import type { Connect, PreviewServer, ViteDevServer } from "vite"

/** Same allowlist as backend `stream_requires_proxy` (gg.*). */
function allowedHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  return h.startsWith("gg.") || h.startsWith("www.gg.")
}

/** Nimble/CDN expects embedder Origin + Referer (same as aparatchi.com in the browser). */
const UPSTREAM_HEADERS: Record<string, string> = {
  Referer: "https://www.aparatchi.com/",
  Origin: "https://www.aparatchi.com",
  Accept: "*/*",
  "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Sec-Fetch-Site": "cross-site",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Dest": "empty",
  DNT: "1",
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

    void (async () => {
      try {
        const r = await fetch(target, { headers: UPSTREAM_HEADERS })
        const ct = r.headers.get("content-type") ?? ""
        const lowerTarget = target.toLowerCase()
        const isM3u8 =
          lowerTarget.includes(".m3u8") ||
          ct.includes("mpegurl") ||
          ct.includes("m3u")

        if (!r.ok) {
          res.statusCode = r.status
          res.setHeader("Access-Control-Allow-Origin", "*")
          const t = await r.text()
          res.end(t)
          return
        }

        if (isM3u8) {
          const text = await r.text()
          const rewritten = rewritePlaylist(text, target, proxySelfOrigin)
          res.statusCode = 200
          res.setHeader("Content-Type", "application/vnd.apple.mpegurl")
          res.setHeader("Access-Control-Allow-Origin", "*")
          res.setHeader("Cache-Control", "no-cache")
          res.end(rewritten)
          return
        }

        const buf = await r.arrayBuffer()
        res.statusCode = 200
        res.setHeader(
          "Content-Type",
          ct || "application/octet-stream",
        )
        res.setHeader("Access-Control-Allow-Origin", "*")
        res.setHeader("Cache-Control", "public, max-age=30")
        res.end(Buffer.from(buf))
      } catch (e) {
        res.statusCode = 502
        res.setHeader("Content-Type", "text/plain; charset=utf-8")
        res.setHeader("Access-Control-Allow-Origin", "*")
        res.end(e instanceof Error ? e.message : String(e))
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
