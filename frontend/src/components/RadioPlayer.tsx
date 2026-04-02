import Hls from "hls.js"
import { Radio } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import type { Channel } from "@/types/channel"
import { AudioVisualizer } from "@/components/AudioVisualizer"
import { hlsPlaybackUrl } from "@/lib/hlsProxyUrl"

type Props = {
  channel: Channel
  className?: string
}

export function RadioPlayer({ channel, className }: Props) {
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null)
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

  useEffect(() => {
    setError(null)
    const audio = audioEl
    if (!audio || !url || isIframe) return

    const source = isHls ? (hlsUrl ?? url) : url

    if (isHls && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
      })
      hlsRef.current = hls
      hls.loadSource(source)
      hls.attachMedia(audio)
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

    if (isHls && audio.canPlayType("application/vnd.apple.mpegurl")) {
      audio.src = source
      return
    }

    if (!isHls) {
      audio.src = url
      return
    }

    setError("HLS is not supported in this browser.")
    return undefined
  }, [channel, url, hlsUrl, isHls, isIframe, channel.requires_proxy, audioEl])

  const streamKey = `${channel.page_url}|${url ?? ""}`

  if (isIframe && url) {
    return (
      <div className={`radio-shell radio-shell--iframe ${className ?? ""}`}>
        <div className="radio-shell__viz">
          <AudioVisualizer
            decorative
            audio={null}
            streamKey={streamKey}
          />
        </div>
        <div className="radio-shell__iframe-wrap">
          <iframe
            title={channel.name ?? "Radio"}
            src={url}
            className="radio-iframe"
            allow="autoplay; fullscreen; encrypted-media"
            allowFullScreen
          />
        </div>
        <p className="radio-shell__hint muted">
          <Radio size={16} strokeWidth={2} aria-hidden /> Embedded player
        </p>
      </div>
    )
  }

  return (
    <div className={`radio-shell ${className ?? ""}`}>
      <div className="radio-shell__viz">
        <AudioVisualizer
          audio={audioEl}
          decorative={false}
          streamKey={streamKey}
        />
      </div>
      <div className="radio-shell__controls">
        <audio
          ref={setAudioEl}
          className="radio-audio-el"
          controls
          autoPlay
          crossOrigin="anonymous"
        />
      </div>
      {error && <p className="video-error radio-shell__error">{error}</p>}
    </div>
  )
}
