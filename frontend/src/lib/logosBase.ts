/**
 * Optional URL prefix for every relative `channel.logo` path from channels.json (`channelLogoUrl`).
 *
 * Priority for `logosBase()`:
 * 1. `VITE_LOGOS_BASE_URL` or `LOGOS_BASE_URL` in `frontend/.env` (loaded by Vite into `import.meta.env`)
 * 2. `GET /api/config` → `logos_base_url` (backend `LOGOS_BASE_URL`) — filled in `initLogosBase` when no env set
 */

import { apiGetJson } from "@/lib/apiBase"

let resolved = ""

function normalizeBase(raw: string): string {
  return raw.trim().replace(/\/$/, "")
}

/** Same-origin .env values (must use `VITE_LOGOS_BASE_URL` or `LOGOS_*` — see `vite.config` envPrefix). */
function logosBaseFromEnv(): string {
  const vite = normalizeBase(import.meta.env.VITE_LOGOS_BASE_URL ?? "")
  if (vite) return vite
  return normalizeBase(import.meta.env.LOGOS_BASE_URL ?? "")
}

/**
 * Resolve the logos base from the API. Returns true when it produced a value the
 * first render did not have, so the caller can re-render.
 *
 * This must never gate the first paint: static hosts have no /api/config, so
 * awaiting it before rendering spent a whole round trip (measured 375 ms against
 * the deployed site, which 404s) on a blank screen.
 */
export async function initLogosBase(): Promise<boolean> {
  if (logosBaseFromEnv()) return false

  const config = await apiGetJson<{ logos_base_url?: string }>("/api/config")
  const next = normalizeBase(config?.logos_base_url ?? "")
  if (!next || next === resolved) return false
  resolved = next
  return true
}

/** Effective logos origin without trailing slash; empty = use `channelLogoUrl` fallback (`BASE_URL`). */
export function logosBase(): string {
  const fromEnv = logosBaseFromEnv()
  if (fromEnv) return fromEnv
  return resolved
}
