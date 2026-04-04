import Hls from "hls.js"
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import type { Channel } from "@/types/channel"
import { hlsPlaybackUrl } from "@/lib/hlsProxyUrl"

type Props = {
  channel: Channel
  className?: string
  /** Wired to the native `<video>` for watch-bar PiP (null when iframe / no video). */
  onVideoRef?: (el: HTMLVideoElement | null) => void
}

export function VideoPlayer({ channel, className, onVideoRef }: Props) {
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

    const source = isHls ? (hlsUrl ?? url) : url

    if (isHls && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
      })
      hlsRef.current = hls
      hls.loadSource(source)
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

    if (isHls && video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = source
      return
    }

    if (!isHls) {
      video.src = url
      return
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
        crossOrigin="anonymous"
      />
      {error && <p className="video-error">{error}</p>}
    </div>
  )
}
