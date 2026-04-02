import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"

export type VisualTheme = "tv" | "neon" | "glass"
export type LayoutMode = "thumbnail" | "list" | "details"

const KEY_VISUAL = "tv2-visual"
const KEY_LAYOUT = "tv2-layout"

function readStored<T extends string>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    if (v) return v as T
  } catch {
    /* ignore */
  }
  return fallback
}

type UiStyleValue = {
  visual: VisualTheme
  setVisual: (v: VisualTheme) => void
  layout: LayoutMode
  setLayout: (v: LayoutMode) => void
}

const UiStyleContext = createContext<UiStyleValue | null>(null)

export function UiStyleProvider({ children }: { children: ReactNode }) {
  const [visual, setVisual] = useState<VisualTheme>(() =>
    readStored(KEY_VISUAL, "tv"),
  )
  const [layout, setLayout] = useState<LayoutMode>(() =>
    readStored(KEY_LAYOUT, "thumbnail"),
  )

  useEffect(() => {
    document.documentElement.dataset.visual = visual
    document.documentElement.dataset.layout = layout
    try {
      localStorage.setItem(KEY_VISUAL, visual)
      localStorage.setItem(KEY_LAYOUT, layout)
    } catch {
      /* ignore */
    }
  }, [visual, layout])

  const value = useMemo(
    () => ({ visual, setVisual, layout, setLayout }),
    [visual, layout],
  )

  return (
    <UiStyleContext.Provider value={value}>{children}</UiStyleContext.Provider>
  )
}

export function useUiStyle() {
  const ctx = useContext(UiStyleContext)
  if (!ctx) throw new Error("useUiStyle must be used within UiStyleProvider")
  return ctx
}
