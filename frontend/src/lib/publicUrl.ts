import { logosBase } from "@/lib/logosBase"

/** Resolve a public asset path for GitHub Pages (`base`) and local dev. */
export function publicUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path

  const p = path.replace(/^\//, "")
  const lb = logosBase()
  if (lb && p.startsWith("logo/")) {
    return `${lb}/${p}`
  }

  const base = import.meta.env.BASE_URL
  return `${base}${p}`
}
