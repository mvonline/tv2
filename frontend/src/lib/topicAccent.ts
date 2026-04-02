/** Hues (0–360) for thumbnail mesh when `ai_category` is set on channel JSON. */
const DEFAULT_HUE = 232

const AI_TOPIC_HUES: Record<string, number> = {
  sport: 198,
  movie: 292,
  news: 206,
  music: 330,
  kids: 42,
  documentary: 152,
  religious: 38,
  entertainment: 265,
  education: 172,
  series: 248,
  lifestyle: 12,
  international: 220,
  radio: 185,
  other: DEFAULT_HUE,
}

export function thumbHueForChannel(aiCategory: string | undefined): number {
  if (!aiCategory) return DEFAULT_HUE
  return AI_TOPIC_HUES[aiCategory] ?? DEFAULT_HUE
}
