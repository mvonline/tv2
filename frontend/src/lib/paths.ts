import type { Channel } from "@/types/channel"

export function channelPathFromPageUrl(pageUrl: string): string {
  try {
    const u = new URL(pageUrl)
    return u.pathname.replace(/\/$/, "") || "/"
  } catch {
    return "/"
  }
}

export function watchUrlForChannel(c: Channel): string {
  const p = channelPathFromPageUrl(c.page_url).replace(/^\//, "")
  return `/watch/${encodeURIComponent(p)}`
}

export function channelFromRouteKey(
  channels: Channel[],
  key: string | undefined,
): Channel | undefined {
  if (!key) return undefined
  let path: string
  try {
    path = decodeURIComponent(key)
  } catch {
    path = key
  }
  const full = path.startsWith("/") ? path : `/${path}`
  return channels.find((c) => channelPathFromPageUrl(c.page_url) === full)
}
