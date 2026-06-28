import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import type { CategoryConfig } from "@/types/categoryConfig"

export type { CategoryConfig }

export type ChannelConfig = {
  category_overrides: Record<string, string>
  channel_order: Record<string, string[]>
}

type Status = "loading" | "ready" | "unavailable"

type CategoriesContextValue = {
  categories: CategoryConfig[] | null
  channelConfig: ChannelConfig | null
  status: Status
  /** True when the API returned a non-empty category list (homepage uses DB order/labels). */
  useDbCategories: boolean
}

const CategoriesContext = createContext<CategoriesContextValue | null>(null)

function apiBase(): string {
  const raw = import.meta.env.VITE_API_BASE?.trim()
  if (raw) return raw.replace(/\/$/, "")
  return ""
}

async function fetchCategories(): Promise<CategoryConfig[] | null> {
  const base = apiBase()
  try {
    const res = await fetch(`${base}/api/categories`, { cache: "no-store" })
    if (!res.ok) return null
    const ct = (res.headers.get("content-type") ?? "").toLowerCase()
    if (!ct.includes("json")) return null
    const data = (await res.json()) as unknown
    if (!Array.isArray(data)) return null
    return data.filter(
      (x): x is CategoryConfig =>
        typeof x === "object" &&
        x !== null &&
        typeof (x as CategoryConfig).slug === "string" &&
        typeof (x as CategoryConfig).label === "string",
    )
  } catch {
    return null
  }
}

async function fetchChannelConfig(): Promise<ChannelConfig | null> {
  const base = apiBase()
  try {
    const res = await fetch(`${base}/api/channel-config`, { cache: "no-store" })
    if (!res.ok) return null
    const data = (await res.json()) as unknown
    if (typeof data !== "object" || data === null) return null
    return data as ChannelConfig
  } catch {
    return null
  }
}

export function CategoriesProvider({ children }: { children: ReactNode }) {
  const [categories, setCategories] = useState<CategoryConfig[] | null>(null)
  const [channelConfig, setChannelConfig] = useState<ChannelConfig | null>(null)
  const [status, setStatus] = useState<Status>("loading")

  useEffect(() => {
    let cancelled = false
    Promise.all([fetchCategories(), fetchChannelConfig()]).then(([cats, config]) => {
      if (cancelled) return
      setCategories(cats)
      setChannelConfig(config)
      setStatus(cats === null ? "unavailable" : "ready")
    })
    return () => {
      cancelled = true
    }
  }, [])

  const value = useMemo(
    () => ({
      categories,
      channelConfig,
      status,
      useDbCategories: Array.isArray(categories) && categories.length > 0,
    }),
    [categories, channelConfig, status],
  )

  return (
    <CategoriesContext.Provider value={value}>{children}</CategoriesContext.Provider>
  )
}

export function useCategoriesConfig() {
  const ctx = useContext(CategoriesContext)
  if (!ctx) throw new Error("useCategoriesConfig must be used within CategoriesProvider")
  return ctx
}
