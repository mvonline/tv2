/**
 * Optional URL prefix for every relative `channel.logo` path from channels.json (`channelLogoUrl`).
 *
 * Priority for `logosBase()`:
 * 1. `VITE_LOGOS_BASE_URL` or `LOGOS_BASE_URL` in `frontend/.env` (loaded by Vite into `import.meta.env`)
 * 2. `GET /api/config` → `logos_base_url` (backend `LOGOS_BASE_URL`) — filled in `initLogosBase` when no env set
 */

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

export async function initLogosBase(): Promise<void> {
  if (logosBaseFromEnv()) return

  const api = import.meta.env.VITE_API_BASE?.trim().replace(/\/$/, "") ?? ""
  const url = api ? `${api}/api/config` : "/api/config"
  try {
    const r = await fetch(url, { cache: "no-store" })
    if (!r.ok) return
    const j = (await r.json()) as { logos_base_url?: string }
    resolved = normalizeBase(j.logos_base_url ?? "")
  } catch {
    /* same-origin static hosts have no API */
  }
}

/** Effective logos origin without trailing slash; empty = use `channelLogoUrl` fallback (`BASE_URL`). */
export function logosBase(): string {
  const fromEnv = logosBaseFromEnv()
  if (fromEnv) return fromEnv
  return resolved
}
