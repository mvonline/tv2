import { useEffect, useRef } from "react"
import {
  createStreamLevelAnalyzer,
  type StreamLevelAnalyzer,
} from "@/lib/streamLevelAnalyzer"

type Props = {
  /** When set (and not decorative), spectrum follows playback (CORS may be required). */
  audio: HTMLAudioElement | null
  /** No Web Audio — animated bars only (e.g. iframe radio). */
  decorative?: boolean
  /** Re-bind when stream changes. */
  streamKey: string
  /**
   * Direct (non-HLS) stream URL. On iOS the media element can't be tapped
   * for live streams, so the spectrum is computed from a parallel fetch.
   */
  streamUrl?: string
  className?: string
  onLevels?: (levels: ArrayLike<number>) => void
}

const BAR_COUNT = 48
export const RESUME_AUDIO_VISUALIZER_EVENT = "tv2:resume-audio-visualizer"
const SILENT_ANALYSER_GRACE_MS = 2500
const SILENT_ANALYSER_PEAK = 3

// iPadOS 13+ reports as MacIntel — the touch-point check catches it.
const IS_IOS =
  typeof navigator !== "undefined" &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1))

export function AudioVisualizer({
  audio,
  decorative,
  streamKey,
  streamUrl,
  className,
  onLevels,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>(0)
  const ctxRef = useRef<AudioContext | null>(null)
  const onLevelsRef = useRef(onLevels)

  useEffect(() => {
    onLevelsRef.current = onLevels
  }, [onLevels])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const dpr = Math.min(window.devicePixelRatio ?? 1, 2)
    const g = canvas.getContext("2d")
    if (!g) return

    // Cached gradient — recreated on resize, reused every frame instead of 48×/frame.
    let barGrad: CanvasGradient | null = null

    const resize = () => {
      const parent = canvas.parentElement
      const w = parent?.clientWidth ?? 640
      const h = Math.min(200, Math.max(120, (parent?.clientHeight ?? 160) * 0.45))
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      barGrad = g.createLinearGradient(0, canvas.height, 0, 0)
      barGrad.addColorStop(0, "rgba(61, 139, 253, 0.95)")
      barGrad.addColorStop(1, "rgba(124, 92, 255, 0.75)")
    }
    resize()

    // ResizeObserver is Chrome 64+. Older TV browsers (Tizen 3, WebOS 4) get a window fallback.
    let roCleanup: () => void = () => {}
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(resize)
      if (canvas.parentElement) ro.observe(canvas.parentElement)
      roCleanup = () => ro.disconnect()
    } else {
      window.addEventListener("resize", resize)
      roCleanup = () => window.removeEventListener("resize", resize)
    }

    // Pre-allocated — avoids one Float32Array heap allocation per animation frame.
    const out = new Float32Array(BAR_COUNT)

    const drawBars = (levels: ArrayLike<number>) => {
      const w = canvas.width
      const h = canvas.height
      g.clearRect(0, 0, w, h)
      if (barGrad) g.fillStyle = barGrad
      const gap = Math.max(1, Math.floor(w / 400))
      const barW = (w - gap * (BAR_COUNT + 1)) / BAR_COUNT
      let x = gap
      for (let i = 0; i < BAR_COUNT; i++) {
        const v =
          typeof levels[i] === "number"
            ? (levels[i] as number)
            : ((levels[i] as unknown as number | undefined) ?? 0)
        const bh = Math.max(4, v * h * 0.92)
        g.fillRect(x, h - bh, barW, bh)
        x += barW + gap
      }
    }

    let dataArray: Uint8Array | null = null
    let analyser: AnalyserNode | null = null
    let sourceNode: MediaElementAudioSourceNode | null = null
    let t0 = performance.now()
    let lastLevelsEmit = 0
    let onPlay: (() => void) | null = null
    let onResumeRequest: (() => void) | null = null
    let useDecorativeSpectrum = decorative || !audio
    let analyserSilentSince = 0
    let graphFailed = false
    let streamAnalyzer: StreamLevelAnalyzer | null = null
    let streamAnalyzerBase = 0

    const resumeAudioContext = () => {
      const c = ctxRef.current
      if (c?.state === "suspended") void c.resume()
    }

    const emitLevels = (levels: ArrayLike<number>, t: number) => {
      if (!onLevelsRef.current || t - lastLevelsEmit < 50) return
      lastLevelsEmit = t
      onLevelsRef.current(levels)
    }

    // iOS only unlocks Web Audio inside a user gesture, so the graph is built
    // on the first play/resume (unmuted autoplay is blocked there, making the
    // play event gesture-driven) instead of at mount.
    const attachGraph = () => {
      if (analyser || graphFailed || decorative || !audio) return
      try {
        const actx = ctxRef.current ?? new AudioContext()
        ctxRef.current = actx
        if (actx.state === "suspended") void actx.resume()
        const source = actx.createMediaElementSource(audio)
        sourceNode = source
        const node = actx.createAnalyser()
        node.fftSize = 256
        source.connect(node)
        node.connect(actx.destination)
        dataArray = new Uint8Array(node.frequencyBinCount)
        analyser = node
        analyserSilentSince = 0
        useDecorativeSpectrum = false
      } catch {
        /* CORS or duplicate source — use fake spectrum */
        graphFailed = true
        useDecorativeSpectrum = true
        t0 = performance.now()
      }
    }

    // iOS never feeds live-stream samples into MediaElementAudioSourceNode
    // (WebKit 180696/211394), so for direct streams the spectrum comes from a
    // parallel fetch decoded off the playback path instead of a graph tap.
    const useStreamAnalyzer = IS_IOS && !decorative && !!audio && !!streamUrl

    if (!decorative && audio) {
      onPlay = () => {
        if (useStreamAnalyzer) {
          if (!streamAnalyzer && streamUrl) {
            streamAnalyzer = createStreamLevelAnalyzer(streamUrl, BAR_COUNT)
            streamAnalyzerBase = audio.currentTime
            useDecorativeSpectrum = false
          }
          return
        }
        attachGraph()
        resumeAudioContext()
      }
      onResumeRequest = onPlay
      audio.addEventListener("play", onPlay)
      window.addEventListener(RESUME_AUDIO_VISUALIZER_EVENT, onResumeRequest)
      if (!audio.paused) onPlay()
    }

    const fillDecorativeLevels = (t: number) => {
      const elapsed = (t - t0) / 1000
      for (let i = 0; i < BAR_COUNT; i++) {
        const phase = elapsed * 2.2 + i * 0.15
        out[i] =
          0.15 +
          0.55 *
            (0.5 + 0.5 * Math.sin(phase)) *
            (0.5 + 0.5 * Math.sin(elapsed * 1.7 + i * 0.08))
      }
    }

    const loop = (t: number) => {
      rafRef.current = requestAnimationFrame(loop)
      if (streamAnalyzer && audio) {
        if (streamAnalyzer.state === "failed") {
          streamAnalyzer.dispose()
          streamAnalyzer = null
          useDecorativeSpectrum = true
          t0 = t
        } else {
          const playing = !audio.paused && !audio.ended
          const hasData =
            playing &&
            streamAnalyzer.read(audio.currentTime - streamAnalyzerBase, out)
          if (!hasData) {
            // Paused, or decode still warming up — decay to silence.
            for (let i = 0; i < BAR_COUNT; i++) out[i] = (out[i] ?? 0) * 0.88
          }
          emitLevels(out, t)
          drawBars(out)
          return
        }
      }
      if (dataArray && analyser) {
        analyser.getByteFrequencyData(
          dataArray as Parameters<AnalyserNode["getByteFrequencyData"]>[0],
        )
        let peak = 0
        const step = Math.max(1, Math.floor(dataArray.length / BAR_COUNT))
        for (let i = 0; i < BAR_COUNT; i++) {
          const value = dataArray[i * step] ?? 0
          peak = Math.max(peak, value)
          out[i] = value / 255
        }

        const isPlaying = Boolean(audio && !audio.paused && !audio.ended)
        if (peak > SILENT_ANALYSER_PEAK) {
          // Self-heal: real data arrived (e.g. context resumed late on iOS).
          analyserSilentSince = 0
          useDecorativeSpectrum = false
        } else if (isPlaying) {
          analyserSilentSince ||= t
          if (
            !useDecorativeSpectrum &&
            t - analyserSilentSince >= SILENT_ANALYSER_GRACE_MS
          ) {
            useDecorativeSpectrum = true
            t0 = t
          }
        } else {
          analyserSilentSince = 0
        }

        if (!useDecorativeSpectrum) {
          emitLevels(out, t)
          drawBars(out)
          return
        }
      }
      if (useDecorativeSpectrum) {
        fillDecorativeLevels(t)
      } else {
        // Graph not attached yet (waiting for first play) — silent flat bars.
        out.fill(0)
      }
      emitLevels(out, t)
      drawBars(out)
    }

    rafRef.current = requestAnimationFrame(loop)

    // Pause animation when the tab/app is hidden — TVs have very limited GPU/CPU budget.
    const onVisibilityChange = () => {
      if (document.hidden) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = 0
      } else if (rafRef.current === 0) {
        t0 = performance.now()
        rafRef.current = requestAnimationFrame(loop)
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange)

    return () => {
      cancelAnimationFrame(rafRef.current)
      document.removeEventListener("visibilitychange", onVisibilityChange)
      roCleanup()
      if (audio && onPlay) audio.removeEventListener("play", onPlay)
      if (onResumeRequest) {
        window.removeEventListener(
          RESUME_AUDIO_VISUALIZER_EVENT,
          onResumeRequest,
        )
      }
      streamAnalyzer?.dispose()
      streamAnalyzer = null
      sourceNode?.disconnect()
      analyser?.disconnect()
      const c = ctxRef.current
      if (c?.state !== "closed") void c?.close()
      ctxRef.current = null
    }
  }, [audio, decorative, streamKey, streamUrl])

  return (
    <canvas
      ref={canvasRef}
      className={`audio-visualizer ${className ?? ""}`}
      aria-hidden
    />
  )
}
