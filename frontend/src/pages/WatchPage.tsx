import { useCallback, useEffect, useRef, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import {
  Home,
  LayoutGrid,
  Lightbulb,
  List,
  Maximize2,
  Minimize2,
  PanelBottom,
  PictureInPicture2,
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
import type { AmbilightSettings, AmbilightSide } from "@/components/VideoPlayer"
import { useChannels } from "@/context/ChannelsContext"
import { useRecentlyWatched } from "@/context/RecentlyWatchedContext"
import { channelNumber } from "@/lib/channelNumber"
import { useTvRemote, DIGIT_AUTO_SUBMIT_AFTER_MS } from "@/hooks/useTvRemote"
import { useMobileViewport } from "@/hooks/useMobileViewport"
import { channelFromRouteKey, watchUrlForChannel } from "@/lib/paths"
import { channelLogoUrl } from "@/lib/publicUrl"

const AMBILIGHT_KEY = "tv2-ambilight-settings"
const CHANNEL_NUMBER_HINT_KEY = "tv2-channel-number-hint-dismissed"
const AMBILIGHT_MIN_OPACITY = 0.2
const AMBILIGHT_MAX_OPACITY = 2
const WATCH_CHROME_AUTOHIDE_MS = 3200

const DEFAULT_AMBILIGHT_SETTINGS: AmbilightSettings = {
  enabled: true,
  opacity: 1.2,
  performanceMode: false,
  sides: {
    top: true,
    right: true,
    bottom: true,
    left: true,
  },
}

type DeviceCapabilityNavigator = Navigator & {
  deviceMemory?: number
}

function shouldDisableAmbilightByDefault(): boolean {
  if (typeof navigator === "undefined") return false
  const nav = navigator as DeviceCapabilityNavigator
  const memoryGb = nav.deviceMemory
  const cores = nav.hardwareConcurrency

  if (typeof memoryGb === "number" && memoryGb <= 2) return true
  if (typeof cores === "number" && cores <= 2) return true
  if (
    typeof memoryGb === "number" &&
    typeof cores === "number" &&
    memoryGb <= 4 &&
    cores <= 4
  ) {
    return true
  }
  return false
}

function defaultAmbilightSettings(): AmbilightSettings {
  if (!shouldDisableAmbilightByDefault()) return DEFAULT_AMBILIGHT_SETTINGS
  return {
    ...DEFAULT_AMBILIGHT_SETTINGS,
    enabled: false,
    performanceMode: true,
  }
}

const AMBILIGHT_SIDES: { id: AmbilightSide; label: string }[] = [
  { id: "top", label: "Top" },
  { id: "right", label: "Right" },
  { id: "bottom", label: "Bottom" },
  { id: "left", label: "Left" },
]

function readAmbilightSettings(): AmbilightSettings {
  try {
    const raw = localStorage.getItem(AMBILIGHT_KEY)
    const defaults = defaultAmbilightSettings()
    if (!raw) return defaults
    const parsed = JSON.parse(raw) as Partial<AmbilightSettings>
    return {
      enabled:
        typeof parsed.enabled === "boolean"
          ? parsed.enabled
          : defaults.enabled,
      opacity:
        typeof parsed.opacity === "number"
          ? Math.max(AMBILIGHT_MIN_OPACITY, Math.min(AMBILIGHT_MAX_OPACITY, parsed.opacity))
          : defaults.opacity,
      performanceMode:
        typeof parsed.performanceMode === "boolean"
          ? parsed.performanceMode
          : defaults.performanceMode,
      sides: {
        top: parsed.sides?.top ?? defaults.sides.top,
        right: parsed.sides?.right ?? defaults.sides.right,
        bottom: parsed.sides?.bottom ?? defaults.sides.bottom,
        left: parsed.sides?.left ?? defaults.sides.left,
      },
    }
  } catch {
    return defaultAmbilightSettings()
  }
}

export function WatchPage() {
  const mobile = useMobileViewport()
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
  const [ambilightOpen, setAmbilightOpen] = useState(false)
  const [ambilight, setAmbilight] = useState(readAmbilightSettings)
  const [chromeHidden, setChromeHidden] = useState(false)
  const [numpadOpen, setNumpadOpen] = useState(false)
  const [sidebarSearchFocused, setSidebarSearchFocused] = useState(false)
  const [channelHintVisible, setChannelHintVisible] = useState(() => {
    try {
      return localStorage.getItem(CHANNEL_NUMBER_HINT_KEY) !== "1"
    } catch {
      return true
    }
  })
  const chromeHideTimer = useRef<number | null>(null)

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

  useEffect(() => {
    try {
      localStorage.setItem(AMBILIGHT_KEY, JSON.stringify(ambilight))
    } catch {
      /* ignore */
    }
  }, [ambilight])

  const toggleAmbilight = useCallback(() => {
    setAmbilight((current) => ({ ...current, enabled: !current.enabled }))
  }, [])

  const toggleAmbilightSide = useCallback((side: AmbilightSide) => {
    setAmbilight((current) => ({
      ...current,
      sides: {
        ...current.sides,
        [side]: !current.sides[side],
      },
    }))
  }, [])

  const setAmbilightOpacity = useCallback((value: number) => {
    setAmbilight((current) => ({
      ...current,
      opacity: Math.max(AMBILIGHT_MIN_OPACITY, Math.min(AMBILIGHT_MAX_OPACITY, value)),
    }))
  }, [])

  const toggleAmbilightPerformanceMode = useCallback(() => {
    setAmbilight((current) => ({
      ...current,
      performanceMode: !current.performanceMode,
    }))
  }, [])

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
    appendDigit: appendDigitRaw,
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

  const appendDigit = useCallback(
    (digit: string) => {
      appendDigitRaw(digit)
      if (mobile) setNumpadOpen(true)
    },
    [appendDigitRaw, mobile],
  )

  const submitDigitsFromNumpad = useCallback(() => {
    submitDigits()
    if (mobile) setNumpadOpen(false)
  }, [mobile, submitDigits])

  const dismissChannelHint = useCallback(() => {
    setChannelHintVisible(false)
    try {
      localStorage.setItem(CHANNEL_NUMBER_HINT_KEY, "1")
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    if (!channelHintVisible) return
    const id = window.setTimeout(dismissChannelHint, 8000)
    return () => window.clearTimeout(id)
  }, [channelHintVisible, dismissChannelHint])

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

  const keepChromeVisible = useCallback(() => {
    setChromeHidden(false)
    if (chromeHideTimer.current !== null) {
      window.clearTimeout(chromeHideTimer.current)
    }
    if (sidebarSearchFocused) {
      chromeHideTimer.current = null
      return
    }
    chromeHideTimer.current = window.setTimeout(() => {
      setAmbilightOpen(false)
      setRelatedDockOpen(false)
      writeRelatedDockOpenToStorage(false)
      setChromeHidden(true)
    }, WATCH_CHROME_AUTOHIDE_MS)
  }, [sidebarSearchFocused])

  useEffect(() => {
    keepChromeVisible()

    const events = [
      "mousemove",
      "mousedown",
      "touchstart",
      "touchmove",
      "wheel",
      "keydown",
      "focusin",
    ] as const

    events.forEach((eventName) => {
      window.addEventListener(eventName, keepChromeVisible, { passive: true })
    })

    return () => {
      if (chromeHideTimer.current !== null) {
        window.clearTimeout(chromeHideTimer.current)
        chromeHideTimer.current = null
      }
      events.forEach((eventName) => {
        window.removeEventListener(eventName, keepChromeVisible)
      })
    }
  }, [keepChromeVisible])

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
  const ambilightMenu = (
    <div className="ambilight-menu">
      <label className="ambilight-menu__row">
        <input
          type="checkbox"
          checked={ambilight.enabled}
          onChange={toggleAmbilight}
        />
        <span>Enable Ambilight</span>
      </label>
      <label className="ambilight-menu__row">
        <input
          type="checkbox"
          checked={ambilight.performanceMode}
          onChange={toggleAmbilightPerformanceMode}
        />
        <span>Performance mode</span>
      </label>
      <div className="ambilight-menu__sides">
        {AMBILIGHT_SIDES.map((side) => (
          <button
            key={side.id}
            type="button"
            className={
              ambilight.sides[side.id]
                ? "ambilight-menu__side is-on"
                : "ambilight-menu__side"
            }
            onClick={() => toggleAmbilightSide(side.id)}
            aria-pressed={ambilight.sides[side.id]}
          >
            {side.label}
          </button>
        ))}
      </div>
      <label className="ambilight-menu__range">
        <span>Opacity {Math.round(ambilight.opacity * 100)}%</span>
        <input
          type="range"
          min={AMBILIGHT_MIN_OPACITY}
          max={AMBILIGHT_MAX_OPACITY}
          step="0.05"
          value={ambilight.opacity}
          onChange={(event) =>
            setAmbilightOpacity(Number(event.target.value))
          }
        />
      </label>
    </div>
  )

  return (
    <div
      className={`watch-page ${theaterMode ? "watch-page--theater" : ""} ${
        chromeHidden ? "watch-page--chrome-hidden" : ""
      }`}
    >
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
                <div className="watch-bar__menu">
                  <button
                    type="button"
                    className={
                      ambilight.enabled
                        ? "watch-bar__pill watch-bar__pill--icon watch-bar__pill--active"
                        : "watch-bar__pill watch-bar__pill--icon"
                    }
                    onClick={() => setAmbilightOpen((open) => !open)}
                    aria-label="Ambilight settings"
                    title="Ambilight settings"
                    aria-expanded={ambilightOpen}
                  >
                    <Lightbulb size={20} strokeWidth={2} aria-hidden />
                  </button>
                </div>
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
            {ambilightOpen && ambilightMenu}

            <div className="watch-stage">
              {channel.stream_url || channel.raw_iframe_src ? (
                <StreamPlayer
                  channel={channel}
                  className="watch-player"
                  onVideoRef={setPipVideoRef}
                  ambilight={ambilight}
                />
              ) : (
                <p className="watch-stage__empty muted">
                  No stream URL for this channel.
                </p>
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
              submitDigits={submitDigitsFromNumpad}
              backspaceDigit={backspaceDigit}
              className={mobile && numpadOpen ? "channel-numpad--watch" : "channel-numpad--watch-closed"}
            />
            {mobile && (
              <button
                type="button"
                className="channel-numpad-toggle"
                onClick={() => {
                  setNumpadOpen((open) => !open)
                  dismissChannelHint()
                }}
                aria-expanded={numpadOpen}
                aria-label={numpadOpen ? "Hide channel number pad" : "Show channel number pad"}
              >
                123
              </button>
            )}
            {channelHintVisible && (
              <div className="channel-number-hint" role="status">
                <span>
                  {mobile
                    ? "Tap 123 to enter a channel number"
                    : "Use number keys to jump channels"}
                </span>
                <button
                  type="button"
                  onClick={dismissChannelHint}
                  aria-label="Dismiss channel number hint"
                >
                  x
                </button>
              </div>
            )}
          </div>

          {!theaterMode && (
            <WatchSidebar
              ordered={ordered}
              currentPageUrl={channel.page_url}
              collapsed={sidebarCollapsed}
              onToggleCollapsed={toggleSidebar}
              onSearchFocusChange={setSidebarSearchFocused}
            />
          )}
        </div>
      </div>
    </div>
  )
}
