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
    const resize = () => {
      const parent = canvas.parentElement
      const w = parent?.clientWidth ?? 640
      const h = Math.min(200, Math.max(120, (parent?.clientHeight ?? 160) * 0.45))
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
    }
    resize()
    const ro = new ResizeObserver(resize)
    if (canvas.parentElement) ro.observe(canvas.parentElement)

    const g = canvas.getContext("2d")
    if (!g) return () => ro.disconnect()

    const drawBars = (levels: ArrayLike<number>) => {
      const w = canvas.width
      const h = canvas.height
      g.clearRect(0, 0, w, h)
      const gap = Math.max(1, Math.floor(w / 400))
      const barW = (w - gap * (BAR_COUNT + 1)) / BAR_COUNT
      let x = gap
      for (let i = 0; i < BAR_COUNT; i++) {
        const v =
          typeof levels[i] === "number"
            ? (levels[i] as number)
            : (levels[i] ?? 0)
        const bh = Math.max(4, v * h * 0.92)
        const grad = g.createLinearGradient(0, h, 0, h - bh)
        grad.addColorStop(0, "rgba(61, 139, 253, 0.95)")
        grad.addColorStop(1, "rgba(124, 92, 255, 0.75)")
        g.fillStyle = grad
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
        const ctx = new AudioContext()
        ctxRef.current = ctx
        const source = ctx.createMediaElementSource(audio)
        analyser = ctx.createAnalyser()
        analyser.fftSize = 256
        source.connect(analyser)
        analyser.connect(ctx.destination)
        dataArray = new Uint8Array(analyser.frequencyBinCount)
        onPlay = () => {
          void ctx.resume()
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
        const out = new Float32Array(BAR_COUNT)
        const step = Math.max(1, Math.floor(dataArray.length / BAR_COUNT))
        for (let i = 0; i < BAR_COUNT; i++) {
          const slice = dataArray[i * step] ?? 0
          out[i] = slice / 255
        }
        drawBars(out)
        return
      }
      const elapsed = (t - t0) / 1000
      const fake: number[] = []
      for (let i = 0; i < BAR_COUNT; i++) {
        const phase = elapsed * 2.2 + i * 0.15
        fake[i] =
          0.15 +
          0.55 *
            (0.5 + 0.5 * Math.sin(phase)) *
            (0.5 + 0.5 * Math.sin(elapsed * 1.7 + i * 0.08))
      }
      drawBars(fake)
    }

    rafRef.current = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(rafRef.current)
      ro.disconnect()
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
