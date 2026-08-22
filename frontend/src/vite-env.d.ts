/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BASE: string
  /** "false" when the deployment has no backend; see lib/apiBase.ts. */
  readonly VITE_HAS_API: string
  /** Optional API origin for `/api/categories` (default: same origin). */
  readonly VITE_API_BASE?: string
  readonly VITE_HLS_PROXY_BASE?: string
  /** Optional absolute origin for `channel.logo` paths (overrides GET `/api/config`). */
  readonly VITE_LOGOS_BASE_URL?: string
  /** Same as backend name; exposed via `envPrefix` in `vite.config.ts`. */
  readonly LOGOS_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
