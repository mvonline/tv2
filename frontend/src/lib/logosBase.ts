/**
 * Optional URL prefix for every relative `channel.logo` path from channels.json (`channelLogoUrl`).
 *
 * Priority:
 * 1. `VITE_LOGOS_BASE_URL` (build-time / local `.env`)
 * 2. `GET /api/config` → `logos_base_url` from backend `LOGOS_BASE_URL` (runtime, same as categories API base)
 */

let resolved = ""

export async function initLogosBase(): Promise<void> {
  const vite = import.meta.env.VITE_LOGOS_BASE_URL?.trim()
  if (vite) {
    resolved = vite.replace(/\/$/, "")
    return
  }

  const api = import.meta.env.VITE_API_BASE?.trim().replace(/\/$/, "") ?? ""
  const url = api ? `${api}/api/config` : "/api/config"
  try {
    const r = await fetch(url, { cache: "no-store" })
    if (!r.ok) return
    const j = (await r.json()) as { logos_base_url?: string }
    resolved = (j.logos_base_url ?? "").trim().replace(/\/$/, "")
  } catch {
    /* same-origin static hosts have no API */
  }
}

/** Effective logos origin without trailing slash; empty = use `publicUrl` default (BASE_URL). */
export function logosBase(): string {
  return resolved
}
