import { useCallback, useEffect, useRef, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Home,
  LayoutGrid,
  List,
  Maximize2,
  Minimize2,
  PanelBottom,
  PictureInPicture2,
  Tv,
} from "lucide-react"
import { ChannelNumpad } from "@/components/ChannelNumpad"
import { DigitOverlay } from "@/components/DigitOverlay"
import { FavoriteButton } from "@/components/FavoriteButton"
import { LiveClock } from "@/components/LiveClock"
import {
  WatchSidebar,
  readSidebarCollapsedForViewport,
  writeSidebarCollapsed,
} from "@/components/WatchSidebar"
import {
  RelatedChannels,
  hasRelatedChannels,
  readRelatedDockOpenForViewport,
  writeRelatedDockOpenToStorage,
} from "@/components/RelatedChannels"
import {
  StreamPlayer,
  channelSupportsPictureInPicture,
} from "@/components/StreamPlayer"
import { useChannels } from "@/context/ChannelsContext"
import { useRecentlyWatched } from "@/context/RecentlyWatchedContext"
import { channelNumber } from "@/lib/channelNumber"
import { useTvRemote, DIGIT_AUTO_SUBMIT_AFTER_MS } from "@/hooks/useTvRemote"
import { channelFromRouteKey, watchUrlForChannel } from "@/lib/paths"
import { channelLogoUrl } from "@/lib/publicUrl"

export function WatchPage() {
  const { channelKey } = useParams<{ channelKey: string }>()
  const navigate = useNavigate()
  const { ordered, status } = useChannels()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    readSidebarCollapsedForViewport,
  )
  const [theaterMode, setTheaterMode] = useState(false)
  const [relatedDockOpen, setRelatedDockOpen] = useState(
    readRelatedDockOpenForViewport,
  )
  const [pipVideoEl, setPipVideoEl] = useState<HTMLVideoElement | null>(null)
  const [pipSupported, setPipSupported] = useState(false)
  const [playerError, setPlayerError] = useState<string | null>(null)

  const setPipVideoRef = useCallback((el: HTMLVideoElement | null) => {
    setPipVideoEl(el)
  }, [])

  useEffect(() => {
    setPipSupported(
      typeof document !== "undefined" &&
        "pictureInPictureEnabled" in document &&
        document.pictureInPictureEnabled,
    )
  }, [])

  const togglePip = useCallback(async () => {
    const v = pipVideoEl
    if (!v) return
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture()
      } else {
        await v.requestPictureInPicture()
      }
    } catch {
      /* PiP unavailable */
    }
  }, [pipVideoEl])

  const { recordVisit } = useRecentlyWatched()

  const channel = channelFromRouteKey(ordered, channelKey)

  const index = channel
    ? ordered.findIndex((c) => c.page_url === channel.page_url)
    : -1

  const chNo = channel ? channelNumber(ordered, channel) : 0

  const goPrev = useCallback(() => {
    if (ordered.length === 0 || index < 0) return
    const prev = ordered[(index - 1 + ordered.length) % ordered.length]
    navigate(watchUrlForChannel(prev))
  }, [ordered, index, navigate])

  const goNext = useCallback(() => {
    if (ordered.length === 0 || index < 0) return
    const next = ordered[(index + 1) % ordered.length]
    navigate(watchUrlForChannel(next))
  }, [ordered, index, navigate])

  const {
    digitBuffer,
    appendDigit,
    submitDigits,
    backspaceDigit,
  } = useTvRemote({
    onGoToChannelNumber: (n) => {
      const ch = ordered[n - 1]
      if (ch) navigate(watchUrlForChannel(ch))
    },
    onChannelUp: goPrev,
    onChannelDown: goNext,
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      if (theaterMode) {
        e.preventDefault()
        setTheaterMode(false)
        return
      }
      e.preventDefault()
      navigate("/")
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [navigate, theaterMode])

  useEffect(() => {
    setTheaterMode(false)
    setPlayerError(null)
  }, [channel?.page_url])

  useEffect(() => {
    if (channel) recordVisit(channel)
  }, [channel, recordVisit])

  useEffect(() => {
    if (!channel) return
    const base = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "")
    fetch(`${base}/api/analytics/view`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel_slug: channel.slug, channel_name: channel.name ?? null }),
    }).catch(() => {})
  }, [channel?.page_url])

  useEffect(() => {
    if (theaterMode && relatedDockOpen) {
      setRelatedDockOpen(false)
      writeRelatedDockOpenToStorage(false)
    }
  }, [theaterMode, relatedDockOpen])

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((c) => {
      const next = !c
      writeSidebarCollapsed(next)
      return next
    })
  }, [])

  const toggleTheater = () => {
    setTheaterMode((v) => !v)
  }

  const toggleRelatedDock = useCallback(() => {
    setRelatedDockOpen((v) => {
      const next = !v
      writeRelatedDockOpenToStorage(next)
      return next
    })
  }, [])

  const closeRelatedDock = useCallback(() => {
    setRelatedDockOpen(false)
    writeRelatedDockOpenToStorage(false)
  }, [])

  const swipeStartX = useRef<number | null>(null)
  const swipeStartY = useRef<number | null>(null)

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    swipeStartX.current = e.touches[0].clientX
    swipeStartY.current = e.touches[0].clientY
  }, [])

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (swipeStartX.current === null || swipeStartY.current === null) return
      const startX = swipeStartX.current
      const startY = swipeStartY.current
      swipeStartX.current = null
      swipeStartY.current = null

      const dx = e.changedTouches[0].clientX - startX
      const dy = e.changedTouches[0].clientY - startY

      if (Math.abs(dy) > Math.abs(dx)) return // primarily vertical — ignore
      if (Math.abs(dx) < 50) return // too short

      if (theaterMode) return

      if (dx < 0 && !sidebarCollapsed) {
        // swipe left → close sidebar
        setSidebarCollapsed(true)
        writeSidebarCollapsed(true)
      } else if (dx > 0 && sidebarCollapsed && startX < window.innerWidth * 0.25) {
        // swipe right from left edge → open sidebar
        setSidebarCollapsed(false)
        writeSidebarCollapsed(false)
      }
    },
    [theaterMode, sidebarCollapsed],
  )

  if (status !== "ready" || !ordered.length) {
    return (
      <div className="page page--center">
        <p className="muted">Loading…</p>
        <Link to="/">Back home</Link>
      </div>
    )
  }

  if (!channel) {
    return (
      <div className="page page--center watch-missing">
        <p>Channel not found.</p>
        <Link to="/" className="btn-primary">
          Home
        </Link>
      </div>
    )
  }

  const logoSrc = channelLogoUrl(channel.logo)
  const showRelatedUi = hasRelatedChannels(ordered, channel)

  return (
    <div className={`watch-page ${theaterMode ? "watch-page--theater" : ""}`}>
      <DigitOverlay
        buffer={digitBuffer}
        hint={
          ordered.length
            ? `CH ${chNo} / ${ordered.length} · ↑↓ · Esc ${theaterMode ? "exit expanded view" : "back"} · idle ${DIGIT_AUTO_SUBMIT_AFTER_MS / 1000}s = go`
            : undefined
        }
      />

      <div className="watch-shell">
        <div
          className="watch-body"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <div className="watch-main">
            <header className="watch-bar watch-bar--overlay">
              <div className="watch-bar__brand">
                {logoSrc ? (
                  <span className="watch-bar__logo-wrap">
                    <img
                      className="watch-bar__logo"
                      src={logoSrc}
                      alt=""
                      width={44}
                      height={44}
                    />
                  </span>
                ) : (
                  <span className="watch-bar__logo-ph" aria-hidden>
                    TV
                  </span>
                )}
                <h1 className="watch-bar__title-line">
                  <span className="watch-bar__num">{chNo}.</span>
                  <span className="watch-bar__name">
                    {channel.name ?? channel.slug}
                  </span>
                </h1>
              </div>

              <div className="watch-bar__actions watch-bar__actions--pills">
                <Link
                  to="/"
                  className="watch-bar__pill watch-bar__pill--home"
                  title="Guide"
                >
                  <Home size={18} strokeWidth={2} aria-hidden />
                  Home
                </Link>
                <Link
                  to="/multiview"
                  className="watch-bar__pill"
                  title="Multi-view (grid)"
                >
                  <LayoutGrid size={18} strokeWidth={2} aria-hidden />
                  Multi-view
                </Link>
                <FavoriteButton
                  channel={channel}
                  className="favorite-btn--bar watch-bar__pill-icon"
                  label="Favorite"
                  iconSize={20}
                />
                {showRelatedUi && !theaterMode && (
                  <button
                    type="button"
                    className={
                      relatedDockOpen
                        ? "watch-bar__pill watch-bar__pill--related-active"
                        : "watch-bar__pill"
                    }
                    onClick={toggleRelatedDock}
                    title={
                      relatedDockOpen
                        ? "Hide related channels"
                        : "Show related channels"
                    }
                  >
                    <PanelBottom size={18} strokeWidth={2} aria-hidden />
                    Related
                  </button>
                )}
                {!theaterMode && (
                  <button
                    type="button"
                    className="watch-bar__pill"
                    onClick={toggleSidebar}
                    title={
                      sidebarCollapsed ? "Show channel list" : "Hide channel list"
                    }
                    aria-label="Channels"
                  >
                    <List size={18} strokeWidth={2} aria-hidden />
                    Channels
                  </button>
                )}
                <button
                  type="button"
                  className="watch-bar__pill watch-bar__pill--icon"
                  onClick={goPrev}
                  aria-label="Previous channel"
                  title="Previous channel"
                >
                  <ChevronLeft size={20} strokeWidth={2} aria-hidden />
                </button>
                <button
                  type="button"
                  className="watch-bar__pill watch-bar__pill--icon"
                  onClick={goNext}
                  aria-label="Next channel"
                  title="Next channel"
                >
                  <ChevronRight size={20} strokeWidth={2} aria-hidden />
                </button>
                <Link
                  to="/"
                  className="watch-bar__pill watch-bar__pill--icon"
                  title="TV guide"
                  aria-label="TV guide"
                >
                  <Tv size={20} strokeWidth={2} aria-hidden />
                </Link>
                {pipSupported && channelSupportsPictureInPicture(channel) && (
                  <button
                    type="button"
                    className="watch-bar__pill watch-bar__pill--icon"
                    onClick={() => void togglePip()}
                    disabled={!pipVideoEl}
                    aria-label="Picture in picture"
                    title="Picture in picture"
                  >
                    <PictureInPicture2 size={20} strokeWidth={2} aria-hidden />
                  </button>
                )}
                <button
                  type="button"
                  className="watch-bar__pill watch-bar__pill--icon"
                  onClick={toggleTheater}
                  aria-label={
                    theaterMode ? "Show channel list" : "Expand player in window"
                  }
                  title={
                    theaterMode
                      ? "Restore layout"
                      : "Expand player (fills window)"
                  }
                >
                  {theaterMode ? (
                    <Minimize2 size={20} strokeWidth={2} aria-hidden />
                  ) : (
                    <Maximize2 size={20} strokeWidth={2} aria-hidden />
                  )}
                </button>
                <LiveClock />
              </div>
            </header>

            <div className="watch-stage">
              {playerError ? (
                <div className="watch-error">
                  <AlertCircle size={52} className="watch-error__icon" aria-hidden />
                  <p className="watch-error__title">Stream unavailable</p>
                  <p className="watch-error__msg">{playerError}</p>
                  <div className="watch-error__actions">
                    <Link to="/" className="btn-primary">
                      <Home size={16} aria-hidden /> Back to guide
                    </Link>
                    <button type="button" className="btn-ghost" onClick={goNext}>
                      Try next channel
                    </button>
                  </div>
                </div>
              ) : channel.stream_url || channel.raw_iframe_src ? (
                <StreamPlayer
                  channel={channel}
                  className="watch-player"
                  onVideoRef={setPipVideoRef}
                  onError={setPlayerError}
                />
              ) : (
                <div className="watch-error">
                  <AlertCircle size={52} className="watch-error__icon" aria-hidden />
                  <p className="watch-error__title">No stream available</p>
                  <p className="watch-error__msg">This channel has no stream URL configured.</p>
                  <div className="watch-error__actions">
                    <Link to="/" className="btn-primary">
                      <Home size={16} aria-hidden /> Back to guide
                    </Link>
                    <button type="button" className="btn-ghost" onClick={goNext}>
                      Try next channel
                    </button>
                  </div>
                </div>
              )}
            </div>

            <RelatedChannels
              channels={ordered}
              current={channel}
              open={relatedDockOpen}
              onClose={closeRelatedDock}
            />

            <ChannelNumpad
              appendDigit={appendDigit}
              submitDigits={submitDigits}
              backspaceDigit={backspaceDigit}
            />
          </div>

          {!theaterMode && (
            <WatchSidebar
              ordered={ordered}
              currentPageUrl={channel.page_url}
              collapsed={sidebarCollapsed}
              onToggleCollapsed={toggleSidebar}
            />
          )}
        </div>
      </div>
    </div>
  )
}
