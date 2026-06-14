import { useEffect, useRef } from "react"

type Props = {
  /** When set (and not decorative), spectrum follows playback (CORS may be required). */
  audio: HTMLAudioElement | null
  /** No Web Audio — animated bars only (e.g. iframe radio). */
  decorative?: boolean
  /** Re-bind when stream changes. */
  streamKey: string
  className?: string
}

const BAR_COUNT = 48

export function AudioVisualizer({
  audio,
  decorative,
  streamKey,
  className,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>(0)
  const ctxRef = useRef<AudioContext | null>(null)

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
    let t0 = performance.now()
    let onPlay: (() => void) | null = null

    if (!decorative && audio) {
      try {
        const actx = new AudioContext()
        ctxRef.current = actx
        const source = actx.createMediaElementSource(audio)
        analyser = actx.createAnalyser()
        analyser.fftSize = 256
        source.connect(analyser)
        analyser.connect(actx.destination)
        dataArray = new Uint8Array(analyser.frequencyBinCount)
        onPlay = () => {
          void actx.resume()
        }
        audio.addEventListener("play", onPlay)
      } catch {
        /* CORS or duplicate source — use fake spectrum */
      }
    }

    const loop = (t: number) => {
      rafRef.current = requestAnimationFrame(loop)
      if (dataArray && analyser) {
        analyser.getByteFrequencyData(
          dataArray as Parameters<AnalyserNode["getByteFrequencyData"]>[0],
        )
        const step = Math.max(1, Math.floor(dataArray.length / BAR_COUNT))
        for (let i = 0; i < BAR_COUNT; i++) {
          out[i] = (dataArray[i * step] ?? 0) / 255
        }
        drawBars(out)
        return
      }
      const elapsed = (t - t0) / 1000
      for (let i = 0; i < BAR_COUNT; i++) {
        const phase = elapsed * 2.2 + i * 0.15
        out[i] =
          0.15 +
          0.55 *
            (0.5 + 0.5 * Math.sin(phase)) *
            (0.5 + 0.5 * Math.sin(elapsed * 1.7 + i * 0.08))
      }
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
      const c = ctxRef.current
      if (c?.state !== "closed") void c?.close()
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
