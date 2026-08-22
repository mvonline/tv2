/**
 * Generate dist/sitemap.xml and dist/robots.txt after a build.
 *
 * Runs at build time, from the very channels.json that was just copied into
 * dist/, so the sitemap can never disagree with the channel list that shipped
 * with it. The GitHub Pages deploy is triggered by changes to
 * backend/data/channels.json, so a scrape that adds or drops channels produces a
 * matching sitemap on the next deploy without a separate step.
 *
 * Env:
 *   SITE_URL  Absolute origin (+ optional sub-path) the site is served from,
 *             e.g. https://user.github.io/tv2/. Falls back to VITE_BASE only,
 *             which yields a relative-rooted sitemap — valid for inspection but
 *             search engines want absolute URLs, so set SITE_URL in CI.
 */
import { readFileSync, writeFileSync, existsSync } from "fs"
import { dirname, join } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const dist = join(__dirname, "..", "dist")
const channelsJson = join(dist, "data", "channels.json")

if (!existsSync(channelsJson)) {
  console.error(`sitemap: ${channelsJson} not found. Run vite build first.`)
  process.exit(1)
}

const rawBase = process.env.VITE_BASE || "/"
const basePath = rawBase.endsWith("/") ? rawBase : `${rawBase}/`

/** Origin + base path, with exactly one trailing slash, or "" when unknown. */
function siteRoot() {
  const raw = (process.env.SITE_URL || "").trim()
  if (!raw) return ""
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  const u = new URL(withScheme)
  // A SITE_URL that already carries the base path must not get it twice.
  const path = u.pathname.endsWith("/") ? u.pathname : `${u.pathname}/`
  const merged = path === "/" ? basePath : path
  return `${u.origin}${merged}`
}

const root = siteRoot()
if (!root) {
  console.warn(
    "sitemap: SITE_URL is unset — emitting root-relative URLs. Search engines " +
      "require absolute ones; set SITE_URL in the deploy workflow.",
  )
}

/** Absolute (or root-relative) URL for an in-app route like "watch/foo". */
function loc(route) {
  const clean = route.replace(/^\//, "")
  return root ? `${root}${clean}` : `${basePath}${clean}`
}

function channelPathFromPageUrl(pageUrl) {
  try {
    return new URL(pageUrl).pathname.replace(/\/$/, "") || "/"
  } catch {
    return "/"
  }
}

/** Must match watchUrlForChannel in src/lib/paths.ts. */
function watchRoute(channel) {
  const p = channelPathFromPageUrl(channel.page_url).replace(/^\//, "")
  return `watch/${encodeURIComponent(p)}`
}

function xmlEscape(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

const parsed = JSON.parse(readFileSync(channelsJson, "utf-8"))
const channels = Array.isArray(parsed) ? parsed : (parsed.channels ?? [])

// Channels without a stream are dead ends for a visitor arriving from search.
const playable = channels.filter(
  (c) => c && c.page_url && (c.stream_url || c.raw_iframe_src),
)

const lastmod = new Date().toISOString().slice(0, 10)

const entries = [
  { route: "", changefreq: "daily", priority: "1.0" },
  { route: "multiview", changefreq: "weekly", priority: "0.5" },
  ...playable.map((c) => ({
    route: watchRoute(c),
    changefreq: "daily",
    priority: "0.7",
  })),
]

// De-duplicate: several channels can share a slug path after normalisation.
const seen = new Set()
const unique = entries.filter((e) => {
  if (seen.has(e.route)) return false
  seen.add(e.route)
  return true
})

const body = unique
  .map(
    (e) =>
      `  <url>\n` +
      `    <loc>${xmlEscape(loc(e.route))}</loc>\n` +
      `    <lastmod>${lastmod}</lastmod>\n` +
      `    <changefreq>${e.changefreq}</changefreq>\n` +
      `    <priority>${e.priority}</priority>\n` +
      `  </url>`,
  )
  .join("\n")

const xml =
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  `${body}\n` +
  `</urlset>\n`

writeFileSync(join(dist, "sitemap.xml"), xml, "utf-8")

const robots =
  `User-agent: *\n` +
  `Allow: /\n` +
  `\n` +
  `# The HLS proxy is not content; crawling it would pull video segments.\n` +
  `Disallow: ${basePath}proxy/\n` +
  `\n` +
  `Sitemap: ${loc("sitemap.xml")}\n`

writeFileSync(join(dist, "robots.txt"), robots, "utf-8")

const skipped = channels.length - playable.length
console.log(
  `sitemap: wrote dist/sitemap.xml (${unique.length} urls` +
    `${skipped > 0 ? `, ${skipped} channels skipped as unplayable` : ""}) ` +
    `and dist/robots.txt${root ? "" : " [relative]"}`,
)
