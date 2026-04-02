import type { Channel } from "@/types/channel"

export const CHANNEL_ORDER_STORAGE_KEY = "tv2-channel-order-v1"

export function loadChannelOrder(): string[] | null {
  try {
    const raw = localStorage.getItem(CHANNEL_ORDER_STORAGE_KEY)
    if (raw === null) return null
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return null
    const urls = arr.filter((x): x is string => typeof x === "string")
    return urls.length > 0 ? urls : null
  } catch {
    return null
  }
}

export function saveChannelOrder(pageUrls: string[]) {
  try {
    localStorage.setItem(CHANNEL_ORDER_STORAGE_KEY, JSON.stringify(pageUrls))
  } catch {
    /* quota */
  }
}

export function clearChannelOrder() {
  try {
    localStorage.removeItem(CHANNEL_ORDER_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

/** Merge JSON channels with a saved `page_url` sequence; unknown channels append sorted by name. */
export function applyChannelOrder(
  channels: Channel[],
  savedOrder: string[] | null,
): Channel[] {
  if (!savedOrder?.length) {
    return [...channels].sort((a, b) =>
      (a.name ?? "").localeCompare(b.name ?? "", undefined, {
        sensitivity: "base",
      }),
    )
  }
  const byUrl = new Map(channels.map((c) => [c.page_url, c]))
  const seen = new Set<string>()
  const result: Channel[] = []
  for (const url of savedOrder) {
    const ch = byUrl.get(url)
    if (ch) {
      result.push(ch)
      seen.add(url)
    }
  }
  const rest = channels.filter((c) => !seen.has(c.page_url))
  rest.sort((a, b) =>
    (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: "base" }),
  )
  result.push(...rest)
  return result
}
