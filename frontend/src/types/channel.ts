export type MediaType = "tv" | "radio"

export interface Channel {
  page_url: string
  name: string | null
  stream_url: string | null
  stream_type: string | null
  stream_host: string | null
  requires_proxy: boolean
  raw_iframe_src: string | null
  logo: string | null
  category_path: string
  slug: string
  /** Present after rescrape; older JSON may omit — treat as TV. */
  media_type?: MediaType
  /** Content topic from post-scrape AI (or heuristic). See `ai_taxonomy` in JSON. */
  ai_category?: string
  ai_labeled_at?: string
  /** "iptv-org" for channels fetched from the iptv-org M3U; absent for aparatchi channels. */
  source?: string
  /** M3U group-title (iptv-org channels only). */
  group_title?: string
  /** TVG ID from M3U (iptv-org channels only). */
  tvg_id?: string
  /** Language tag from M3U (iptv-org channels only). */
  tvg_language?: string
  /** ISO country code from M3U (iptv-org channels only). */
  tvg_country?: string
}

export interface ChannelsPayload {
  source: string
  count: number
  channels: Channel[]
  /** Allowed `ai_category` values when present on payload */
  ai_taxonomy?: string[]
  ai_model?: string
}
