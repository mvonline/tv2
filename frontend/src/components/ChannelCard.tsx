import type { CSSProperties } from "react"
import { Link } from "react-router-dom"
import { FavoriteButton } from "@/components/FavoriteButton"
import { thumbHueForChannel } from "@/lib/topicAccent"
import { publicUrl } from "@/lib/publicUrl"
import type { Channel } from "@/types/channel"
import { watchUrlForChannel } from "@/lib/paths"

type Props = {
  channel: Channel
  channelNo: number
  /** When true, card is not a link (e.g. homepage reorder mode). */
  linkless?: boolean
}

export function ChannelCard({ channel, channelNo, linkless }: Props) {
  const logoSrc = channel.logo ? publicUrl(channel.logo) : null
  const to = watchUrlForChannel(channel)
  const hue = thumbHueForChannel(channel.ai_category)

  const body = (
    <>
      <div className="channel-card__thumb-shell">
        <div className="channel-card__thumb">
          {logoSrc ? (
            <img src={logoSrc} alt="" loading="lazy" decoding="async" />
          ) : (
            <span className="channel-card__placeholder" aria-hidden>
              TV
            </span>
          )}
        </div>
      </div>
      <span className="channel-card__name">{channel.name ?? channel.slug}</span>
    </>
  )

  return (
    <div
      className="channel-card-wrap"
      style={{ "--thumb-hue": String(hue) } as CSSProperties}
    >
      <span className="channel-id-badge" title={`Channel ${channelNo}`}>
        CH {channelNo}
      </span>
      <FavoriteButton channel={channel} className="channel-card-wrap__fav" />
      {linkless ? (
        <div className="channel-card channel-card--linkless">{body}</div>
      ) : (
        <Link className="channel-card" to={to} tabIndex={0}>
          {body}
        </Link>
      )}
    </div>
  )
}
