import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import type { CategoryConfig } from "@/types/categoryConfig"
import { apiGetJson } from "@/lib/apiBase"

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

async function fetchCategories(): Promise<CategoryConfig[] | null> {
  const data = await apiGetJson<unknown>("/api/categories")
  if (!Array.isArray(data)) return null
  return data.filter(
    (x): x is CategoryConfig =>
      typeof x === "object" &&
      x !== null &&
      typeof (x as CategoryConfig).slug === "string" &&
      typeof (x as CategoryConfig).label === "string",
  )
}

async function fetchChannelConfig(): Promise<ChannelConfig | null> {
  const data = await apiGetJson<ChannelConfig>("/api/channel-config")
  if (typeof data !== "object" || data === null) return null
  return data
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
