import Hls from "hls.js"
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
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
  const hlsRef = useRef<Hls | null>(null)
  const [error, setError] = useState<string | null>(null)

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
      // Workers are unreliable on many smart-TV Chromium builds; LL-HLS stresses weak demuxers.
      const hls = new Hls({
        enableWorker: false,
        lowLatencyMode: false,
      })
      hlsRef.current = hls
      hls.loadSource(playbackSrc)
      hls.attachMedia(video)
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          setError(
            channel.requires_proxy
              ? "Stream blocked (proxy required). This host may not allow playback outside the original site."
              : "Playback error. Try again later.",
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
    <div className={`video-shell ${className ?? ""}`}>
      <video
        ref={videoRef}
        className="video-el"
        controls
        playsInline
        autoPlay
        muted={muted}
        crossOrigin={crossOrigin}
      />
      {error && <p className="video-error">{error}</p>}
    </div>
  )
}
