/**
 * gg.hls2.xyz returns 403 unless requests use the embedder Origin + Referer (aparatchi.com),
 * same as the main site — applies to playlists, sub-playlists (e.g. chunks.m3u8), and .ts segments.
 * Browser requests send the app origin (localhost / GitHub Pages) → blocked.
 * Route HLS through /proxy/hls (Vite dev/preview middleware or external server) which
 * rewrites Referer and rewrites playlist URLs to stay on the proxy.
 *
 * Set `VITE_HLS_PROXY_BASE` to a full URL (e.g. your deployed FastAPI `hls_proxy.py`)
 * when the app is static-only (GitHub Pages) so playlists hit a real server.
 */
export function hlsPlaybackUrl(
  streamUrl: string | null,
  requiresProxy: boolean,
  streamType: string | null,
): string | null {
  if (!streamUrl) return null
  const lower = streamUrl.toLowerCase()
  const isHls =
    streamType === "hls" ||
    lower.includes(".m3u8") ||
    lower.includes("playlist.m3u")
  if (!requiresProxy || !isHls) return streamUrl

  const external = import.meta.env.VITE_HLS_PROXY_BASE?.trim()
  if (external) {
    const sep = external.includes("?") ? "&" : "?"
    return `${external}${sep}url=${encodeURIComponent(streamUrl)}`
  }

  if (typeof window === "undefined") return streamUrl
  const base = import.meta.env.BASE_URL || "/"
  const prefix = base === "/" ? "" : base.replace(/\/$/, "")
  const path = `${prefix}/proxy/hls`.replace(/\/+/g, "/")
  return `${window.location.origin}${path}?url=${encodeURIComponent(streamUrl)}`
}
