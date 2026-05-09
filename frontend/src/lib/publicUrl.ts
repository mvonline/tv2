import { logosBase } from "@/lib/logosBase"

/** Resolve a public asset path for GitHub Pages (`base`) and local dev (not channel logos). */
export function publicUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path
  const p = path.replace(/^\//, "")
  const base = import.meta.env.BASE_URL
  return `${base}${p}`
}

/**
 * Resolve `channel.logo` from channels.json: prepend logos base (backend `LOGOS_BASE_URL` /
 * `GET /api/config`, or `VITE_LOGOS_BASE_URL`) for relative paths.
 */
export function channelLogoUrl(logo: string | null | undefined): string | null {
  if (logo == null) return null
  const s = logo.trim()
  if (!s) return null
  if (/^https?:\/\//i.test(s)) return s

  const p = s.replace(/^\/+/, "")
  const lb = logosBase().replace(/\/$/, "")
  if (lb) return `${lb}/${p}`

  const base = import.meta.env.BASE_URL
  return `${base}${p}`
}
