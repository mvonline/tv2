import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { Play } from "lucide-react"
import { channelLogoUrl } from "@/lib/publicUrl"
import { thumbHueForChannel } from "@/lib/topicAccent"
import { watchUrlForChannel } from "@/lib/paths"
import type { Channel } from "@/types/channel"

type Props = { channels: Channel[] }

const DURATION_MS = 6000

export function CinemaHero({ channels }: Props) {
  const featured = channels.slice(0, 8)
  const count = featured.length
  const [index, setIndex] = useState(0)
  const [visible, setVisible] = useState(true)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const goTo = useCallback(
    (next: number) => {
      if (timerRef.current) clearTimeout(timerRef.current)
      setVisible(false)
      setTimeout(() => {
        setIndex((next + count) % count)
        setVisible(true)
      }, 280)
    },
    [count],
  )

  useEffect(() => {
    timerRef.current = setTimeout(() => goTo(index + 1), DURATION_MS)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [index, goTo])

  if (!count) return null

  const ch = featured[index]
  const hue = thumbHueForChannel(ch.ai_category)
  const logo = channelLogoUrl(ch.logo)

  return (
    <div
      className="cinema-hero"
      style={{ "--hero-hue": String(hue) } as CSSProperties}
    >
      {/* Animated background blobs */}
      <div className={`cinema-hero__backdrop ${visible ? "is-in" : "is-out"}`} />

      {/* Main content area */}
      <div className={`cinema-hero__stage ${visible ? "is-in" : "is-out"}`}>
        {/* Logo spotlight */}
        <div className="cinema-hero__spotlight">
          <div className="cinema-hero__logo-ring">
            {logo ? (
              <img className="cinema-hero__logo" src={logo} alt="" />
            ) : (
              <span className="cinema-hero__logo-ph">{ch.name?.[0] ?? "TV"}</span>
            )}
          </div>
        </div>

        {/* Info */}
        <div className="cinema-hero__info">
          {ch.ai_category && (
            <span className="cinema-hero__badge">{ch.ai_category}</span>
          )}
          <h2 className="cinema-hero__name">{ch.name ?? ch.slug}</h2>
          <Link className="cinema-hero__cta" to={watchUrlForChannel(ch)}>
            <Play size={15} aria-hidden fill="currentColor" />
            Watch Now
          </Link>
        </div>
      </div>

      {/* Progress bar */}
      <div className="cinema-hero__progress-track">
        <div
          key={`${index}-progress`}
          className="cinema-hero__progress-bar"
          style={{ "--dur": `${DURATION_MS}ms` } as CSSProperties}
        />
      </div>

      {/* Dot navigation */}
      <div className="cinema-hero__nav">
        {featured.map((c, i) => (
          <button
            key={c.page_url}
            type="button"
            className={`cinema-hero__dot ${i === index ? "is-active" : ""}`}
            onClick={() => goTo(i)}
            aria-label={`Feature ${c.name ?? c.slug}`}
          />
        ))}
      </div>
    </div>
  )
}
