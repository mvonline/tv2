import Hls from "hls.js"
import { Pause, Play, Radio } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { Channel } from "@/types/channel"
import {
  AudioVisualizer,
  RESUME_AUDIO_VISUALIZER_EVENT,
} from "@/components/AudioVisualizer"
import { RadioNameArt } from "@/components/RadioNameArt"
import { hlsPlaybackUrl } from "@/lib/hlsProxyUrl"
import type { AmbilightSettings } from "@/components/VideoPlayer"

type Props = {
  channel: Channel
  className?: string
  /** Multi-view: only one pane unmuted. */
  muted?: boolean
  ambilight?: AmbilightSettings
}

function tryPlay(media: HTMLMediaElement | null, onFailed?: () => void) {
  if (!media) return
  const result = media.play()
  if (result && typeof result.catch === "function") {
    result.catch(() => {
      /* Browser policy may block unmuted autoplay. */
      onFailed?.()
    })
  }
}

function createPlayRetrier(media: HTMLMediaElement) {
  let retryTimer = 0
  let stopped = false

  const clearRetry = () => {
    if (retryTimer) {
      window.clearTimeout(retryTimer)
      retryTimer = 0
    }
  }

  const attempt = () => {
    if (stopped || !media.paused || media.ended) return
    tryPlay(media, () => {
      if (stopped || retryTimer || !media.paused) return
      retryTimer = window.setTimeout(() => {
        retryTimer = 0
        attempt()
      }, 1000)
    })
  }

  media.addEventListener("playing", clearRetry)

  return {
    attempt,
    stop() {
      stopped = true
      clearRetry()
      media.removeEventListener("playing", clearRetry)
    },
  }
}

function resetMedia(media: HTMLMediaElement) {
  media.pause()
  media.removeAttribute("src")
  media.load()
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
  const levelsRef = useRef<Float32Array | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)

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
    setIsPlaying(!audio.paused)

    const syncPlaying = () => setIsPlaying(!audio.paused)
    audio.addEventListener("play", syncPlaying)
    audio.addEventListener("playing", syncPlaying)
    audio.addEventListener("pause", syncPlaying)
    audio.addEventListener("ended", syncPlaying)

    const source = isHls ? (hlsUrl ?? url) : url

    if (isHls && Hls.isSupported()) {
      const playRetrier = createPlayRetrier(audio)
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
      const onCanPlay = () => playRetrier.attempt()
      audio.addEventListener("canplay", onCanPlay)
      hls.on(Hls.Events.MANIFEST_PARSED, () => playRetrier.attempt())
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
        playRetrier.stop()
        audio.removeEventListener("play", syncPlaying)
        audio.removeEventListener("playing", syncPlaying)
        audio.removeEventListener("pause", syncPlaying)
        audio.removeEventListener("ended", syncPlaying)
        audio.removeEventListener("canplay", onCanPlay)
        hls.detachMedia()
        hls.destroy()
        hlsRef.current = null
        resetMedia(audio)
      }
    }

    if (isHls && audio.canPlayType("application/vnd.apple.mpegurl")) {
      const playRetrier = createPlayRetrier(audio)
      audio.src = source
      const onCanPlay = () => playRetrier.attempt()
      audio.addEventListener("canplay", onCanPlay)
      playRetrier.attempt()
      return () => {
        playRetrier.stop()
        audio.removeEventListener("play", syncPlaying)
        audio.removeEventListener("playing", syncPlaying)
        audio.removeEventListener("pause", syncPlaying)
        audio.removeEventListener("ended", syncPlaying)
        audio.removeEventListener("canplay", onCanPlay)
        resetMedia(audio)
      }
    }

    if (!isHls) {
      const playRetrier = createPlayRetrier(audio)
      audio.src = url
      const onCanPlay = () => playRetrier.attempt()
      audio.addEventListener("canplay", onCanPlay)
      playRetrier.attempt()
      return () => {
        playRetrier.stop()
        audio.removeEventListener("play", syncPlaying)
        audio.removeEventListener("playing", syncPlaying)
        audio.removeEventListener("pause", syncPlaying)
        audio.removeEventListener("ended", syncPlaying)
        audio.removeEventListener("canplay", onCanPlay)
        resetMedia(audio)
      }
    }

    setError("HLS is not supported in this browser.")
    return undefined
  }, [channel, url, hlsUrl, isHls, isIframe, channel.requires_proxy, audioEl])

  const streamKey = `${channel.page_url}|${url ?? ""}`
  const ambilightEnabled = Boolean(ambilight?.enabled)

  const togglePlayback = useCallback(() => {
    const audio = audioEl
    if (!audio) return
    if (audio.paused) {
      window.dispatchEvent(new Event(RESUME_AUDIO_VISUALIZER_EVENT))
      tryPlay(audio)
    } else {
      audio.pause()
    }
  }, [audioEl])

  const syncAmbilightLevels = useCallback(
    (levels: ArrayLike<number>) => {
      const shell = shellRef.current
      const len = levels.length
      if (!len) return

      if (!levelsRef.current || levelsRef.current.length !== len) {
        levelsRef.current = new Float32Array(len)
      }
      for (let i = 0; i < len; i += 1) {
        levelsRef.current[i] = levels[i] ?? 0
      }

      if (!shell || !ambilight?.enabled) return

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
      const sideScale = (side: "top" | "right" | "bottom" | "left", value: number) =>
        ambilight.sides[side] ? Math.max(0.08, Math.min(1, value)) : 0

      shell.style.setProperty("--radio-ambilight-opacity", String(opacity))
      shell.style.setProperty("--radio-ambilight-intensity", String(intensity))
      shell.style.setProperty("--radio-ambilight-top", `rgba(${Math.round(120 + high * 110)}, ${Math.round(90 + mid * 120)}, 255, ${sideAlpha("top", topPulse)})`)
      shell.style.setProperty("--radio-ambilight-right", `rgba(255, ${Math.round(76 + high * 120)}, ${Math.round(120 + mid * 90)}, ${sideAlpha("right", rightPulse)})`)
      shell.style.setProperty("--radio-ambilight-bottom", `rgba(${Math.round(38 + mid * 110)}, ${Math.round(190 + bass * 55)}, ${Math.round(135 + high * 80)}, ${sideAlpha("bottom", bottomPulse)})`)
      shell.style.setProperty("--radio-ambilight-left", `rgba(${Math.round(70 + bass * 120)}, ${Math.round(120 + mid * 80)}, 255, ${sideAlpha("left", leftPulse)})`)
      shell.style.setProperty("--radio-eq-top", String(sideScale("top", topPulse)))
      shell.style.setProperty("--radio-eq-right", String(sideScale("right", rightPulse)))
      shell.style.setProperty("--radio-eq-bottom", String(sideScale("bottom", bottomPulse)))
      shell.style.setProperty("--radio-eq-left", String(sideScale("left", leftPulse)))
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
      {ambilightEnabled && (
        <div className="radio-eq-edges" aria-hidden>
          <span className="radio-eq-edge radio-eq-edge--top" />
          <span className="radio-eq-edge radio-eq-edge--right" />
          <span className="radio-eq-edge radio-eq-edge--bottom" />
          <span className="radio-eq-edge radio-eq-edge--left" />
        </div>
      )}
      <div className="radio-shell__viz">
        <RadioNameArt
          name={channel.name ?? channel.slug}
          levelsRef={levelsRef}
          streamKey={streamKey}
        />
        <AudioVisualizer
          audio={audioEl}
          decorative={false}
          streamKey={streamKey}
          streamUrl={isHls ? (hlsUrl ?? url ?? undefined) : (url ?? undefined)}
          onLevels={syncAmbilightLevels}
        />
      </div>
      <div className="radio-shell__controls">
        <button
          type="button"
          className="radio-play-btn"
          onClick={togglePlayback}
          aria-label={isPlaying ? "Pause radio" : "Play radio"}
          title={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? (
            <Pause size={20} strokeWidth={2.4} aria-hidden />
          ) : (
            <Play size={20} strokeWidth={2.4} aria-hidden />
          )}
          <span>{isPlaying ? "Pause" : "Play"}</span>
        </button>
        <audio
          key={streamKey}
          ref={setAudioEl}
          className="radio-audio-el"
          autoPlay
          muted={muted}
          crossOrigin="anonymous"
        />
      </div>
      {error && <p className="video-error radio-shell__error">{error}</p>}
    </div>
  )
}
