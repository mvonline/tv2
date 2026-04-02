import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom"
import { CategoriesProvider } from "@/context/CategoriesContext"
import { ChannelsProvider } from "@/context/ChannelsContext"
import { FavoritesProvider } from "@/context/FavoritesContext"
import { UiStyleProvider } from "@/context/UiStyleContext"
import { HomePage } from "@/pages/HomePage"
import { WatchPage } from "@/pages/WatchPage"

function routerBasename(): string | undefined {
  const b = import.meta.env.BASE_URL
  if (b === "/" || b === "") return undefined
  return b.endsWith("/") ? b.slice(0, -1) : b
}

export default function App() {
  return (
    <CategoriesProvider>
      <ChannelsProvider>
        <FavoritesProvider>
          <UiStyleProvider>
            <BrowserRouter basename={routerBasename()}>
              <div className="app-root">
                <Routes>
                  <Route path="/" element={<HomePage />} />
                  <Route path="/watch/:channelKey" element={<WatchPage />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </div>
            </BrowserRouter>
          </UiStyleProvider>
        </FavoritesProvider>
      </ChannelsProvider>
    </CategoriesProvider>
  )
}
