import {
  LayoutGrid,
  List,
  ListTree,
  Monitor,
  Sparkles,
  Layers,
} from "lucide-react"
import type { LayoutMode, VisualTheme } from "@/context/UiStyleContext"
import { useUiStyle } from "@/context/UiStyleContext"

const VISUALS: { id: VisualTheme; label: string; Icon: typeof Monitor }[] = [
  { id: "tv", label: "TV mode — large controls", Icon: Monitor },
  { id: "neon", label: "Neon theme", Icon: Sparkles },
  { id: "glass", label: "Glass theme", Icon: Layers },
]

const LAYOUTS: { id: LayoutMode; label: string; Icon: typeof LayoutGrid }[] = [
  { id: "thumbnail", label: "Thumbnail grid", Icon: LayoutGrid },
  { id: "list", label: "List layout", Icon: List },
  { id: "details", label: "Details layout", Icon: ListTree },
]

const iconProps = { size: 20, strokeWidth: 2, "aria-hidden": true as const }

export function StyleToolbar() {
  const { visual, setVisual, layout, setLayout } = useUiStyle()

  return (
    <div className="style-toolbar" role="toolbar" aria-label="Display and layout">
      <div className="style-toolbar__block">
        <span className="style-toolbar__label" id="style-vis-label">
          Look
        </span>
        <div className="style-toolbar__group" aria-labelledby="style-vis-label">
          {VISUALS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              className={`style-toolbar__btn style-toolbar__btn--icon ${
                visual === id ? "is-active" : ""
              }`}
              onClick={() => setVisual(id)}
              aria-label={label}
              title={label}
            >
              <Icon {...iconProps} />
            </button>
          ))}
        </div>
      </div>
      <div className="style-toolbar__block">
        <span className="style-toolbar__label" id="style-lay-label">
          Layout
        </span>
        <div className="style-toolbar__group" aria-labelledby="style-lay-label">
          {LAYOUTS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              className={`style-toolbar__btn style-toolbar__btn--icon ${
                layout === id ? "is-active" : ""
              }`}
              onClick={() => setLayout(id)}
              aria-label={label}
              title={label}
            >
              <Icon {...iconProps} />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
