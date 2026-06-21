import { useEffect, useRef, useState } from "react"

/**
 * Observes a div ref and flips `visible` to true once the element enters
 * the extended viewport (rootMargin). Never resets — once rendered, stays rendered.
 */
export function useLazyRender(rootMargin = "500px 0px") {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el || visible) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          io.disconnect()
        }
      },
      { rootMargin },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [visible, rootMargin])

  return { ref, visible }
}
