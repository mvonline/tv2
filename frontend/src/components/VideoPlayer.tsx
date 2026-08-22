import Hls from "hls.js"
import { Maximize2, Minimize2, VolumeX } from "lucide-react"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import type { Channel } from "@/types/channel"
import { hlsPlaybackUrl } from "@/lib/hlsProxyUrl"
import { createAutoplayKeeper, seekToLiveEdge } from "@/lib/autoplay"

type Props = {
  channel: Channel
  className?: string
  /** Wired to the native `<video>` for watch-bar PiP (null when iframe / no video). */
  onVideoRef?: (el: HTMLVideoElement | null) => void
  /** Multi-view: only one pane should be unmuted. */
  muted?: boolean
  ambilight?: AmbilightSettings
}

export type AmbilightSide = "top" | "right" | "bottom" | "left"

export type AmbilightSettings = {
  enabled: boolean
  sides: Record<AmbilightSide, boolean>
  opacity: number
  performanceMode: boolean
}

const DEFAULT_AMBILIGHT: AmbilightSettings = {
  enabled: true,
  sides: {
    top: true,
    right: true,
    bottom: true,
    left: true,
  },
  opacity: 1.2,
  performanceMode: false,
}

/** Upstream statuses that will never succeed on retry. */
const PERMANENT_UPSTREAM_STATUSES = new Set([400, 401, 403, 404, 410, 451])

/** hls.js error details that mean the playlist itself could not be loaded. */
const PLAYLIST_ERROR_DETAILS = new Set<string>([
  "manifestLoadError",
  "manifestParsingError",
  "levelLoadError",
  "levelEmptyError",
])

/** Embedded TV browsers (webOS, Tizen, …) often expose native HLS and choke on MSE workers. */
function nativeHlsLikely(video: HTMLVideoElement): boolean {
  return (
    Boolean(video.canPlayType("application/vnd.apple.mpegurl")) ||
    Boolean(video.canPlayType("application/x-mpegURL"))
  )
}

function crossOriginForPlaybackUrl(src: string): "anonymous" | undefined {
  if (typeof window === "undefined") return undefined
  try {
    const u = new URL(src, window.location.href)
    return u.origin !== window.location.origin ? "anonymous" : undefined
  } catch {
    return undefined
  }
}

function setAmbilightColor(
  shell: HTMLDivElement,
  side: "top" | "right" | "bottom" | "left",
  r: number,
  g: number,
  b: number,
) {
  shell.style.setProperty(`--ambilight-${side}`, `rgba(${r}, ${g}, ${b}, 0.72)`)
}

function sampleRegion(
  data: Uint8ClampedArray,
  width: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): [number, number, number] {
  let r = 0
  let g = 0
  let b = 0
  let count = 0

  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * width + x) * 4
      r += data[i]
      g += data[i + 1]
      b += data[i + 2]
      count += 1
    }
  }

  if (!count) return [48, 96, 160]
  return [
    Math.round(r / count),
    Math.round(g / count),
    Math.round(b / count),
  ]
}

export function VideoPlayer({
  channel,
  className,
  onVideoRef,
  muted = false,
  ambilight = DEFAULT_AMBILIGHT,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const shellRef = useRef<HTMLDivElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [ambilightLive, setAmbilightLive] = useState(false)
  /** Set when the autoplay policy forced us to drop sound to get picture. */
  const [autoMuted, setAutoMuted] = useState(false)

  const fullscreenTarget = useCallback(() => {
    const doc = document as Document & { webkitFullscreenElement?: Element | null }
    return document.fullscreenElement ?? doc.webkitFullscreenElement ?? null
  }, [])

  const enterFullscreen = useCallback(() => {
    const shell = shellRef.current
    const video = videoRef.current
    if (fullscreenTarget()) return
    const nativeVideoFallback = () => {
      if (video && "webkitEnterFullscreen" in video) {
        (video as HTMLVideoElement & { webkitEnterFullscreen(): void }).webkitEnterFullscreen()
        setIsFullscreen(true)
      }
    }
    if (shell?.requestFullscreen) {
      // iOS Safari: requestFullscreen on a div isn't supported — fall back to the video element.
      shell.requestFullscreen().catch(nativeVideoFallback)
    } else {
      nativeVideoFallback()
    }
  }, [fullscreenTarget])

  const exitFullscreen = useCallback(() => {
    const video = videoRef.current
    if (!fullscreenTarget()) {
      // iOS video-element fullscreen isn't reflected in document.fullscreenElement.
      if (video && "webkitExitFullscreen" in video) {
        (video as HTMLVideoElement & { webkitExitFullscreen(): void }).webkitExitFullscreen()
      }
      setIsFullscreen(false)
      return
    }
    if (document.exitFullscreen) {
      document.exitFullscreen().catch(() => {})
    } else if ("webkitExitFullscreen" in document) {
      (document as Document & { webkitExitFullscreen(): void }).webkitExitFullscreen()
    }
  }, [fullscreenTarget])

  const unmute = useCallback(() => {
    const video = videoRef.current
    setAutoMuted(false)
    if (!video) return
    video.muted = false
    // The click is a user gesture, so an unmuted play() is allowed now.
    const started = video.play()
    if (started && typeof started.catch === "function") {
      started.catch(() => {
        video.muted = true
        setAutoMuted(true)
      })
    }
  }, [])

  const toggleFullscreen = useCallback(() => {
    if (isFullscreen) exitFullscreen()
    else enterFullscreen()
  }, [enterFullscreen, exitFullscreen, isFullscreen])

  // Only reflect fullscreen that belongs to THIS player: a sibling pane in
  // multi-view (or any other element) going fullscreen must not flip our icon.
  useEffect(() => {
    const sync = () => {
      const el = fullscreenTarget()
      const shell = shellRef.current
      setIsFullscreen(Boolean(el && shell && (el === shell || shell.contains(el))))
    }
    const video = videoRef.current
    const onVideoBegin = () => setIsFullscreen(true)
    const onVideoEnd = () => setIsFullscreen(false)
    sync()
    document.addEventListener("fullscreenchange", sync)
    document.addEventListener("webkitfullscreenchange", sync)
    video?.addEventListener("webkitbeginfullscreen", onVideoBegin)
    video?.addEventListener("webkitendfullscreen", onVideoEnd)
    return () => {
      document.removeEventListener("fullscreenchange", sync)
      document.removeEventListener("webkitfullscreenchange", sync)
      video?.removeEventListener("webkitbeginfullscreen", onVideoBegin)
      video?.removeEventListener("webkitendfullscreen", onVideoEnd)
    }
  }, [fullscreenTarget])

  const url = channel.stream_url
  const isHls =
    channel.stream_type === "hls" ||
    (url?.toLowerCase().includes(".m3u8") ?? false)
  const isIframe = channel.stream_type === "iframe" && url

  const hlsUrl = useMemo(
    () => hlsPlaybackUrl(url, channel.requires_proxy, channel.stream_type),
    [url, channel.requires_proxy, channel.stream_type],
  )

  const source = isHls ? (hlsUrl ?? url) : url
  const crossOrigin = useMemo(
    () =>
      source && typeof source === "string"
        ? crossOriginForPlaybackUrl(source)
        : undefined,
    [source],
  )

  useLayoutEffect(() => {
    if (!onVideoRef) return
    if (isIframe || !url) {
      onVideoRef(null)
      return
    }
    onVideoRef(videoRef.current)
    return () => onVideoRef(null)
  }, [onVideoRef, isIframe, url, channel.page_url])

  useEffect(() => {
    setError(null)
    setAutoMuted(false)
    const video = videoRef.current
    if (!video || !url || isIframe) return

    const playbackSrc = isHls ? (hlsUrl ?? url) : url

    if (isHls && Hls.isSupported()) {
      // Workers unreliable on TV Chromium; LL-HLS stresses weak demuxers.
      // Buffer limits prevent OOM on TVs that have 256-512 MB available to the web app.
      const hls = new Hls({
        enableWorker: false,
        lowLatencyMode: false,
        // Pre-buffer 30 s ahead; allow up to 45 s when bandwidth allows.
        maxBufferLength: 30,
        maxMaxBufferLength: 45,
        maxBufferSize: 30 * 1024 * 1024,
        // Start ABR estimate at 1 Mbps so the first segment isn't always lowest quality.
        abrEwmaDefaultEstimate: 1_000_000,
        // Give the proxy extra time to relay the first segment on slow uplinks.
        fragLoadingTimeOut: 20_000,
        manifestLoadingTimeOut: 15_000,
        // Upstream packages 10 s segments, so the default 3-segment live sync
        // costs ~30 s of buffering before playback and leaves us that far
        // behind live. Two segments still absorbs a hiccup at half the wait.
        liveSyncDurationCount: 2,
        // Fetch the first segment while the playlist is still being processed.
        startFragPrefetch: true,
      })
      const keeper = createAutoplayKeeper(video, {
        onMutedFallback: () => setAutoMuted(true),
        onStalled: () => {
          // Resume the fetch loop and rejoin live rather than sitting on a
          // buffer that stopped filling.
          hls.startLoad(-1)
          seekToLiveEdge(video)
        },
      })
      hlsRef.current = hls
      hls.loadSource(playbackSrc)
      hls.attachMedia(video)
      hls.on(Hls.Events.MANIFEST_PARSED, () => keeper.attempt())
      hls.on(Hls.Events.MEDIA_ATTACHED, () => keeper.attempt())
      hls.on(Hls.Events.LEVEL_LOADED, () => keeper.attempt())
      let networkRetryTimer = 0
      let networkRetries = 0
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!data.fatal) return
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError()
          keeper.attempt()
          return
        }
        // A 404/403/410 on the *playlist* means the channel is gone, so say so
        // instead of retrying. The same status on a fragment is usually just an
        // aged session id in a cached playlist, which the next reload fixes.
        const upstreamStatus = data.response?.code
        const permanent =
          typeof upstreamStatus === "number" &&
          PERMANENT_UPSTREAM_STATUSES.has(upstreamStatus) &&
          PLAYLIST_ERROR_DETAILS.has(data.details as string)
        if (permanent) {
          setError("This channel is offline (the source is no longer available).")
          return
        }
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRetries < 5) {
          // A fatal network error is usually the manifest or the proxy blipping;
          // reload with backoff instead of leaving a stopped player behind.
          const delay = Math.min(8000, 1000 * 2 ** networkRetries)
          networkRetries += 1
          window.clearTimeout(networkRetryTimer)
          networkRetryTimer = window.setTimeout(() => {
            hls.loadSource(playbackSrc)
            hls.startLoad(-1)
            keeper.attempt()
          }, delay)
          return
        }
        setError(
          channel.requires_proxy
            ? "Stream unavailable. The channel may be geo-restricted or temporarily offline."
            : "Playback error. The stream may be temporarily unavailable.",
        )
      })
      keeper.attempt()
      return () => {
        window.clearTimeout(networkRetryTimer)
        keeper.stop()
        hls.destroy()
        hlsRef.current = null
      }
    }

    if (isHls && nativeHlsLikely(video)) {
      const keeper = createAutoplayKeeper(video, {
        onMutedFallback: () => setAutoMuted(true),
        onStalled: () => {
          video.load()
          keeper.attempt()
        },
      })
      video.src = playbackSrc
      keeper.attempt()
      return () => {
        keeper.stop()
        video.removeAttribute("src")
        video.load()
      }
    }

    if (!isHls) {
      const keeper = createAutoplayKeeper(video, {
        onMutedFallback: () => setAutoMuted(true),
        onStalled: () => {
          video.load()
          keeper.attempt()
        },
      })
      video.src = url
      keeper.attempt()
      return () => {
        keeper.stop()
        video.removeAttribute("src")
        video.load()
      }
    }

    setError("HLS is not supported in this browser.")
    return undefined
  }, [channel, url, hlsUrl, isHls, isIframe, channel.requires_proxy])

  useEffect(() => {
    const video = videoRef.current
    const shell = shellRef.current
    if (!ambilight.enabled || !video || !shell || isIframe || !url) return

    let raf = 0
    let videoFrameHandle = 0
    let stopped = false
    let lastSample = 0
    const canvas = document.createElement("canvas")
    const ctx = canvas.getContext("2d", { willReadFrequently: true })
    const sampleWidth = ambilight.performanceMode ? 24 : 40
    const sampleHeight = ambilight.performanceMode ? 14 : 24
    const edge = ambilight.performanceMode ? 3 : 5
    const sampleInterval = ambilight.performanceMode ? 360 : 180

    if (!ctx) return

    canvas.width = sampleWidth
    canvas.height = sampleHeight

    const sample = (now: number) => {
      if (stopped) return
      if (now - lastSample < sampleInterval) return
      lastSample = now

      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.paused) {
        return
      }

      try {
        ctx.drawImage(video, 0, 0, sampleWidth, sampleHeight)
        const frame = ctx.getImageData(0, 0, sampleWidth, sampleHeight).data
        const top = sampleRegion(frame, sampleWidth, 0, 0, sampleWidth, edge)
        const right = sampleRegion(
          frame,
          sampleWidth,
          sampleWidth - edge,
          0,
          sampleWidth,
          sampleHeight,
        )
        const bottom = sampleRegion(
          frame,
          sampleWidth,
          0,
          sampleHeight - edge,
          sampleWidth,
          sampleHeight,
        )
        const left = sampleRegion(frame, sampleWidth, 0, 0, edge, sampleHeight)

        if (ambilight.sides.top) setAmbilightColor(shell, "top", ...top)
        if (ambilight.sides.right) setAmbilightColor(shell, "right", ...right)
        if (ambilight.sides.bottom) setAmbilightColor(shell, "bottom", ...bottom)
        if (ambilight.sides.left) setAmbilightColor(shell, "left", ...left)
        setAmbilightLive(true)
      } catch {
        setAmbilightLive(false)
        stopped = true
      }
    }

    const scheduleAnimationFrame = () => {
      raf = window.requestAnimationFrame((now) => {
        sample(now)
        scheduleAnimationFrame()
      })
    }

    if ("requestVideoFrameCallback" in video) {
      const scheduleVideoFrame = () => {
        videoFrameHandle = (
          video as HTMLVideoElement & {
            requestVideoFrameCallback(
              callback: (now: DOMHighResTimeStamp) => void,
            ): number
            cancelVideoFrameCallback(handle: number): void
          }
        ).requestVideoFrameCallback((now) => {
          sample(now)
          if (!stopped) scheduleVideoFrame()
        })
      }
      scheduleVideoFrame()
    } else {
      scheduleAnimationFrame()
    }

    return () => {
      stopped = true
      if (raf) window.cancelAnimationFrame(raf)
      if (videoFrameHandle && "cancelVideoFrameCallback" in video) {
        (
          video as HTMLVideoElement & {
            cancelVideoFrameCallback(handle: number): void
          }
        ).cancelVideoFrameCallback(videoFrameHandle)
      }
      setAmbilightLive(false)
    }
  }, [ambilight.enabled, ambilight.sides, ambilight.performanceMode, isIframe, url, source])

  useEffect(() => {
    const shell = shellRef.current
    if (!shell) return

    const intensity = Math.max(0, Math.min(2, ambilight.opacity))
    shell.style.setProperty("--ambilight-opacity", String(Math.min(1, intensity)))
    shell.style.setProperty("--ambilight-inner-opacity", String(Math.min(0.82, intensity * 0.42)))
    shell.style.setProperty("--ambilight-intensity", String(intensity))
    shell.style.setProperty("--ambilight-performance", ambilight.performanceMode ? "1" : "0")

    const sides: AmbilightSide[] = ["top", "right", "bottom", "left"]
    sides.forEach((side) => {
      if (!ambilight.enabled || !ambilight.sides[side]) {
        shell.style.setProperty(`--ambilight-${side}`, "rgba(0, 0, 0, 0)")
      }
    })
  }, [ambilight])

  if (isIframe && url) {
    return (
      <div className={`video-shell ${className ?? ""}`}>
        <iframe
          title={channel.name ?? "Stream"}
          src={url}
          className="video-iframe"
          allow="autoplay; fullscreen; encrypted-media"
          allowFullScreen
        />
      </div>
    )
  }

  return (
    <div
      className={`video-shell video-shell--ambilight ${
        ambilight.enabled && ambilightLive ? "is-ambilight-live" : ""
      } ${ambilight.performanceMode ? "video-shell--ambilight-performance" : ""} ${className ?? ""}`}
      ref={shellRef}
      data-fullscreen={isFullscreen ? "true" : undefined}
    >
      <video
        ref={videoRef}
        className="video-el"
        controls
        playsInline
        autoPlay
        muted={muted || autoMuted}
        crossOrigin={crossOrigin}
      />
      {autoMuted && !muted && (
        <button
          type="button"
          className="video-unmute-btn"
          onClick={unmute}
        >
          <VolumeX size={18} strokeWidth={2} aria-hidden />
          Tap to unmute
        </button>
      )}
      <button
        type="button"
        className="video-fullscreen-btn"
        onClick={toggleFullscreen}
        aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
        title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
        aria-pressed={isFullscreen}
      >
        {isFullscreen
          ? <Minimize2 size={20} strokeWidth={2} aria-hidden />
          : <Maximize2 size={20} strokeWidth={2} aria-hidden />}
      </button>
      {error && <p className="video-error">{error}</p>}
    </div>
  )
}
