import { Pause, Play, Radio } from "lucide-react"
import { useCallback, useEffect, useRef } from "react"
import type { Channel } from "@/types/channel"
import { AudioVisualizer } from "@/components/AudioVisualizer"
import { RadioNameArt } from "@/components/RadioNameArt"
import type { AmbilightSettings } from "@/components/VideoPlayer"
import { usePersistentRadio } from "@/context/PersistentRadioContext"

type Props = {
  channel: Channel
  className?: string
  ambilight?: AmbilightSettings
}

export function PersistentRadioPlayer({ channel, className, ambilight }: Props) {
  const { audioEl, isPlaying, error, playChannel, toggle } = usePersistentRadio()
  const shellRef = useRef<HTMLDivElement>(null)
  const levelsRef = useRef<Float32Array | null>(null)
  const streamKey = `${channel.page_url}|${channel.stream_url ?? ""}`
  const ambilightEnabled = Boolean(ambilight?.enabled)

  useEffect(() => {
    playChannel(channel)
  }, [channel, playChannel])

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

  if (channel.stream_type === "iframe" && channel.stream_url) {
    return (
      <div className={`radio-shell radio-shell--iframe ${className ?? ""}`}>
        <div className="radio-shell__viz">
          <AudioVisualizer decorative audio={null} streamKey={streamKey} />
        </div>
        <div className="radio-shell__iframe-wrap">
          <iframe
            title={channel.name ?? "Radio"}
            src={channel.stream_url}
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
          onLevels={syncAmbilightLevels}
        />
      </div>
      <div className="radio-shell__controls">
        <button
          type="button"
          className="radio-play-btn"
          onClick={toggle}
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
      </div>
      {error && <p className="video-error radio-shell__error">{error}</p>}
    </div>
  )
}
