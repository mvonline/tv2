/**
 * GitHub Pages serves 404.html for unknown paths. Copy the SPA shell so
 * client-side routes work on refresh (same pattern as index.html).
 */
import { copyFileSync, existsSync } from "fs"
import { dirname, join } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const dist = join(__dirname, "..", "dist")
const indexHtml = join(dist, "index.html")
const notFound = join(dist, "404.html")

if (!existsSync(indexHtml)) {
  console.error("spa-404: dist/index.html not found. Run vite build first.")
  process.exit(1)
}
copyFileSync(indexHtml, notFound)
console.log("spa-404: wrote dist/404.html")
