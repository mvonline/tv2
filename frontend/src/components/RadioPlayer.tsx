import Hls from "hls.js"
import { Radio } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { Channel } from "@/types/channel"
import { AudioVisualizer } from "@/components/AudioVisualizer"
import { hlsPlaybackUrl } from "@/lib/hlsProxyUrl"
import type { AmbilightSettings } from "@/components/VideoPlayer"

type Props = {
  channel: Channel
  className?: string
  /** Multi-view: only one pane unmuted. */
  muted?: boolean
  ambilight?: AmbilightSettings
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

export function RadioPlayer({
  channel,
  className,
  muted = false,
  ambilight,
}: Props) {
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null)
  const hlsRef = useRef<Hls | null>(null)
  const shellRef = useRef<HTMLDivElement>(null)
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
      // Workers unreliable on TV Chromium builds; buffer limits prevent OOM.
      const hls = new Hls({
        enableWorker: false,
        lowLatencyMode: true,
        maxBufferLength: 15,
        maxMaxBufferLength: 20,
        maxBufferSize: 8 * 1024 * 1024,
      })
      hlsRef.current = hls
      hls.loadSource(source)
      hls.attachMedia(audio)
      const onCanPlay = () => tryPlay(audio)
      audio.addEventListener("canplay", onCanPlay)
      hls.on(Hls.Events.MANIFEST_PARSED, () => tryPlay(audio))
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
        audio.removeEventListener("canplay", onCanPlay)
        hls.destroy()
        hlsRef.current = null
      }
    }

    if (isHls && audio.canPlayType("application/vnd.apple.mpegurl")) {
      audio.src = source
      const onCanPlay = () => tryPlay(audio)
      audio.addEventListener("canplay", onCanPlay)
      tryPlay(audio)
      return () => {
        audio.removeEventListener("canplay", onCanPlay)
        audio.removeAttribute("src")
        audio.load()
      }
    }

    if (!isHls) {
      audio.src = url
      const onCanPlay = () => tryPlay(audio)
      audio.addEventListener("canplay", onCanPlay)
      tryPlay(audio)
      return () => {
        audio.removeEventListener("canplay", onCanPlay)
        audio.removeAttribute("src")
        audio.load()
      }
    }

    setError("HLS is not supported in this browser.")
    return undefined
  }, [channel, url, hlsUrl, isHls, isIframe, channel.requires_proxy, audioEl])

  const streamKey = `${channel.page_url}|${url ?? ""}`
  const ambilightEnabled = Boolean(ambilight?.enabled)

  const syncAmbilightLevels = useCallback(
    (levels: ArrayLike<number>) => {
      const shell = shellRef.current
      if (!shell || !ambilight?.enabled) return

      const len = levels.length
      if (!len) return

      const avgRange = (start: number, end: number) => {
        let total = 0
        let count = 0
        for (let i = start; i < end && i < len; i += 1) {
          total += levels[i] ?? 0
          count += 1
        }
        return count ? total / count : 0
      }

      const bass = avgRange(0, Math.max(1, Math.floor(len * 0.22)))
      const mid = avgRange(Math.floor(len * 0.22), Math.floor(len * 0.62))
      const high = avgRange(Math.floor(len * 0.62), len)
      const pulse = Math.min(1, Math.max(0.08, bass * 1.15 + mid * 0.35))
      const settingOpacity = Math.max(0, Math.min(2, ambilight.opacity))
      const opacity = Math.min(1, settingOpacity * (0.22 + pulse * 0.78))
      const intensity = ambilight.performanceMode
        ? Math.min(1.25, settingOpacity * (0.65 + pulse * 0.45))
        : Math.min(2, settingOpacity * (0.75 + pulse * 0.65))
      const topPulse = Math.min(1, high * 1.35 + mid * 0.28)
      const rightPulse = Math.min(1, mid * 1.15 + high * 0.35)
      const bottomPulse = Math.min(1, bass * 1.35 + mid * 0.2)
      const leftPulse = Math.min(1, bass * 0.75 + high * 0.75 + mid * 0.2)
      const sideAlpha = (side: "top" | "right" | "bottom" | "left", value: number) =>
        ambilight.sides[side] ? Math.max(0.22, value * 0.78) : 0

      shell.style.setProperty("--radio-ambilight-opacity", String(opacity))
      shell.style.setProperty("--radio-ambilight-intensity", String(intensity))
      shell.style.setProperty("--radio-ambilight-top", `rgba(${Math.round(120 + high * 110)}, ${Math.round(90 + mid * 120)}, 255, ${sideAlpha("top", topPulse)})`)
      shell.style.setProperty("--radio-ambilight-right", `rgba(255, ${Math.round(76 + high * 120)}, ${Math.round(120 + mid * 90)}, ${sideAlpha("right", rightPulse)})`)
      shell.style.setProperty("--radio-ambilight-bottom", `rgba(${Math.round(38 + mid * 110)}, ${Math.round(190 + bass * 55)}, ${Math.round(135 + high * 80)}, ${sideAlpha("bottom", bottomPulse)})`)
      shell.style.setProperty("--radio-ambilight-left", `rgba(${Math.round(70 + bass * 120)}, ${Math.round(120 + mid * 80)}, 255, ${sideAlpha("left", leftPulse)})`)
    },
    [ambilight],
  )

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
    <div
      ref={shellRef}
      className={`radio-shell ${
        ambilightEnabled ? "radio-shell--ambilight" : ""
      } ${
        ambilight?.performanceMode ? "radio-shell--ambilight-performance" : ""
      } ${className ?? ""}`}
    >
      <div className="radio-shell__viz">
        <AudioVisualizer
          audio={audioEl}
          decorative={false}
          streamKey={streamKey}
          onLevels={syncAmbilightLevels}
        />
      </div>
      <div className="radio-shell__controls">
        <audio
          ref={setAudioEl}
          className="radio-audio-el"
          controls
          autoPlay
          muted={muted}
          crossOrigin="anonymous"
        />
      </div>
      {error && <p className="video-error radio-shell__error">{error}</p>}
    </div>
  )
}
