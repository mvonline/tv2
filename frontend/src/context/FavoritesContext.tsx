import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { channelStorageKey } from "@/lib/channelNumber"
import type { Channel } from "@/types/channel"

const STORAGE_KEY = "tv2-favorites-v1"

function loadKeys(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return new Set()
    return new Set(arr.filter((x): x is string => typeof x === "string"))
  } catch {
    return new Set()
  }
}

function saveKeys(keys: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...keys]))
  } catch {
    /* ignore quota */
  }
}

type FavoritesValue = {
  /** page_url keys */
  favoriteKeys: Set<string>
  isFavorite: (channel: Channel) => boolean
  toggleFavorite: (channel: Channel) => void
  favoriteChannelsInOrder: (ordered: Channel[]) => Channel[]
}

const FavoritesContext = createContext<FavoritesValue | null>(null)

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const [favoriteKeys, setFavoriteKeys] = useState<Set<string>>(loadKeys)

  useEffect(() => {
    saveKeys(favoriteKeys)
  }, [favoriteKeys])

  const isFavorite = useCallback(
    (channel: Channel) => favoriteKeys.has(channelStorageKey(channel)),
    [favoriteKeys],
  )

  const toggleFavorite = useCallback((channel: Channel) => {
    const k = channelStorageKey(channel)
    setFavoriteKeys((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }, [])

  const favoriteChannelsInOrder = useCallback(
    (ordered: Channel[]) =>
      ordered.filter((c) => favoriteKeys.has(channelStorageKey(c))),
    [favoriteKeys],
  )

  const value = useMemo(
    () => ({
      favoriteKeys,
      isFavorite,
      toggleFavorite,
      favoriteChannelsInOrder,
    }),
    [favoriteKeys, isFavorite, toggleFavorite, favoriteChannelsInOrder],
  )

  return (
    <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>
  )
}

export function useFavorites() {
  const ctx = useContext(FavoritesContext)
  if (!ctx) throw new Error("useFavorites must be used within FavoritesProvider")
  return ctx
}
