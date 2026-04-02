import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react"
import { Link } from "react-router-dom"
import { ChevronLeft, ChevronRight, Star } from "lucide-react"
import { SearchBar } from "@/components/SearchBar"
import { channelNumber } from "@/lib/channelNumber"
import { useFavorites } from "@/context/FavoritesContext"
import type { Channel } from "@/types/channel"
import { watchUrlForChannel } from "@/lib/paths"
import { publicUrl } from "@/lib/publicUrl"

export const WATCH_SIDEBAR_COLLAPSED_KEY = "tv2-watch-sidebar-collapsed"

function SidebarChannelLink({
  ch,
  ordered,
  currentPageUrl,
  activeRef,
  favorite,
}: {
  ch: Channel
  ordered: Channel[]
  currentPageUrl: string
  activeRef: RefObject<HTMLAnchorElement | null>
  favorite?: boolean
}) {
  const no = channelNumber(ordered, ch)
  const active = ch.page_url === currentPageUrl
  const logo = ch.logo ? publicUrl(ch.logo) : null
  const to = watchUrlForChannel(ch)
  return (
    <Link
      ref={active ? activeRef : undefined}
      to={to}
      className={`watch-sidebar__item ${active ? "is-active" : ""} ${favorite ? "watch-sidebar__item--favorite" : ""}`.trim()}
      title={ch.name ?? ch.slug}
    >
      <span className="watch-sidebar__ch">{no}</span>
      <span className="watch-sidebar__logo">
        {logo ? (
          <img src={logo} alt="" loading="lazy" decoding="async" />
        ) : (
          <span className="watch-sidebar__logo-ph">TV</span>
        )}
      </span>
      <span className="watch-sidebar__name">{ch.name ?? ch.slug}</span>
    </Link>
  )
}

type Props = {
  ordered: Channel[]
  currentPageUrl: string
  collapsed: boolean
  onToggleCollapsed: () => void
}

export function WatchSidebar({
  ordered,
  currentPageUrl,
  collapsed,
  onToggleCollapsed,
}: Props) {
  const activeRef = useRef<HTMLAnchorElement | null>(null)
  const [query, setQuery] = useState("")
  const { favoriteChannelsInOrder } = useFavorites()

  const favoritesOrdered = useMemo(
    () => favoriteChannelsInOrder(ordered),
    [ordered, favoriteChannelsInOrder],
  )

  const matchesFilter = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (ch: Channel) => {
      if (!q) return true
      const name = (ch.name ?? ch.slug).toLowerCase()
      const slug = ch.slug.toLowerCase()
      const no = String(channelNumber(ordered, ch))
      return (
        name.includes(q) || slug.includes(q) || no === q || no.includes(q)
      )
    }
  }, [ordered, query])

  const { favoriteRows, restRows } = useMemo(() => {
    const fav = favoritesOrdered.filter(matchesFilter)
    const favUrls = new Set(fav.map((c) => c.page_url))
    const rest = ordered.filter(
      (ch) => matchesFilter(ch) && !favUrls.has(ch.page_url),
    )
    return { favoriteRows: fav, restRows: rest }
  }, [ordered, favoritesOrdered, matchesFilter])

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }, [currentPageUrl])

  return (
    <aside
      className={`watch-sidebar watch-sidebar--end ${collapsed ? "watch-sidebar--collapsed" : ""}`}
      aria-label="Channels"
    >
      <div className="watch-sidebar__head">
        <button
          type="button"
          className="watch-sidebar__collapse icon-btn"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "Expand channel list" : "Collapse channel list"}
          title={collapsed ? "Show channels" : "Hide channels"}
        >
          {collapsed ? (
            <ChevronLeft size={22} strokeWidth={2} aria-hidden />
          ) : (
            <ChevronRight size={22} strokeWidth={2} aria-hidden />
          )}
        </button>
        {!collapsed && <span className="watch-sidebar__title">Channels</span>}
      </div>
      {!collapsed && (
        <>
          <div className="watch-sidebar__search">
            <SearchBar
              id="watch-sidebar-search"
              value={query}
              onChange={setQuery}
              placeholder="Filter channels…"
            />
          </div>
          <nav className="watch-sidebar__list" aria-label="Channel list">
            {favoriteRows.length === 0 && restRows.length === 0 ? (
              <p className="watch-sidebar__empty muted">No matches</p>
            ) : (
              <>
                {favoriteRows.length > 0 && (
                  <div className="watch-sidebar__block">
                    <div className="watch-sidebar__subhead">
                      <Star
                        size={12}
                        strokeWidth={2.5}
                        className="watch-sidebar__subhead-icon"
                        aria-hidden
                      />
                      Favorites
                    </div>
                    {favoriteRows.map((ch) => (
                      <SidebarChannelLink
                        key={ch.page_url}
                        ch={ch}
                        ordered={ordered}
                        currentPageUrl={currentPageUrl}
                        activeRef={activeRef}
                        favorite
                      />
                    ))}
                  </div>
                )}
                {restRows.length > 0 && (
                  <div className="watch-sidebar__block">
                    {favoriteRows.length > 0 && (
                      <div className="watch-sidebar__subhead watch-sidebar__subhead--muted">
                        All channels
                      </div>
                    )}
                    {restRows.map((ch) => (
                      <SidebarChannelLink
                        key={ch.page_url}
                        ch={ch}
                        ordered={ordered}
                        currentPageUrl={currentPageUrl}
                        activeRef={activeRef}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </nav>
        </>
      )}
    </aside>
  )
}

export function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(WATCH_SIDEBAR_COLLAPSED_KEY) === "1"
  } catch {
    return false
  }
}

export function writeSidebarCollapsed(collapsed: boolean) {
  try {
    localStorage.setItem(WATCH_SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0")
  } catch {
    /* ignore */
  }
}
