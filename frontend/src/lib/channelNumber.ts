import type { Channel } from "@/types/channel"

/** Stable key for favorites / storage (unique per channel). */
export function channelStorageKey(channel: Channel): string {
  return channel.page_url
}

/** 1-based index in the global ordered list, or 0 if unknown. */
export function channelNumber(
  ordered: Channel[],
  channel: Channel,
): number {
  const i = ordered.findIndex((c) => c.page_url === channel.page_url)
  return i >= 0 ? i + 1 : 0
}
