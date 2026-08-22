import { Suspense, lazy, useEffect } from "react"
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom"
import { CategoriesProvider } from "@/context/CategoriesContext"
import { ChannelsProvider } from "@/context/ChannelsContext"
import { FavoritesProvider } from "@/context/FavoritesContext"
import { RecentlyWatchedProvider } from "@/context/RecentlyWatchedContext"
import { UiStyleProvider } from "@/context/UiStyleContext"
import { HomePage } from "@/pages/HomePage"

// hls.js alone is 542 kB minified, and it is reachable only from these two
// routes — the home page cannot play anything. Loading them on demand keeps it
// off the critical path for the first paint.
const WatchPage = lazy(() =>
  import("@/pages/WatchPage").then((m) => ({ default: m.WatchPage })),
)
const MultiViewPage = lazy(() =>
  import("@/pages/MultiViewPage").then((m) => ({ default: m.MultiViewPage })),
)

type NetworkInformation = { saveData?: boolean; effectiveType?: string }

/** Don't spend someone's metered or 2G connection on a chunk they may not open. */
function prefetchWouldBeRude(): boolean {
  const conn = (navigator as Navigator & { connection?: NetworkInformation }).connection
  if (!conn) return false
  if (conn.saveData) return true
  return /(^|-)2g$/.test(conn.effectiveType ?? "")
}

/**
 * Warm the player chunk the moment someone shows intent to open a channel —
 * hovering or tab-focusing any link into /watch/.
 *
 * Intent rather than a timer, because importing the 538 kB chunk also compiles
 * it: doing that on load cost 50 ms of total blocking time for a chunk the
 * visitor might never open. Hover fires well before the click, so navigation
 * still feels instant, and one delegated listener covers every channel link
 * without threading a callback through each card and row component.
 */
function usePlayerPrefetch() {
  useEffect(() => {
    if (prefetchWouldBeRude()) return

    let done = false
    const onIntent = (event: Event) => {
      if (done) return
      const target = event.target
      if (!(target instanceof Element)) return
      const link = target.closest("a[href]")
      if (!link?.getAttribute("href")?.includes("/watch/")) return
      done = true
      void import("@/pages/WatchPage")
      detach()
    }
    const detach = () => {
      document.removeEventListener("pointerover", onIntent)
      document.removeEventListener("focusin", onIntent)
      document.removeEventListener("touchstart", onIntent)
    }

    document.addEventListener("pointerover", onIntent, { passive: true })
    document.addEventListener("focusin", onIntent)
    document.addEventListener("touchstart", onIntent, { passive: true })
    return detach
  }, [])
}

function RouteFallback() {
  return (
    <div className="page page--center">
      <p className="muted">Loading…</p>
    </div>
  )
}

function routerBasename(): string | undefined {
  const b = import.meta.env.BASE_URL
  if (b === "/" || b === "") return undefined
  return b.endsWith("/") ? b.slice(0, -1) : b
}

export default function App() {
  usePlayerPrefetch()
  return (
    <CategoriesProvider>
      <ChannelsProvider>
        <FavoritesProvider>
          <RecentlyWatchedProvider>
          <UiStyleProvider>
            <BrowserRouter basename={routerBasename()}>
              <div className="app-root">
                <Suspense fallback={<RouteFallback />}>
                  <Routes>
                    <Route path="/" element={<HomePage />} />
                    <Route path="/watch/:channelKey" element={<WatchPage />} />
                    <Route path="/multiview" element={<MultiViewPage />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                </Suspense>
              </div>
            </BrowserRouter>
          </UiStyleProvider>
          </RecentlyWatchedProvider>
        </FavoritesProvider>
      </ChannelsProvider>
    </CategoriesProvider>
  )
}
