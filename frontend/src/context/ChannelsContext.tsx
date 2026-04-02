import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import {
  applyChannelOrder,
  clearChannelOrder,
  loadChannelOrder,
  saveChannelOrder,
} from "@/lib/channelOrderStorage"
import { publicUrl } from "@/lib/publicUrl"
import type { Channel, ChannelsPayload } from "@/types/channel"

type Status = "loading" | "ready" | "error"

type ChannelsContextValue = {
  channels: Channel[]
  ordered: Channel[]
  status: Status
  error: string | null
  reload: () => void
  /** Full `page_url` list in display / CH number order. */
  setChannelOrder: (pageUrls: string[]) => void
  resetChannelOrder: () => void
  /** True when a saved order from localStorage is active (not default A–Z). */
  hasCustomChannelOrder: boolean
}

const ChannelsContext = createContext<ChannelsContextValue | null>(null)

async function loadChannels(): Promise<Channel[]> {
  const res = await fetch(publicUrl("data/channels.json"), { cache: "no-store" })
  if (!res.ok) throw new Error(`Failed to load channels (${res.status})`)
  const data = (await res.json()) as ChannelsPayload
  return data.channels ?? []
}

export function ChannelsProvider({ children }: { children: ReactNode }) {
  const [channels, setChannels] = useState<Channel[]>([])
  const [status, setStatus] = useState<Status>("loading")
  const [error, setError] = useState<string | null>(null)
  const [orderKeys, setOrderKeys] = useState<string[] | null>(() => loadChannelOrder())

  const fetchData = useCallback(() => {
    setStatus("loading")
    setError(null)
    loadChannels()
      .then((list) => {
        setChannels(list)
        setStatus("ready")
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Unknown error")
        setStatus("error")
      })
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const ordered = useMemo(
    () => applyChannelOrder(channels, orderKeys),
    [channels, orderKeys],
  )

  const setChannelOrder = useCallback((pageUrls: string[]) => {
    setOrderKeys(pageUrls)
    saveChannelOrder(pageUrls)
  }, [])

  const resetChannelOrder = useCallback(() => {
    setOrderKeys(null)
    clearChannelOrder()
  }, [])

  const value = useMemo(
    () => ({
      channels,
      ordered,
      status,
      error,
      reload: fetchData,
      setChannelOrder,
      resetChannelOrder,
      hasCustomChannelOrder: orderKeys !== null,
    }),
    [
      channels,
      ordered,
      status,
      error,
      fetchData,
      setChannelOrder,
      resetChannelOrder,
      orderKeys,
    ],
  )

  return <ChannelsContext.Provider value={value}>{children}</ChannelsContext.Provider>
}

export function useChannels() {
  const ctx = useContext(ChannelsContext)
  if (!ctx) throw new Error("useChannels must be used within ChannelsProvider")
  return ctx
}
