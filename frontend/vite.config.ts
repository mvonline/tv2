import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import legacy from "@vitejs/plugin-legacy"
import react from "@vitejs/plugin-react"
import type { ViteDevServer } from "vite"
import { defineConfig, loadEnv } from "vite"
import { viteStaticCopy } from "vite-plugin-static-copy"
import { hlsProxyPlugin } from "./vite-plugin-hls-proxy"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, "..")

function devAssetsMiddleware() {
  return {
    name: "dev-parent-assets",
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        const raw = req.url?.split("?")[0] ?? ""
        if (raw === "/data/channels.json" || raw.startsWith("/data/channels.json")) {
          const file = path.join(rootDir, "backend", "data", "channels.json")
          if (fs.existsSync(file)) {
            res.setHeader("Content-Type", "application/json; charset=utf-8")
            fs.createReadStream(file).pipe(res)
            return
          }
        }
        if (raw.startsWith("/logo/")) {
          const rel = decodeURIComponent(raw.slice("/logo/".length))
          const safe = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, "")
          const file = path.join(rootDir, "logo", safe)
          if (fs.existsSync(file) && fs.statSync(file).isFile()) {
            const lower = safe.toLowerCase()
            const ct = lower.endsWith(".svg")
              ? "image/svg+xml"
              : lower.endsWith(".png")
                ? "image/png"
                : lower.endsWith(".jpg") || lower.endsWith(".jpeg")
                  ? "image/jpeg"
                  : lower.endsWith(".webp")
                    ? "image/webp"
                    : "application/octet-stream"
            res.setHeader("Content-Type", ct)
            fs.createReadStream(file).pipe(res)
            return
          }
        }
        next()
      })
    },
  }
}

// `.env` / `.env.local` are not merged into `process.env` while this file runs — use `loadEnv`.
// See https://vite.dev/config/#using-environment-variables-in-config
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "")
  const base = env.VITE_BASE ?? "/"

  return {
    base,
    // Allow `LOGOS_BASE_URL` in frontend `.env` (same name as backend) alongside `VITE_*`.
    envPrefix: ["VITE_", "LOGOS_"],
    server: {
      proxy: {
        "/api": {
          target: env.VITE_DEV_API_PROXY ?? "http://127.0.0.1:8787",
          changeOrigin: true,
        },
      },
    },
    plugins: [
      react(),
      // Generates a <script nomodule> fallback bundle for Chrome 56–60 (Tizen 2018 early models,
      // WebOS 4.0) which predate ES module support. Modern browsers ignore the nomodule bundle.
      legacy({
        targets: ["chrome >= 56", "safari >= 11"],
      }),
      hlsProxyPlugin(base),
      devAssetsMiddleware(),
      viteStaticCopy({
        targets: [
          // Flatten backend/data/... under dest "data" → dist/data/channels.json (stripBase: see plugin source).
          {
            src: "../backend/data/channels.json",
            dest: "data",
            rename: { stripBase: 2 },
          },
          { src: "../logo", dest: "logo" },
        ],
      }),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  }
})
