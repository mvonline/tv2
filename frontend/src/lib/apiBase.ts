/**
 * Optional backend access.
 *
 * The app ships in two shapes: with a backend on the same origin (Docker, dev
 * server) and as pure static files with no backend at all (GitHub Pages). The
 * static deployment used to fire four doomed requests on every home-page load —
 * /api/config, /api/featured-channels, /api/categories, /api/channel-config —
 * each a 404 round trip competing with real assets and a console error in
 * Lighthouse's "browser errors" audit.
 *
 * Set `VITE_HAS_API=false` at build time for a backend-less deployment and every
 * optional call short-circuits. Left unset, behaviour is unchanged: calls are
 * attempted and failures fall back, so Docker and dev need no configuration.
 */

/** Origin for API calls; empty means same-origin. */
export function apiBase(): string {
  return (import.meta.env.VITE_API_BASE ?? "").trim().replace(/\/$/, "")
}

/** False only when the build explicitly declares there is no backend. */
export function apiEnabled(): boolean {
  return String(import.meta.env.VITE_HAS_API ?? "").trim().toLowerCase() !== "false"
}

export function apiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`
  return `${apiBase()}${p}`
}

/** Fire-and-forget POST to an optional endpoint; a no-op without a backend. */
export function apiPostJson(path: string, body: unknown): void {
  if (!apiEnabled()) return
  void fetch(apiUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => {
    /* analytics is best-effort */
  })
}

/**
 * GET JSON from an optional endpoint. Returns null when there is no backend, the
 * response is not ok, or the body is not JSON — every caller of these endpoints
 * has a working fallback.
 */
export async function apiGetJson<T>(path: string): Promise<T | null> {
  if (!apiEnabled()) return null
  try {
    const res = await fetch(apiUrl(path), { cache: "no-store" })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}
