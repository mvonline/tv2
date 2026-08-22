import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"
import "./ui-themes.css"
import App from "./App.tsx"
import { initLogosBase } from "@/lib/logosBase"

const root = createRoot(document.getElementById("root")!)

const tree = (
  <StrictMode>
    <App />
  </StrictMode>
)

// Paint first, then adopt an API-provided logos base if there is one. Awaiting
// the API before the first render put a network round trip in front of every
// pixel, on hosts that mostly do not have that endpoint at all.
root.render(tree)
void initLogosBase().then((changed) => {
  if (changed) root.render(tree)
})
