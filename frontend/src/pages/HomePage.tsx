import { type CSSProperties, useCallback, useEffect, useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { Grid3X3, ListChecks, Play, RotateCcw, SlidersHorizontal } from "lucide-react"
import { ChannelCard } from "@/components/ChannelCard"
import { CinemaHero } from "@/components/CinemaHero"
import { ChannelDetailsRow } from "@/components/ChannelDetailsRow"
import { ChannelListRow } from "@/components/ChannelListRow"
import { ChannelNumpad } from "@/components/ChannelNumpad"
import { DigitOverlay } from "@/components/DigitOverlay"
import { ReorderableHomeChannels } from "@/components/ReorderableHomeChannels"
import { SearchBar } from "@/components/SearchBar"
import { StyleToolbar } from "@/components/StyleToolbar"
import { useCategoriesConfig } from "@/context/CategoriesContext"
import { useChannels } from "@/context/ChannelsContext"
import { useFavorites } from "@/context/FavoritesContext"
import { useRecentlyWatched } from "@/context/RecentlyWatchedContext"
import { useUiStyle } from "@/context/UiStyleContext"
import { channelNumber } from "@/lib/channelNumber"
import { groupChannelsByAiCategory, formatAiCategoryTitle } from "@/lib/groupByCategory"
import { thumbHueForChannel } from "@/lib/topicAccent"
import { useTvRemote, DIGIT_AUTO_SUBMIT_AFTER_MS } from "@/hooks/useTvRemote"
import { useMobileViewport } from "@/hooks/useMobileViewport"
import { isMobileViewport } from "@/lib/mobileLayout"
import { watchUrlForChannel } from "@/lib/paths"
import { channelLogoUrl } from "@/lib/publicUrl"
import type { Channel } from "@/types/channel"

function filterChannels(channels: Channel[], q: string): Channel[] {
  const s = q.trim().toLowerCase()
  if (!s) return channels
  return channels.filter((c) => {
    const n = (c.name ?? "").toLowerCase()
    return n.includes(s) || c.slug.toLowerCase().includes(s)
  })
}

type FeaturedConfig = {
  slugs: string[]
}

async function fetchFeaturedSlugs(): Promise<string[]> {
  try {
    const res = await fetch("/api/featured-channels", { cache: "no-store" })
    if (!res.ok) return []
    const data = (await res.json()) as FeaturedConfig
    return Array.isArray(data.slugs) ? data.slugs : []
  } catch {
    return []
  }
}

export function HomePage() {
  const mobile = useMobileViewport()
  const [styleToolsOpen, setStyleToolsOpen] = useState(() => !isMobileViewport())

  useEffect(() => {
    setStyleToolsOpen(!mobile)
  }, [mobile])

  const {
    ordered,
    status,
    error,
    reload,
    setChannelOrder,
    resetChannelOrder,
    hasCustomChannelOrder,
  } = useChannels()
  const { categories: dbCategories, channelConfig, useDbCategories } = useCategoriesConfig()
  const { isFavorite, favoriteChannelsInOrder } = useFavorites()
  const { recentChannels } = useRecentlyWatched()
  const { visual, layout } = useUiStyle()
  const isCinema = visual === "cinema"
  const [query, setQuery] = useState("")
  const [reorderMode, setReorderMode] = useState(false)
  const [featuredSlugs, setFeaturedSlugs] = useState<string[]>([])
  const [featuredIndex, setFeaturedIndex] = useState(0)
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false
    fetchFeaturedSlugs().then((slugs) => {
      if (!cancelled) setFeaturedSlugs(slugs)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const canReorder = query.trim() === ""

  const filtered = useMemo(() => filterChannels(ordered, query), [ordered, query])

  const channelNoByUrl = useMemo(() => {
    const m = new Map<string, number>()
    ordered.forEach((c, i) => m.set(c.page_url, i + 1))
    return m
  }, [ordered])

  const favoritesFiltered = useMemo(
    () => favoriteChannelsInOrder(ordered).filter((c) => filtered.some((x) => x.page_url === c.page_url)),
    [ordered, filtered, favoriteChannelsInOrder],
  )

  const recentFiltered = useMemo(
    () => recentChannels(ordered).filter((c) => filtered.some((x) => x.page_url === c.page_url)),
    [ordered, filtered, recentChannels],
  )

  const forCategories = useMemo(
    () => filtered.filter((c) => !isFavorite(c)),
    [filtered, isFavorite],
  )

  const byAiCategory = useMemo(
    () =>
      groupChannelsByAiCategory(
        forCategories,
        useDbCategories ? dbCategories : null,
        channelConfig,
      ),
    [forCategories, useDbCategories, dbCategories, channelConfig],
  )

  const {
    digitBuffer,
    appendDigit,
    submitDigits,
    backspaceDigit,
  } = useTvRemote({
    digitsDisabled: query.length > 0,
    onGoToChannelNumber: (n) => {
      const ch = ordered[n - 1]
      if (ch) navigate(watchUrlForChannel(ch))
    },
  })

  const layoutClass =
    layout === "thumbnail" ? "channel-grid" : layout === "list" ? "channel-list" : "channel-details"

  const featuredChannels = useMemo(
    () =>
      featuredSlugs
        .map((slug) => ordered.find((ch) => ch.slug === slug))
        .filter((ch): ch is Channel => Boolean(ch)),
    [featuredSlugs, ordered],
  )

  useEffect(() => {
    if (featuredChannels.length <= 1) return
    const id = window.setInterval(() => {
      setFeaturedIndex((i) => (i + 1) % featuredChannels.length)
    }, 9000)
    return () => window.clearInterval(id)
  }, [featuredChannels.length])

  useEffect(() => {
    if (featuredIndex >= featuredChannels.length) setFeaturedIndex(0)
  }, [featuredIndex, featuredChannels.length])

  const featuredChannel =
    featuredChannels[featuredIndex] ?? recentFiltered[0] ?? favoritesFiltered[0] ?? ordered[0]
  const featuredNo = featuredChannel
    ? channelNoByUrl.get(featuredChannel.page_url) ?? channelNumber(ordered, featuredChannel)
    : 1
  const featuredLogo = featuredChannel ? channelLogoUrl(featuredChannel.logo) : null
  const categoryCount = byAiCategory.size
  const radioCount = ordered.filter((c) => c.media_type === "radio").length
  const liveCount = ordered.filter((c) => c.media_type !== "radio").length

  const renderChannel = useCallback(
    (ch: Channel, opts?: { linkless?: boolean }) => {
      const no = channelNoByUrl.get(ch.page_url) ?? channelNumber(ordered, ch)
      const linkless = opts?.linkless ?? false
      if (layout === "thumbnail") {
        return (
          <ChannelCard
            key={ch.page_url}
            channel={ch}
            channelNo={no}
            linkless={linkless}
          />
        )
      }
      if (layout === "list") {
        return (
          <ChannelListRow
            key={ch.page_url}
            channel={ch}
            channelNo={no}
            linkless={linkless}
          />
        )
      }
      return (
        <ChannelDetailsRow
          key={ch.page_url}
          channel={ch}
          channelNo={no}
          linkless={linkless}
        />
      )
    },
    [channelNoByUrl, layout, ordered],
  )

  if (status === "loading") {
    return (
      <div className="page page--center">
        <p className="muted">Loading channels…</p>
      </div>
    )
  }

  if (status === "error") {
    return (
      <div className="page page--center">
        <p className="error-text">{error}</p>
        <button type="button" className="btn-primary" onClick={reload}>
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="page home home-guide">
      <header className="home-command">
        <div className="home-command__brand">
          <span className="home-command__mark">TV2</span>
          <div>
            <p className="home-eyebrow">Signal directory</p>
            <h1 className="home-title">Live channels, tuned fast.</h1>
          </div>
        </div>
        <div className="home-command__actions">
          <Link to="/multiview" className="btn-ghost home-multiview-link">
            <Grid3X3 size={18} aria-hidden />
            Multi-view
          </Link>
          <a
            className="btn-ghost home-support-link"
            href="https://buymeacoffee.com/vafaone"
            target="_blank"
            rel="noreferrer"
          >
            Support
          </a>
          {mobile && (
            <button
              type="button"
              className={`btn-ghost home-style-tools-toggle ${styleToolsOpen ? "is-active" : ""}`}
              onClick={() => setStyleToolsOpen((v) => !v)}
            >
              <SlidersHorizontal size={18} aria-hidden />
              Display
            </button>
          )}
        </div>
      </header>

      <section className="home-stage" aria-label="Featured channel and controls">
        <div className="home-stage__feature">
          {featuredChannel && (
            <>
              <div className="home-stage__screen">
                <div className="home-stage__scanlines" aria-hidden />
                <span className="home-stage__live">Live</span>
                {featuredLogo ? (
                  <img src={featuredLogo} alt="" className="home-stage__logo" />
                ) : (
                  <span className="home-stage__placeholder" aria-hidden>
                    TV
                  </span>
                )}
              </div>
              <div className="home-stage__meta">
                <span className="home-stage__channel">CH {featuredNo}</span>
                <h2>{featuredChannel.name ?? featuredChannel.slug}</h2>
                <p>
                  {formatAiCategoryTitle(featuredChannel.ai_category ?? "other", useDbCategories ? dbCategories : null)}
                </p>
                <Link to={watchUrlForChannel(featuredChannel)} className="home-stage__play">
                  <Play size={18} fill="currentColor" aria-hidden />
                  Watch now
                </Link>
                {featuredChannels.length > 1 && (
                  <div className="home-stage__rotator" aria-label="Featured channels">
                    {featuredChannels.map((ch, index) => (
                      <button
                        key={ch.slug}
                        type="button"
                        className={index === featuredIndex ? "is-active" : ""}
                        onClick={() => setFeaturedIndex(index)}
                        aria-label={`Show ${ch.name ?? ch.slug}`}
                      />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="home-stage__controls">
          <div className="home-metrics" aria-label="Channel summary">
            <span><strong>{ordered.length}</strong> total</span>
            <span><strong>{liveCount}</strong> TV</span>
            <span><strong>{radioCount}</strong> radio</span>
            <span><strong>{categoryCount}</strong> topics</span>
          </div>
          <SearchBar
            value={query}
            onChange={(v) => {
              setQuery(v)
              if (v.trim() !== "") setReorderMode(false)
            }}
            placeholder="Find a channel, topic, or slug"
            id="home-search"
          />
          <div className="home-stage__toolrow">
            <button
              type="button"
              className={`btn-ghost home-reorder-toggle ${reorderMode ? "is-active" : ""}`}
              onClick={() => setReorderMode((v) => !v)}
              disabled={!canReorder && !reorderMode}
              title={
                !canReorder
                  ? "Clear search to reorder channels"
                  : reorderMode
                    ? "Finish reordering"
                    : "Drag channels to change CH order"
              }
            >
              <ListChecks size={18} aria-hidden />
              {reorderMode ? "Done" : "Reorder"}
            </button>
            {hasCustomChannelOrder && (
              <button
                type="button"
                className="btn-ghost home-reorder-reset"
                onClick={() => resetChannelOrder()}
                title="Restore alphabetical order"
              >
                <RotateCcw size={17} aria-hidden />
                Reset
              </button>
            )}
          </div>
          <div
            className={
              mobile && !styleToolsOpen
                ? "home-header__style-toolbar is-collapsed-mobile"
                : "home-header__style-toolbar"
            }
          >
            <StyleToolbar />
          </div>
        </div>
      </section>

      <DigitOverlay
        buffer={digitBuffer}
        hint={
          ordered.length
            ? `CH 1–${ordered.length} · Enter · idle ${DIGIT_AUTO_SUBMIT_AFTER_MS / 1000}s = go`
            : undefined
        }
      />

      {isCinema && layout === "thumbnail" && !reorderMode && query.trim() === "" && (
        <CinemaHero channels={ordered} />
      )}

      <main className="home-main">
        {reorderMode && canReorder ? (
          <section className="cat-section" aria-labelledby="cat-reorder">
            <h2 id="cat-reorder" className="cat-section__title">
              Channel order
            </h2>
            <p className="muted reorder-hint">
              Drag any row to change CH numbers app-wide. Order is saved in this
              browser.
            </p>
            <ReorderableHomeChannels
              channels={ordered}
              layout={layout}
              onReorder={setChannelOrder}
              renderChannel={(ch, _channelNo, { linkless }) =>
                renderChannel(ch, { linkless })
              }
            />
          </section>
        ) : (
          <>
            {recentFiltered.length > 0 && (
              <section
                className="cat-section cat-section--recent"
                aria-labelledby="cat-recent"
              >
                <h2
                  id="cat-recent"
                  className="cat-section__title cat-section__title--recent"
                >
                  Recently watched
                </h2>
                {isCinema && layout === "thumbnail" ? (
                  <div className="cinema-shelf"><div className={layoutClass}>{recentFiltered.map((ch) => renderChannel(ch))}</div></div>
                ) : (
                  <div className={layoutClass}>{recentFiltered.map((ch) => renderChannel(ch))}</div>
                )}
              </section>
            )}

            {favoritesFiltered.length > 0 && (
              <section
                className="cat-section cat-section--favorites"
                aria-labelledby="cat-favorites"
              >
                <h2
                  id="cat-favorites"
                  className="cat-section__title cat-section__title--favorites"
                >
                  Favorites
                </h2>
                {isCinema && layout === "thumbnail" ? (
                  <div className="cinema-shelf"><div className={layoutClass}>{favoritesFiltered.map((ch) => renderChannel(ch))}</div></div>
                ) : (
                  <div className={layoutClass}>{favoritesFiltered.map((ch) => renderChannel(ch))}</div>
                )}
              </section>
            )}

            {[...byAiCategory.entries()].map(([aiKey, list]) => {
              const catId = `cat-ai-${aiKey.replace(/[^\w-]+/g, "-").slice(0, 48)}`
              const sectionHue = thumbHueForChannel(aiKey)
              return (
                <section
                  key={aiKey}
                  className="cat-section"
                  aria-labelledby={catId}
                  style={{ "--section-hue": String(sectionHue) } as CSSProperties}
                >
                  <h2 id={catId} className="cat-section__title">
                    {formatAiCategoryTitle(aiKey, useDbCategories ? dbCategories : null)}
                  </h2>
                  {isCinema && layout === "thumbnail" ? (
                    <div className="cinema-shelf"><div className={layoutClass}>{list.map((ch) => renderChannel(ch))}</div></div>
                  ) : (
                    <div className={layoutClass}>{list.map((ch) => renderChannel(ch))}</div>
                  )}
                </section>
              )
            })}
          </>
        )}
      </main>

      {filtered.length === 0 && (
        <p className="muted home-empty">No channels match your search.</p>
      )}

      <ChannelNumpad
        appendDigit={appendDigit}
        submitDigits={submitDigits}
        backspaceDigit={backspaceDigit}
        disabled={query.length > 0}
        fixed
      />
    </div>
  )
}
