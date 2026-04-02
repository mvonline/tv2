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

type Status = "loading" | "ready" | "unavailable"

type CategoriesContextValue = {
  categories: CategoryConfig[] | null
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
  const url = `${base}/api/categories`
  try {
    const res = await fetch(url, { cache: "no-store" })
    if (!res.ok) return null
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

export function CategoriesProvider({ children }: { children: ReactNode }) {
  const [categories, setCategories] = useState<CategoryConfig[] | null>(null)
  const [status, setStatus] = useState<Status>("loading")

  useEffect(() => {
    let cancelled = false
    fetchCategories().then((list) => {
      if (cancelled) return
      setCategories(list)
      setStatus(list === null ? "unavailable" : "ready")
    })
    return () => {
      cancelled = true
    }
  }, [])

  const value = useMemo(
    () => ({
      categories,
      status,
      useDbCategories: Array.isArray(categories) && categories.length > 0,
    }),
    [categories, status],
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
