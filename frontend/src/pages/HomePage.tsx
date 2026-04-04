import { useCallback, useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { ChannelCard } from "@/components/ChannelCard"
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
import { useUiStyle } from "@/context/UiStyleContext"
import { channelNumber } from "@/lib/channelNumber"
import { groupChannelsByAiCategory, formatAiCategoryTitle } from "@/lib/groupByCategory"
import { useTvRemote } from "@/hooks/useTvRemote"
import { watchUrlForChannel } from "@/lib/paths"
import type { Channel } from "@/types/channel"

function filterChannels(channels: Channel[], q: string): Channel[] {
  const s = q.trim().toLowerCase()
  if (!s) return channels
  return channels.filter((c) => {
    const n = (c.name ?? "").toLowerCase()
    return n.includes(s) || c.slug.toLowerCase().includes(s)
  })
}

export function HomePage() {
  const {
    ordered,
    status,
    error,
    reload,
    setChannelOrder,
    resetChannelOrder,
    hasCustomChannelOrder,
  } = useChannels()
  const { categories: dbCategories, useDbCategories } = useCategoriesConfig()
  const { isFavorite, favoriteChannelsInOrder } = useFavorites()
  const { layout } = useUiStyle()
  const [query, setQuery] = useState("")
  const [reorderMode, setReorderMode] = useState(false)
  const navigate = useNavigate()

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

  const forCategories = useMemo(
    () => filtered.filter((c) => !isFavorite(c)),
    [filtered, isFavorite],
  )

  const byAiCategory = useMemo(
    () =>
      groupChannelsByAiCategory(
        forCategories,
        useDbCategories ? dbCategories : null,
      ),
    [forCategories, useDbCategories, dbCategories],
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
      <div className="home-hero" aria-hidden>
        <div className="home-hero__orb home-hero__orb--a" />
        <div className="home-hero__orb home-hero__orb--b" />
        <div className="home-hero__orb home-hero__orb--c" />
      </div>

      <header className="home-header">
        <div className="home-header__top">
          <p className="home-eyebrow">Channel guide</p>
          <h1 className="home-title">
            <span className="home-title__gradient">Live TV</span>
          </h1>
          <p className="home-subtitle">
            <span className="home-stat-badge">{ordered.length} channels</span>
            <span className="home-subtitle__sep" aria-hidden>
              ·
            </span>
            Grouped by topic · global CH numbers · digits + Enter · favorites
          </p>
        </div>
        <div className="home-header__controls">
          <SearchBar
            value={query}
            onChange={(v) => {
              setQuery(v)
              if (v.trim() !== "") setReorderMode(false)
            }}
            id="home-search"
          />
          <div className="home-header__reorder">
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
              {reorderMode ? "Done reordering" : "Reorder channels"}
            </button>
            {hasCustomChannelOrder && (
              <button
                type="button"
                className="btn-ghost home-reorder-reset"
                onClick={() => resetChannelOrder()}
                title="Restore alphabetical order (A–Z)"
              >
                Reset A–Z
              </button>
            )}
          </div>
          <StyleToolbar />
          <Link to="/multiview" className="btn-ghost home-multiview-link">
            Multi-view
          </Link>
        </div>
      </header>

      <DigitOverlay
        buffer={digitBuffer}
        hint={ordered.length ? `CH 1–${ordered.length} · Enter` : undefined}
      />

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
                <div className={layoutClass}>
                  {favoritesFiltered.map((ch) => renderChannel(ch))}
                </div>
              </section>
            )}

            {[...byAiCategory.entries()].map(([aiKey, list]) => {
              const catId = `cat-ai-${aiKey.replace(/[^\w-]+/g, "-").slice(0, 48)}`
              return (
                <section key={aiKey} className="cat-section" aria-labelledby={catId}>
                  <h2 id={catId} className="cat-section__title">
                    {formatAiCategoryTitle(aiKey, useDbCategories ? dbCategories : null)}
                  </h2>
                  <div className={layoutClass}>{list.map((ch) => renderChannel(ch))}</div>
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
