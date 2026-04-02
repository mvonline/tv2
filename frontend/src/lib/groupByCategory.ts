import type { CategoryConfig } from "@/types/categoryConfig"
import type { Channel } from "@/types/channel"

/** Section order on the homepage (aligned with backend `ai_taxonomy`). */
export const AI_CATEGORY_SECTION_ORDER: readonly string[] = [
  "sport",
  "movie",
  "news",
  "music",
  "kids",
  "documentary",
  "religious",
  "entertainment",
  "education",
  "series",
  "lifestyle",
  "international",
  "radio",
  "other",
]

const AI_CATEGORY_LABELS: Record<string, string> = {
  sport: "Sport",
  movie: "Movies",
  news: "News",
  music: "Music",
  kids: "Kids",
  documentary: "Documentary",
  religious: "Religious",
  entertainment: "Entertainment",
  education: "Education",
  series: "Series & drama",
  lifestyle: "Lifestyle",
  international: "International",
  radio: "Radio",
  other: "Other",
}

function mergeInactiveIntoOther(
  map: Map<string, Channel[]>,
  dbCategories: CategoryConfig[] | null,
): void {
  if (!dbCategories?.length) return
  const inactive = new Set(
    dbCategories.filter((c) => !c.active).map((c) => c.slug.trim().toLowerCase()),
  )
  if (inactive.size === 0) return
  const acc: Channel[] = []
  for (const slug of [...map.keys()]) {
    if (!inactive.has(slug) || slug === "other") continue
    const list = map.get(slug)
    if (list) {
      acc.push(...list)
      map.delete(slug)
    }
  }
  if (acc.length === 0) return
  const other = [...(map.get("other") ?? []), ...acc]
  other.sort((a, b) =>
    (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: "base" }),
  )
  map.set("other", other)
}

/**
 * Group by `ai_category`. If `dbCategories` is set (from API), section order and inactive
 * handling follow the DB; otherwise use built-in `AI_CATEGORY_SECTION_ORDER`.
 */
export function groupChannelsByAiCategory(
  channels: Channel[],
  dbCategories: CategoryConfig[] | null,
): Map<string, Channel[]> {
  const map = new Map<string, Channel[]>()
  for (const c of channels) {
    const key = (c.ai_category || "other").trim().toLowerCase() || "other"
    const list = map.get(key) ?? []
    list.push(c)
    map.set(key, list)
  }
  for (const list of map.values()) {
    list.sort((a, b) =>
      (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: "base" }),
    )
  }

  mergeInactiveIntoOther(map, dbCategories)

  const keys = [...map.keys()].filter((k) => (map.get(k)?.length ?? 0) > 0)
  let orderedKeys: string[]

  if (dbCategories && dbCategories.length > 0) {
    const activeSlugs = [...dbCategories]
      .filter((c) => c.active)
      .sort((a, b) => a.sort_order - b.sort_order || a.slug.localeCompare(b.slug))
      .map((c) => c.slug.trim().toLowerCase())
    const seen = new Set<string>()
    orderedKeys = []
    for (const s of activeSlugs) {
      if (map.has(s) && (map.get(s)?.length ?? 0) > 0) {
        orderedKeys.push(s)
        seen.add(s)
      }
    }
    const rest = keys.filter((k) => !seen.has(k)).sort((a, b) => a.localeCompare(b))
    orderedKeys.push(...rest)
  } else {
    orderedKeys = keys.sort((a, b) => {
      const ia = AI_CATEGORY_SECTION_ORDER.indexOf(a)
      const ib = AI_CATEGORY_SECTION_ORDER.indexOf(b)
      const aUn = ia === -1
      const bUn = ib === -1
      if (aUn && bUn) return a.localeCompare(b)
      if (aUn) return 1
      if (bUn) return -1
      return ia - ib
    })
  }

  const out = new Map<string, Channel[]>()
  for (const k of orderedKeys) {
    const list = map.get(k)
    if (list?.length) out.set(k, list)
  }
  return out
}

export function formatAiCategoryTitle(
  aiCategoryKey: string,
  dbCategories: CategoryConfig[] | null,
): string {
  const k = aiCategoryKey.trim().toLowerCase()
  if (dbCategories?.length) {
    const row = dbCategories.find((c) => c.slug.trim().toLowerCase() === k)
    if (row) return row.label
  }
  if (AI_CATEGORY_LABELS[k]) return AI_CATEGORY_LABELS[k]
  return k.replace(/-/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase())
}

export function groupChannelsByCategory(channels: Channel[]): Map<string, Channel[]> {
  const map = new Map<string, Channel[]>()
  for (const c of channels) {
    const key = c.category_path || "/uncategorized"
    const list = map.get(key) ?? []
    list.push(c)
    map.set(key, list)
  }
  for (const list of map.values()) {
    list.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: "base" }))
  }
  return new Map([...map.entries()].sort((a, b) => a[0].localeCompare(b[0])))
}

export function formatCategoryTitle(categoryPath: string): string {
  const raw = categoryPath.replace(/^\//, "").replace(/-live-tv$/i, "").replace(/-/g, " ")
  if (categoryPath.includes("iranian-live-radio")) return "Radio"
  return raw.replace(/\b\w/g, (ch) => ch.toUpperCase())
}
