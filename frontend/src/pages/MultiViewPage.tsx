import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { ArrowLeft, Minimize2, Volume2, VolumeX, X } from "lucide-react"
import {
  StreamPlayer,
  channelSupportsMultiViewStream,
} from "@/components/StreamPlayer"
import { useChannels } from "@/context/ChannelsContext"
import type { Channel } from "@/types/channel"
import { watchUrlForChannel } from "@/lib/paths"
import { publicUrl } from "@/lib/publicUrl"

const STORAGE_KEY = "tv2_multiview_v1"
const SLOT_COUNT = 9

type LayoutMode = 2 | 4 | 9

type Persisted = {
  layout: LayoutMode
  slots: (string | null)[]
  audioSlot: number
}

function loadPersisted(): Persisted | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as Persisted
    if (![2, 4, 9].includes(p.layout)) return null
    if (!Array.isArray(p.slots) || p.slots.length !== SLOT_COUNT) return null
    if (
      typeof p.audioSlot !== "number" ||
      p.audioSlot < 0 ||
      p.audioSlot >= SLOT_COUNT
    ) {
      return null
    }
    return p
  } catch {
    return null
  }
}

function savePersisted(p: Persisted) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p))
  } catch {
    /* ignore */
  }
}

function visibleSlots(layout: LayoutMode): number {
  return layout === 2 ? 2 : layout === 4 ? 4 : 9
}

export function MultiViewPage() {
  const { ordered, status } = useChannels()
  const persisted = useMemo(() => loadPersisted(), [])
  const [layout, setLayout] = useState<LayoutMode>(persisted?.layout ?? 4)
  const [slots, setSlots] = useState<(string | null)[]>(
    () => persisted?.slots ?? Array(SLOT_COUNT).fill(null),
  )
  const [audioSlot, setAudioSlot] = useState(persisted?.audioSlot ?? 0)
  const [pickerIndex, setPickerIndex] = useState<number | null>(null)
  const [filter, setFilter] = useState("")
  const [maximizedSlot, setMaximizedSlot] = useState<number | null>(null)

  useEffect(() => {
    savePersisted({ layout, slots, audioSlot })
  }, [layout, slots, audioSlot])

  const n = visibleSlots(layout)

  useEffect(() => {
    const inRange = audioSlot < n && slots[audioSlot] !== null
    if (inRange) return
    const idx = slots.slice(0, n).findIndex((s) => s !== null)
    setAudioSlot(idx >= 0 ? idx : 0)
  }, [layout, n, slots, audioSlot])

  useEffect(() => {
    if (maximizedSlot === null) return
    if (maximizedSlot >= n || !slots[maximizedSlot]) {
      setMaximizedSlot(null)
    }
  }, [layout, n, slots, maximizedSlot])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      if (pickerIndex !== null) {
        e.preventDefault()
        setPickerIndex(null)
        return
      }
      if (maximizedSlot === null) return
      e.preventDefault()
      setMaximizedSlot(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [pickerIndex, maximizedSlot])

  const channelForUrl = (pageUrl: string | null): Channel | undefined => {
    if (!pageUrl) return undefined
    return ordered.find((c) => c.page_url === pageUrl)
  }

  const pickable = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return ordered.filter((c) => {
      if (!channelSupportsMultiViewStream(c)) return false
      if (!q) return true
      const name = (c.name ?? "").toLowerCase()
      return name.includes(q) || c.slug.toLowerCase().includes(q)
    })
  }, [ordered, filter])

  const applyChannel = (slotIndex: number, pageUrl: string | null) => {
    setSlots((prev) => {
      const next = [...prev]
      next[slotIndex] = pageUrl
      return next
    })
    if (pageUrl) setAudioSlot(slotIndex)
    setPickerIndex(null)
    setFilter("")
  }

  const clearSlot = (slotIndex: number) => {
    setMaximizedSlot((m) => (m === slotIndex ? null : m))
    setSlots((prev) => {
      const next = [...prev]
      next[slotIndex] = null
      return next
    })
  }

  const pickChannel = (ch: Channel) => {
    if (pickerIndex === null) return
    applyChannel(pickerIndex, ch.page_url)
  }

  const focusAudio = (slotIndex: number) => {
    if (!slots[slotIndex]) return
    setAudioSlot(slotIndex)
  }

  const openMaximized = (slotIndex: number) => {
    if (!slots[slotIndex]) return
    setAudioSlot(slotIndex)
    setMaximizedSlot(slotIndex)
  }

  const audioChannel =
    audioSlot < n && slots[audioSlot]
      ? channelForUrl(slots[audioSlot])
      : undefined
  const singlePlayerUrl = audioChannel
    ? watchUrlForChannel(audioChannel)
    : undefined

  if (status !== "ready" || !ordered.length) {
    return (
      <div className="page page--center">
        <p className="muted">Loading…</p>
        <Link to="/">Back</Link>
      </div>
    )
  }

  return (
    <div className="multiview-page">
      <header className="multiview-toolbar">
        <div className="multiview-toolbar__left">
          <Link to="/" className="multiview-toolbar__back btn-ghost">
            <ArrowLeft size={18} strokeWidth={2} aria-hidden />
            Guide
          </Link>
          {singlePlayerUrl ? (
            <Link
              to={singlePlayerUrl}
              className="multiview-toolbar__single btn-ghost"
              title="Open this channel in the full player"
            >
              Single player
            </Link>
          ) : null}
        </div>
        <div className="multiview-toolbar__layouts" role="group" aria-label="Grid size">
          {([2, 4, 9] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={
                layout === m
                  ? "multiview-layout-btn multiview-layout-btn--active"
                  : "multiview-layout-btn"
              }
              onClick={() => setLayout(m)}
            >
              {m === 2 ? "2" : m === 4 ? "4" : "9"}
            </button>
          ))}
        </div>
        <p className="multiview-toolbar__hint muted">
          One pane has sound · click pane to expand · speaker icon: sound only · Esc: back to grid
        </p>
      </header>

      <div className="multiview-stage">
      <div className={`multiview-grid multiview-grid--${layout}`}>
        {Array.from({ length: n }, (_, i) => {
          const pageUrl = slots[i]
          const ch = channelForUrl(pageUrl ?? null)
          const isAudio = i === audioSlot && Boolean(ch)
          const incompatible = Boolean(ch && !channelSupportsMultiViewStream(ch))

          const isMax = maximizedSlot === i

          return (
            <div
              key={i}
              className={
                [
                  "multiview-pane",
                  isAudio ? "multiview-pane--audio" : "",
                  isMax ? "multiview-pane--maximized" : "",
                ]
                  .filter(Boolean)
                  .join(" ")
              }
              onClick={() => {
                if (!pageUrl || !ch) return
                if (maximizedSlot === i) return
                openMaximized(i)
              }}
              role="region"
              aria-label={
                ch ? `Pane ${i + 1} ${ch.name ?? ch.slug}` : `Empty pane ${i + 1}`
              }
            >
              {!pageUrl || !ch ? (
                <button
                  type="button"
                  className="multiview-pane__empty"
                  onClick={(e) => {
                    e.stopPropagation()
                    setPickerIndex(i)
                  }}
                >
                  + Add channel
                </button>
              ) : incompatible ? (
                <>
                  {isMax ? (
                    <div className="multiview-pane__maxbar">
                      <button
                        type="button"
                        className="multiview-pane__maxbar-btn"
                        onClick={(e) => {
                          e.stopPropagation()
                          setMaximizedSlot(null)
                        }}
                      >
                        <Minimize2 size={16} strokeWidth={2} aria-hidden />
                        Back to grid
                      </button>
                      <span className="multiview-pane__maxbar-title">
                        {ch.name ?? ch.slug}
                      </span>
                    </div>
                  ) : null}
                  <div className="multiview-pane__embed">
                    {ch.logo ? (
                      <img
                        src={publicUrl(ch.logo)}
                        alt=""
                        className="multiview-pane__embed-logo"
                      />
                    ) : null}
                    <p className="multiview-pane__embed-title">{ch.name ?? ch.slug}</p>
                    <p className="muted multiview-pane__embed-note">
                      Embedded player — use single view for this stream.
                    </p>
                    <Link
                      to={watchUrlForChannel(ch)}
                      className="btn-primary multiview-pane__embed-link"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Open full player
                    </Link>
                    <button
                      type="button"
                      className="btn-ghost multiview-pane__clear"
                      onClick={(e) => {
                        e.stopPropagation()
                        clearSlot(i)
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {isMax ? (
                    <div className="multiview-pane__maxbar">
                      <button
                        type="button"
                        className="multiview-pane__maxbar-btn"
                        onClick={(e) => {
                          e.stopPropagation()
                          setMaximizedSlot(null)
                        }}
                      >
                        <Minimize2 size={16} strokeWidth={2} aria-hidden />
                        Back to grid
                      </button>
                      <span className="multiview-pane__maxbar-title">
                        {ch.name ?? ch.slug}
                      </span>
                      <span className="multiview-pane__maxbar-tools">
                        {isAudio ? (
                          <button
                            type="button"
                            className="multiview-pane__badge multiview-pane__badge-btn"
                            title="Audio on this pane"
                            onClick={(e) => {
                              e.stopPropagation()
                              focusAudio(i)
                            }}
                          >
                            <Volume2 size={14} aria-hidden />
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="multiview-pane__badge multiview-pane__badge--muted multiview-pane__badge-btn"
                            title="Play sound on this pane"
                            onClick={(e) => {
                              e.stopPropagation()
                              focusAudio(i)
                            }}
                          >
                            <VolumeX size={14} aria-hidden />
                          </button>
                        )}
                        <button
                          type="button"
                          className="multiview-pane__icon-btn"
                          title="Change channel"
                          onClick={(e) => {
                            e.stopPropagation()
                            setPickerIndex(i)
                          }}
                        >
                          Swap
                        </button>
                        <button
                          type="button"
                          className="multiview-pane__icon-btn"
                          title="Remove"
                          onClick={(e) => {
                            e.stopPropagation()
                            clearSlot(i)
                          }}
                        >
                          <X size={16} aria-hidden />
                        </button>
                      </span>
                    </div>
                  ) : null}
                  <div className="multiview-pane__chrome">
                    <span className="multiview-pane__title">
                      {ch.name ?? ch.slug}
                    </span>
                    <span className="multiview-pane__tools">
                      {isAudio ? (
                        <button
                          type="button"
                          className="multiview-pane__badge multiview-pane__badge-btn"
                          title="Play sound on this pane (stay in grid)"
                          onClick={(e) => {
                            e.stopPropagation()
                            focusAudio(i)
                          }}
                        >
                          <Volume2 size={14} aria-hidden />
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="multiview-pane__badge multiview-pane__badge--muted multiview-pane__badge-btn"
                          title="Play sound on this pane (stay in grid)"
                          onClick={(e) => {
                            e.stopPropagation()
                            focusAudio(i)
                          }}
                        >
                          <VolumeX size={14} aria-hidden />
                        </button>
                      )}
                      <button
                        type="button"
                        className="multiview-pane__icon-btn"
                        title="Change channel"
                        onClick={(e) => {
                          e.stopPropagation()
                          setPickerIndex(i)
                        }}
                      >
                        Swap
                      </button>
                      <button
                        type="button"
                        className="multiview-pane__icon-btn"
                        title="Remove"
                        onClick={(e) => {
                          e.stopPropagation()
                          clearSlot(i)
                        }}
                      >
                        <X size={16} aria-hidden />
                      </button>
                    </span>
                  </div>
                  <div className="multiview-pane__player">
                    <StreamPlayer
                      channel={ch}
                      className="multiview-player"
                      muted={!isAudio}
                    />
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>
      </div>

      {pickerIndex !== null && (
        <div
          className="multiview-modal-backdrop"
          role="dialog"
          aria-modal
          aria-labelledby="mv-picker-title"
          onClick={() => setPickerIndex(null)}
        >
          <div
            className="multiview-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="multiview-modal__head">
              <h2 id="mv-picker-title">Choose channel for pane {pickerIndex + 1}</h2>
              <button
                type="button"
                className="multiview-modal__close"
                aria-label="Close"
                onClick={() => setPickerIndex(null)}
              >
                <X size={20} />
              </button>
            </div>
            <input
              type="search"
              className="multiview-modal__search"
              placeholder="Filter…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              autoFocus
            />
            <ul className="multiview-modal__list">
              {pickable.map((c) => (
                <li key={c.page_url}>
                  <button
                    type="button"
                    className="multiview-modal__row"
                    onClick={() => pickChannel(c)}
                  >
                    {c.logo ? (
                      <img src={publicUrl(c.logo)} alt="" className="multiview-modal__logo" />
                    ) : (
                      <span className="multiview-modal__logo-ph">TV</span>
                    )}
                    <span className="multiview-modal__name">
                      {c.name ?? c.slug}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {pickable.length === 0 && (
              <p className="muted multiview-modal__empty">
                No channels match. Embedded-only streams are excluded from multi-view.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
