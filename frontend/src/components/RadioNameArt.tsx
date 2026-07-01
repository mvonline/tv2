import { useEffect, useRef, type RefObject } from "react"

type Props = {
  name: string
  levelsRef: RefObject<Float32Array | null>
  streamKey: string
}

const BLOCKS = " .:-=+*#%@"

function clampText(text: string) {
  const clean = text.trim().replace(/\s+/g, " ")
  return clean.length > 28 ? `${clean.slice(0, 25)}...` : clean
}

export function RadioNameArt({ name, levelsRef, streamKey }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const g = canvas.getContext("2d")
    if (!g) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    let raf = 0
    let lastDraw = 0
    let tick = 0

    const resize = () => {
      const parent = canvas.parentElement
      const box = parent?.getBoundingClientRect()
      const w = Math.max(280, Math.round(box?.width || parent?.clientWidth || 640))
      const cssHeight = Math.max(150, Math.min(260, Math.round(w * 0.32)))
      const h = cssHeight
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
    }

    resize()
    window.addEventListener("resize", resize)
    const retryResize = window.setTimeout(resize, 120)
    let roCleanup = () => {}
    if (typeof ResizeObserver !== "undefined" && canvas.parentElement) {
      const ro = new ResizeObserver(resize)
      ro.observe(canvas.parentElement)
      roCleanup = () => ro.disconnect()
    }

    const title = clampText(name || "Radio")

    const draw = (now: number) => {
      raf = window.requestAnimationFrame(draw)
      if (now - lastDraw < 110) return
      lastDraw = now
      tick += 1

      const w = canvas.width
      const h = canvas.height
      const levels = levelsRef.current

      g.clearRect(0, 0, w, h)
      g.fillStyle = "rgba(3, 5, 10, 0.74)"
      g.fillRect(0, 0, w, h)

      let bass = 0.18
      let mid = 0.16
      let high = 0.12
      if (levels?.length) {
        const third = Math.max(1, Math.floor(levels.length / 3))
        const avg = (start: number, end: number) => {
          let total = 0
          let count = 0
          for (let i = start; i < end && i < levels.length; i += 1) {
            total += levels[i] || 0
            count += 1
          }
          return count ? total / count : 0
        }
        bass = avg(0, third)
        mid = avg(third, third * 2)
        high = avg(third * 2, levels.length)
      }

      const pulse = Math.min(1, bass * 1.2 + mid * 0.35)
      const cols = 38
      const rows = 8
      const cellW = w / cols
      const cellH = h / (rows + 6)

      g.font = `${Math.max(12, Math.floor(cellH * 0.95))}px ui-monospace, monospace`
      g.textAlign = "center"
      g.textBaseline = "middle"

      for (let y = 0; y < rows; y += 1) {
        for (let x = 0; x < cols; x += 1) {
          const wave =
            0.5 +
            0.5 *
              Math.sin(tick * 0.32 + x * 0.34 + y * 0.72 + bass * 3)
          const v = Math.min(1, wave * (0.18 + pulse * 0.82) + high * 0.35)
          const idx = Math.min(BLOCKS.length - 1, Math.floor(v * BLOCKS.length))
          g.fillStyle = `rgba(${Math.round(80 + high * 140)}, ${Math.round(
            150 + mid * 90,
          )}, ${Math.round(170 + bass * 70)}, ${0.12 + v * 0.48})`
          g.fillText(BLOCKS[idx], x * cellW + cellW / 2, y * cellH + cellH / 2)
        }
      }

      const centerY = h * 0.62
      g.fillStyle = "rgba(0, 0, 0, 0.42)"
      g.fillRect(w * 0.1, centerY - cellH * 1.65, w * 0.8, cellH * 3.3)

      g.fillStyle = `rgba(255, ${Math.round(205 + pulse * 45)}, 94, 0.94)`
      g.font = `${Math.max(11, Math.floor(cellH * 0.8))}px ui-monospace, monospace`
      g.fillText("ON AIR", w / 2, centerY - cellH * 1.05)

      g.fillStyle = "#f4f7ff"
      g.font = `700 ${Math.max(20, Math.floor(cellH * 1.55))}px ui-monospace, monospace`
      g.fillText(title.toUpperCase(), w / 2, centerY + cellH * 0.38)

      const meterW = w * 0.58
      const meterX = (w - meterW) / 2
      const meterY = centerY + cellH * 1.45
      const blocks = 18
      for (let i = 0; i < blocks; i += 1) {
        const active = i / blocks < Math.min(1, pulse + high * 0.35)
        g.fillStyle = active ? "rgba(111, 232, 174, 0.92)" : "rgba(255,255,255,0.12)"
        g.fillRect(
          meterX + i * (meterW / blocks),
          meterY,
          meterW / blocks - 3 * dpr,
          Math.max(3 * dpr, cellH * 0.3),
        )
      }
    }

    raf = window.requestAnimationFrame(draw)

    return () => {
      window.cancelAnimationFrame(raf)
      window.clearTimeout(retryResize)
      window.removeEventListener("resize", resize)
      roCleanup()
    }
  }, [name, levelsRef, streamKey])

  return <canvas ref={canvasRef} className="radio-name-art" aria-hidden />
}
