import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import react from "@vitejs/plugin-react"
import type { ViteDevServer } from "vite"
import { defineConfig } from "vite"
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

// Set VITE_BASE=/your-repo-name/ when deploying to GitHub project pages (see deploy workflow).
const base = process.env.VITE_BASE ?? "/"

export default defineConfig({
  base,
  server: {
    proxy: {
      "/api": {
        target: process.env.VITE_DEV_API_PROXY ?? "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
  plugins: [
    react(),
    hlsProxyPlugin(base),
    devAssetsMiddleware(),
    viteStaticCopy({
      targets: [
        { src: "../backend/data/channels.json", dest: "data" },
        { src: "../logo", dest: "logo" },
      ],
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
