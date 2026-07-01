import Hls from "hls.js"
import { Maximize2, Minimize2 } from "lucide-react"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import type { Channel } from "@/types/channel"
import { hlsPlaybackUrl } from "@/lib/hlsProxyUrl"

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

function tryPlay(media: HTMLMediaElement | null) {
  if (!media) return
  const result = media.play()
  if (result && typeof result.catch === "function") {
    result.catch(() => {
      /* Browser policy may block unmuted autoplay. */
    })
  }
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

  const enterFullscreen = useCallback(() => {
    const shell = shellRef.current
    const video = videoRef.current
    if (shell?.requestFullscreen) {
      shell.requestFullscreen().catch(() => {
        // iOS Safari: requestFullscreen on a div isn't supported — use webkitEnterFullscreen on the video
        if (video && "webkitEnterFullscreen" in video) {
          (video as HTMLVideoElement & { webkitEnterFullscreen(): void }).webkitEnterFullscreen()
        }
      })
    } else if (video && "webkitEnterFullscreen" in video) {
      (video as HTMLVideoElement & { webkitEnterFullscreen(): void }).webkitEnterFullscreen()
    }
  }, [])

  const exitFullscreen = useCallback(() => {
    if (document.exitFullscreen) {
      document.exitFullscreen().catch(() => {})
    } else if ("webkitExitFullscreen" in document) {
      (document as Document & { webkitExitFullscreen(): void }).webkitExitFullscreen()
    }
  }, [])

  useEffect(() => {
    const sync = () =>
      setIsFullscreen(
        !!document.fullscreenElement ||
          !!(document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement,
      )
    document.addEventListener("fullscreenchange", sync)
    document.addEventListener("webkitfullscreenchange", sync)
    return () => {
      document.removeEventListener("fullscreenchange", sync)
      document.removeEventListener("webkitfullscreenchange", sync)
    }
  }, [])

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
    const video = videoRef.current
    if (!video || !url || isIframe) return

    const playbackSrc = isHls ? (hlsUrl ?? url) : url

    // Prefer native HLS when the stack advertises support (common on LG/Samsung/AppleTV Safari).
    if (isHls && nativeHlsLikely(video)) {
      video.src = playbackSrc
      const onCanPlay = () => tryPlay(video)
      video.addEventListener("canplay", onCanPlay)
      tryPlay(video)
      return () => {
        video.removeEventListener("canplay", onCanPlay)
        video.removeAttribute("src")
        video.load()
      }
    }

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
      })
      hlsRef.current = hls
      hls.loadSource(playbackSrc)
      hls.attachMedia(video)
      const onCanPlay = () => tryPlay(video)
      video.addEventListener("canplay", onCanPlay)
      hls.on(Hls.Events.MANIFEST_PARSED, () => tryPlay(video))
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!data.fatal) return
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError()
        } else {
          setError(
            channel.requires_proxy
              ? "Stream unavailable. The channel may be geo-restricted or temporarily offline."
              : "Playback error. The stream may be temporarily unavailable.",
          )
        }
      })
      return () => {
        video.removeEventListener("canplay", onCanPlay)
        hls.destroy()
        hlsRef.current = null
      }
    }

    if (!isHls) {
      video.src = url
      const onCanPlay = () => tryPlay(video)
      video.addEventListener("canplay", onCanPlay)
      tryPlay(video)
      return () => {
        video.removeEventListener("canplay", onCanPlay)
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
    >
      <video
        ref={videoRef}
        className="video-el"
        controls
        playsInline
        autoPlay
        muted={muted}
        crossOrigin={crossOrigin}
      />
      <button
        type="button"
        className="video-fullscreen-btn"
        onClick={isFullscreen ? exitFullscreen : enterFullscreen}
        aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
      >
        {isFullscreen
          ? <Minimize2 size={20} strokeWidth={2} aria-hidden />
          : <Maximize2 size={20} strokeWidth={2} aria-hidden />}
      </button>
      {error && <p className="video-error">{error}</p>}
    </div>
  )
}
