import { useEffect, useState } from "react"
import { MOBILE_BREAKPOINT } from "@/lib/mobileLayout"

/** Tracks viewport ≤768px; updates on resize/orientation. */
export function useMobileViewport(): boolean {
  const [mobile, setMobile] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia(MOBILE_BREAKPOINT).matches
      : false,
  )

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_BREAKPOINT)
    const sync = () => setMobile(mq.matches)
    sync()
    mq.addEventListener("change", sync)
    return () => mq.removeEventListener("change", sync)
  }, [])

  return mobile
}
