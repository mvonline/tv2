/** Matches `max-width` breakpoints in `index.css` (sidebar overlay, numpad, etc.). */
export const MOBILE_BREAKPOINT = "(max-width: 768px)"

export function isMobileViewport(): boolean {
  if (typeof window === "undefined") return false
  return window.matchMedia(MOBILE_BREAKPOINT).matches
}
