import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"
import "./ui-themes.css"
import App from "./App.tsx"
import { initLogosBase } from "@/lib/logosBase"

void initLogosBase().then(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
