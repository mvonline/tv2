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
  /** Called with a human-readable message when a fatal playback error occurs. */
  onError?: (msg: string) => void
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
  onError,
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

    const makeNativeErrorHandler = () => {
      const handler = () => {
        if (!video.error) return
        const mediaErrors: Record<number, string> = {
          1: "Playback aborted by the browser.",
          2: "Network error — check your connection.",
          3: "Stream decode error — the format may be unsupported.",
          4: "Stream not supported — the URL may be invalid or geo-blocked.",
        }
        const msg = mediaErrors[video.error.code] ?? "Stream failed to load."
        setError(msg)
        onError?.(msg)
      }
      video.addEventListener("error", handler)
      return () => video.removeEventListener("error", handler)
    }

    // Prefer native HLS when the stack advertises support (common on LG/Samsung/AppleTV Safari).
    if (isHls && nativeHlsLikely(video)) {
      const removeListener = makeNativeErrorHandler()
      video.src = playbackSrc
      return () => {
        removeListener()
        video.removeAttribute("src")
        video.load()
      }
    }

    if (isHls && Hls.isSupported()) {
      // HLS.js manages media internally — do NOT add a native error listener here;
      // it would fire on internal MSE operations that HLS.js handles silently.
      const hls = new Hls({
        enableWorker: false,
        lowLatencyMode: false,
        maxBufferLength: 30,
        maxMaxBufferLength: 45,
        maxBufferSize: 30 * 1024 * 1024,
        abrEwmaDefaultEstimate: 1_000_000,
        fragLoadingTimeOut: 20_000,
        manifestLoadingTimeOut: 15_000,
      })
      hlsRef.current = hls
      hls.loadSource(playbackSrc)
      hls.attachMedia(video)
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          const msg = channel.requires_proxy
            ? "Stream blocked (proxy required). This host may not allow playback outside the original site."
            : `Playback error: ${data.type} — ${data.details}`
          setError(msg)
          onError?.(msg)
        }
      })
      return () => {
        hls.destroy()
        hlsRef.current = null
      }
    }

    if (!isHls) {
      const removeListener = makeNativeErrorHandler()
      video.src = url
      return () => {
        removeListener()
        video.removeAttribute("src")
        video.load()
      }
    }

    const msg = "HLS is not supported in this browser."
    setError(msg)
    onError?.(msg)
    return undefined
  }, [channel, url, hlsUrl, isHls, isIframe, channel.requires_proxy, onError])

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
