/**
 * Generate sitemap.xml and robots.txt from the channel list.
 *
 * Two callers, one generator:
 *   - the scrape workflow, right after channels.json changes, writing into
 *     frontend/public/ so the sitemap is committed in the same commit as the
 *     channels it describes (`--channels ../backend/data/channels.json
 *     --out public`);
 *   - `npm run build`, from the channels.json already copied into dist/, so the
 *     deployed sitemap always matches the deployed channel list. Vite copies
 *     public/ into dist/ first and this overwrites it, so the build output is
 *     authoritative and the committed copy is the reviewable record.
 *
 * Usage:
 *   node scripts/sitemap.mjs [--channels <path>] [--out <dir>]
 *
 * Env:
 *   SITE_URL   Absolute origin (+ optional sub-path) the site is served from,
 *              e.g. https://user.github.io/tv2/. Optional; see resolveSite().
 *   VITE_BASE  Base path the app is served under. Optional; derived from the
 *              repository name on GitHub Actions.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { dirname, join, resolve } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const frontend = join(__dirname, "..")

function flag(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const channelsJson = resolve(frontend, flag("channels", join("dist", "data", "channels.json")))
const outDir = resolve(frontend, flag("out", "dist"))

if (!existsSync(channelsJson)) {
  console.error(`sitemap: ${channelsJson} not found.`)
  process.exit(1)
}
mkdirSync(outDir, { recursive: true })

/** Repo name / owner, available in every GitHub Actions run. */
const [ghOwner = "", ghRepo = ""] = (process.env.GITHUB_REPOSITORY || "").split("/")
const isUserSite = ghRepo.toLowerCase().endsWith(".github.io")

const cnamePath = join(frontend, "public", "CNAME")
const customDomain = existsSync(cnamePath)
  ? readFileSync(cnamePath, "utf-8").trim()
  : ""

/**
 * Base path, matching the deploy workflow: a custom domain and a user/org site
 * serve from the root, a project site from /<repo>/. The CNAME check must come
 * first — the scrape workflow runs this without VITE_BASE, and deriving /<repo>/
 * there would emit https://custom.domain/<repo>/... URLs.
 */
function resolveBase() {
  const explicit = (process.env.VITE_BASE || "").trim()
  if (explicit) return explicit.endsWith("/") ? explicit : `${explicit}/`
  if (customDomain) return "/"
  if (ghRepo && !isUserSite) return `/${ghRepo}/`
  return "/"
}

const basePath = resolveBase()

/**
 * Site root, in precedence order:
 *   1. SITE_URL (a repository variable lets you pin a custom domain)
 *   2. public/CNAME, if a custom domain is configured
 *   3. the GitHub Pages hostname derived from GITHUB_REPOSITORY
 *   4. "" — root-relative output, for a local run outside CI
 */
function resolveSite() {
  const explicit = (process.env.SITE_URL || "").trim()
  if (explicit) return withBase(explicit)

  if (customDomain) return withBase(customDomain)

  if (ghOwner && ghRepo) {
    // Pages hostnames are lowercase regardless of how the owner is spelled.
    const host = isUserSite ? ghRepo.toLowerCase() : `${ghOwner.toLowerCase()}.github.io`
    return withBase(`https://${host}`)
  }
  return ""
}

/** Origin + base path, with exactly one trailing slash. */
function withBase(raw) {
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  const u = new URL(withScheme)
  // A URL that already carries the base path must not get it twice.
  const path = u.pathname.endsWith("/") ? u.pathname : `${u.pathname}/`
  const merged = path === "/" ? basePath : path
  return `${u.origin}${merged}`
}

const root = resolveSite()
if (!root) {
  // Search Console rejects every entry of a relative sitemap ("Invalid URL"), and
  // a warning here already shipped one. In CI that is a build failure; locally it
  // stays a warning so `npm run build` works without configuration.
  const message =
    "sitemap: cannot resolve the site URL. Set SITE_URL, add frontend/public/CNAME, " +
    "or run inside GitHub Actions. Sitemaps require absolute URLs."
  if (process.env.CI || process.env.GITHUB_ACTIONS) {
    console.error(message)
    process.exit(1)
  }
  console.warn(`${message} Emitting root-relative URLs for local inspection only.`)
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

// Date only: a full timestamp would rewrite every <lastmod> on each scrape and
// make the committed sitemap churn even when no channel changed.
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

const sitemapPath = join(outDir, "sitemap.xml")

/**
 * Keep the existing file when only <lastmod> would change. The scrape workflow
 * commits this file, and a date-only rewrite would otherwise produce a commit —
 * and a deploy — every day even when no channel changed.
 */
function unchangedApartFromLastmod(next, path) {
  if (!existsSync(path)) return false
  const strip = (t) => t.replace(/<lastmod>[^<]*<\/lastmod>/g, "<lastmod/>")
  return strip(readFileSync(path, "utf-8")) === strip(next)
}

const kept = unchangedApartFromLastmod(xml, sitemapPath)
if (!kept) writeFileSync(sitemapPath, xml, "utf-8")

const robots =
  `User-agent: *\n` +
  `Allow: /\n` +
  `\n` +
  `# The HLS proxy is not content; crawling it would pull video segments.\n` +
  `Disallow: ${basePath}proxy/\n` +
  `\n` +
  `Sitemap: ${loc("sitemap.xml")}\n`

writeFileSync(join(outDir, "robots.txt"), robots, "utf-8")

const skipped = channels.length - playable.length
const where = outDir.replace(`${frontend}/`, "")
console.log(
  `sitemap: ${kept ? "kept" : "wrote"} ${where}/sitemap.xml (${unique.length} urls` +
    `${skipped > 0 ? `, ${skipped} channels skipped as unplayable` : ""}) ` +
    `and ${where}/robots.txt${root ? ` at ${root}` : " [relative]"}`,
)
