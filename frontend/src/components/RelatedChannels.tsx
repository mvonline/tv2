import { useMemo, useRef, useCallback, useState } from "react"
import { Link } from "react-router-dom"
import { ChevronLeft, ChevronRight, X, PanelBottom } from "lucide-react"
import type { Channel } from "@/types/channel"
import { watchUrlForChannel } from "@/lib/paths"
import { publicUrl } from "@/lib/publicUrl"

const TOTAL = 15
const SCROLL_AMOUNT = 3
const STORAGE_KEY = "tv2_related_dock_collapsed"

function tokenize(s: string): Set<string> {
  return new Set(
    (s || "")
      .toLowerCase()
      .replace(/[^a-z0-9\u0600-\u06FF]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter((t) => t.length > 2),
  )
}

function nameSimilarity(a: string | null, b: string | null): number {
  if (!a || !b) return 0
  const ta = tokenize(a)
  const tb = tokenize(b)
  if (!ta.size || !tb.size) return 0
  let shared = 0
  for (const t of ta) if (tb.has(t)) shared++
  return shared / Math.max(ta.size, tb.size)
}

function scoreChannel(current: Channel, candidate: Channel): number {
  let score = 0
  if (candidate.category_path === current.category_path) score += 5
  if (candidate.ai_category && candidate.ai_category === current.ai_category) score += 3
  score += nameSimilarity(current.name, candidate.name) * 4
  if (candidate.media_type === current.media_type) score += 1
  return score
}

export function getRelatedChannels(
  all: Channel[],
  current: Channel,
  count: number = TOTAL,
): Channel[] {
  return all
    .filter((c) => c.page_url !== current.page_url)
    .map((c) => ({ ch: c, score: scoreChannel(current, c) }))
    .sort((a, b) => b.score - a.score || Math.random() - 0.5)
    .slice(0, count)
    .map((r) => r.ch)
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1"
  } catch {
    return false
  }
}

function writeCollapsed(collapsed: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0")
  } catch {
    /* ignore */
  }
}

interface Props {
  channels: Channel[]
  current: Channel
}

export function RelatedChannels({ channels, current }: Props) {
  const related = useMemo(
    () => getRelatedChannels(channels, current, TOTAL),
    [channels, current],
  )
  const trackRef = useRef<HTMLDivElement>(null)
  const [collapsed, setCollapsed] = useState(readCollapsed)

  const openDock = useCallback(() => {
    setCollapsed(false)
    writeCollapsed(false)
  }, [])

  const closeDock = useCallback(() => {
    setCollapsed(true)
    writeCollapsed(true)
  }, [])

  const scroll = useCallback((dir: 1 | -1) => {
    const el = trackRef.current
    if (!el) return
    const card = el.querySelector<HTMLElement>(".related-dock__card")
    if (!card) return
    const gap = parseFloat(getComputedStyle(el).gap) || 0
    const step = (card.offsetWidth + gap) * SCROLL_AMOUNT
    el.scrollBy({ left: step * dir, behavior: "smooth" })
  }, [])

  if (!related.length) return null

  return (
    <div className="related-dock-wrap" data-collapsed={collapsed ? "" : undefined}>
      {collapsed ? (
        <button
          type="button"
          className="related-dock__peek glass-dock"
          onClick={openDock}
          aria-label="Show related channels"
        >
          <PanelBottom size={18} strokeWidth={2} aria-hidden />
          <span>Related channels</span>
        </button>
      ) : (
        <div
          id="related-dock-panel"
          className="related-dock glass-dock"
          role="region"
          aria-label="Related channels"
        >
          <header className="related-dock__head">
            <span className="related-dock__title">Related channels</span>
            <button
              type="button"
              className="related-dock__close"
              onClick={closeDock}
              aria-label="Hide related channels"
            >
              <X size={18} strokeWidth={2} />
            </button>
          </header>
          <div className="related-dock__row">
            <button
              type="button"
              className="related-dock__arrow"
              onClick={() => scroll(-1)}
              aria-label="Scroll left"
            >
              <ChevronLeft size={20} />
            </button>

            <div className="related-dock__track" ref={trackRef}>
              {related.map((ch) => {
                const logo = ch.logo ? publicUrl(ch.logo) : null
                return (
                  <Link
                    key={ch.page_url}
                    to={watchUrlForChannel(ch)}
                    className="related-dock__card"
                    title={ch.name ?? ch.slug}
                  >
                    <span className="related-dock__thumb">
                      {logo ? (
                        <img src={logo} alt="" loading="lazy" decoding="async" />
                      ) : (
                        <span className="related-dock__ph">TV</span>
                      )}
                    </span>
                    <span className="related-dock__label">
                      {ch.name ?? ch.slug}
                    </span>
                  </Link>
                )
              })}
            </div>

            <button
              type="button"
              className="related-dock__arrow"
              onClick={() => scroll(1)}
              aria-label="Scroll right"
            >
              <ChevronRight size={20} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
