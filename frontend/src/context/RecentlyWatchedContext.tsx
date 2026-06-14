import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { channelStorageKey } from "@/lib/channelNumber"
import type { Channel } from "@/types/channel"

const STORAGE_KEY = "tv2-recent-v1"
const MAX_RECENT = 12

function loadKeys(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return []
    return arr.filter((x): x is string => typeof x === "string").slice(0, MAX_RECENT)
  } catch {
    return []
  }
}

function saveKeys(keys: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(keys))
  } catch {
    /* ignore quota */
  }
}

type RecentlyWatchedValue = {
  recentKeys: string[]
  recordVisit: (channel: Channel) => void
  recentChannels: (ordered: Channel[]) => Channel[]
}

const RecentlyWatchedContext = createContext<RecentlyWatchedValue | null>(null)

export function RecentlyWatchedProvider({ children }: { children: ReactNode }) {
  const [recentKeys, setRecentKeys] = useState<string[]>(loadKeys)

  useEffect(() => {
    saveKeys(recentKeys)
  }, [recentKeys])

  // Debounce ref: don't record the same channel twice in rapid succession
  const lastRecordedRef = useRef<string | null>(null)

  const recordVisit = useCallback((channel: Channel) => {
    const k = channelStorageKey(channel)
    if (lastRecordedRef.current === k) return
    lastRecordedRef.current = k
    setRecentKeys((prev) => {
      const next = [k, ...prev.filter((x) => x !== k)].slice(0, MAX_RECENT)
      return next
    })
  }, [])

  const recentChannels = useCallback(
    (ordered: Channel[]) => {
      const keyOrder = new Map(recentKeys.map((k, i) => [k, i]))
      return ordered
        .filter((c) => keyOrder.has(channelStorageKey(c)))
        .sort((a, b) => {
          const ia = keyOrder.get(channelStorageKey(a)) ?? MAX_RECENT
          const ib = keyOrder.get(channelStorageKey(b)) ?? MAX_RECENT
          return ia - ib
        })
    },
    [recentKeys],
  )

  const value = useMemo(
    () => ({ recentKeys, recordVisit, recentChannels }),
    [recentKeys, recordVisit, recentChannels],
  )

  return (
    <RecentlyWatchedContext.Provider value={value}>
      {children}
    </RecentlyWatchedContext.Provider>
  )
}

export function useRecentlyWatched() {
  const ctx = useContext(RecentlyWatchedContext)
  if (!ctx) throw new Error("useRecentlyWatched must be used within RecentlyWatchedProvider")
  return ctx
}
