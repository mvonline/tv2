/** Resolve a public asset path for GitHub Pages (`base`) and local dev. */
export function publicUrl(path: string): string {
  const base = import.meta.env.BASE_URL
  const p = path.replace(/^\//, "")
  return `${base}${p}`
}
