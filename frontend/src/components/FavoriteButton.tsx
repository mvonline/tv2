import { Star } from "lucide-react"
import type { Channel } from "@/types/channel"
import { useFavorites } from "@/context/FavoritesContext"

type Props = {
  channel: Channel
  className?: string
  label?: string
  /** Lucide icon size (default 20) */
  iconSize?: number
}

export function FavoriteButton({ channel, className, label, iconSize = 20 }: Props) {
  const { isFavorite, toggleFavorite } = useFavorites()
  const on = isFavorite(channel)

  return (
    <button
      type="button"
      className={`favorite-btn ${on ? "is-on" : ""} ${className ?? ""}`.trim()}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        toggleFavorite(channel)
      }}
      title={on ? "Remove from favorites" : "Add to favorites"}
      aria-label={label ?? (on ? "Remove from favorites" : "Add to favorites")}
      data-isfavorite={on ? "true" : "false"}
    >
      <Star
        size={iconSize}
        strokeWidth={2}
        className="favorite-btn__lucide"
        aria-hidden
        fill={on ? "currentColor" : "none"}
      />
    </button>
  )
}
