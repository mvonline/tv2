import { Link } from "react-router-dom"
import { FavoriteButton } from "@/components/FavoriteButton"
import { publicUrl } from "@/lib/publicUrl"
import type { Channel } from "@/types/channel"
import { watchUrlForChannel } from "@/lib/paths"

type Props = {
  channel: Channel
  channelNo: number
  linkless?: boolean
}

export function ChannelListRow({ channel, channelNo, linkless }: Props) {
  const logoSrc = channel.logo ? publicUrl(channel.logo) : null
  const to = watchUrlForChannel(channel)

  const body = (
    <>
      <div className="channel-list-row__thumb">
        {logoSrc ? (
          <img src={logoSrc} alt="" loading="lazy" decoding="async" />
        ) : (
          <span className="channel-list-row__ph" aria-hidden>
            TV
          </span>
        )}
      </div>
      <span className="channel-list-row__name">{channel.name ?? channel.slug}</span>
    </>
  )

  return (
    <div className="channel-list-row-wrap">
      <span className="channel-id-badge channel-id-badge--row" title={`Channel ${channelNo}`}>
        {channelNo}
      </span>
      {linkless ? (
        <div className="channel-list-row channel-list-row--linkless">{body}</div>
      ) : (
        <Link className="channel-list-row" to={to} tabIndex={0}>
          {body}
        </Link>
      )}
      <FavoriteButton channel={channel} className="channel-list-row-wrap__fav" />
    </div>
  )
}
