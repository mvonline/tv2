/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BASE: string
  /** Optional API origin for `/api/categories` (default: same origin). */
  readonly VITE_API_BASE?: string
  readonly VITE_HLS_PROXY_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
