import { useEffect, useRef } from "react"

type Props = {
  /** When set (and not decorative), spectrum follows playback (CORS may be required). */
  audio: HTMLAudioElement | null
  /** No Web Audio — animated bars only (e.g. iframe radio). */
  decorative?: boolean
  /** Re-bind when stream changes. */
  streamKey: string
  className?: string
  onLevels?: (levels: ArrayLike<number>) => void
}

const BAR_COUNT = 48
export const RESUME_AUDIO_VISUALIZER_EVENT = "tv2:resume-audio-visualizer"

type MediaElementGraph = {
  context: AudioContext
  source: MediaElementAudioSourceNode
}

type CaptureAudioElement = HTMLAudioElement & {
  captureStream?: () => MediaStream
  mozCaptureStream?: () => MediaStream
}

const mediaElementGraphs = new WeakMap<HTMLAudioElement, MediaElementGraph>()

function captureAudioStream(audio: HTMLAudioElement): MediaStream | null {
  const capturable = audio as CaptureAudioElement
  return capturable.captureStream?.() ?? capturable.mozCaptureStream?.() ?? null
}

function getMediaElementGraph(audio: HTMLAudioElement): MediaElementGraph {
  const existing = mediaElementGraphs.get(audio)
  if (existing && existing.context.state !== "closed") return existing

  const context = new AudioContext()
  const source = context.createMediaElementSource(audio)
  const graph = { context, source }
  mediaElementGraphs.set(audio, graph)
  return graph
}

export function AudioVisualizer({
  audio,
  decorative,
  streamKey,
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

    let frequencyData: Uint8Array | null = null
    let timeData: Uint8Array | null = null
    let analyser: AnalyserNode | null = null
    let sourceNode: AudioNode | null = null
    let t0 = performance.now()
    let lastLevelsEmit = 0
    let onPlay: (() => void) | null = null
    let onResumeRequest: (() => void) | null = null
    let useDecorativeSpectrum = Boolean(decorative)

    const resumeAudioContext = () => {
      const c = ctxRef.current
      if (c?.state === "suspended") void c.resume()
    }

    const emitLevels = (levels: ArrayLike<number>, t: number) => {
      if (!onLevelsRef.current || t - lastLevelsEmit < 50) return
      lastLevelsEmit = t
      onLevelsRef.current(levels)
    }

    if (!decorative && audio) {
      try {
        const graph = getMediaElementGraph(audio)
        const actx = graph.context
        ctxRef.current = actx
        const captured = captureAudioStream(audio)
        sourceNode = captured ? actx.createMediaStreamSource(captured) : graph.source
        analyser = actx.createAnalyser()
        analyser.fftSize = 256
        sourceNode.connect(analyser)
        if (!captured) analyser.connect(actx.destination)
        frequencyData = new Uint8Array(analyser.frequencyBinCount)
        timeData = new Uint8Array(analyser.fftSize)
        useDecorativeSpectrum = false
        onPlay = resumeAudioContext
        onResumeRequest = resumeAudioContext
        audio.addEventListener("play", onPlay)
        window.addEventListener(RESUME_AUDIO_VISUALIZER_EVENT, onResumeRequest)
      } catch (error) {
        console.warn("Audio visualizer could not attach to real audio", error)
      }
    }

    const fillFrequencyLevels = (data: Uint8Array) => {
      let peak = 0
      const step = Math.max(1, Math.floor(data.length / BAR_COUNT))
      for (let i = 0; i < BAR_COUNT; i++) {
        const value = data[i * step] ?? 0
        peak = Math.max(peak, value)
        out[i] = value / 255
      }
      return peak
    }

    const fillTimeDomainLevels = (data: Uint8Array) => {
      let peak = 0
      const step = Math.max(1, Math.floor(data.length / BAR_COUNT))
      for (let i = 0; i < BAR_COUNT; i++) {
        let total = 0
        let count = 0
        for (let j = 0; j < step && i * step + j < data.length; j++) {
          const centered = Math.abs((data[i * step + j] ?? 128) - 128)
          peak = Math.max(peak, centered)
          total += centered
          count += 1
        }
        out[i] = count ? Math.min(1, (total / count / 128) * 2.4) : 0
      }
      return peak
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
      if (frequencyData && timeData && analyser && !useDecorativeSpectrum) {
        analyser.getByteFrequencyData(
          frequencyData as Parameters<AnalyserNode["getByteFrequencyData"]>[0],
        )
        const frequencyPeak = fillFrequencyLevels(frequencyData)
        if (frequencyPeak === 0) {
          analyser.getByteTimeDomainData(
            timeData as Parameters<AnalyserNode["getByteTimeDomainData"]>[0],
          )
          fillTimeDomainLevels(timeData)
        }

        emitLevels(out, t)
        drawBars(out)
        return
      }
      if (useDecorativeSpectrum) {
        fillDecorativeLevels(t)
      } else {
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
      sourceNode?.disconnect()
      analyser?.disconnect()
      ctxRef.current = null
    }
  }, [audio, decorative, streamKey])

  return (
    <canvas
      ref={canvasRef}
      className={`audio-visualizer ${className ?? ""}`}
      aria-hidden
    />
  )
}
