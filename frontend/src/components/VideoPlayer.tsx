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

export function VideoPlayer({
  channel,
  className,
  onVideoRef,
  muted = false,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const shellRef = useRef<HTMLDivElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

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
      return () => {
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
        hls.destroy()
        hlsRef.current = null
      }
    }

    if (!isHls) {
      video.src = url
      return () => {
        video.removeAttribute("src")
        video.load()
      }
    }

    setError("HLS is not supported in this browser.")
    return undefined
  }, [channel, url, hlsUrl, isHls, isIframe, channel.requires_proxy])

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
    <div className={`video-shell ${className ?? ""}`} ref={shellRef}>
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
