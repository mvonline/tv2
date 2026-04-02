import { Link } from "react-router-dom"
import { FavoriteButton } from "@/components/FavoriteButton"
import { publicUrl } from "@/lib/publicUrl"
import { formatCategoryTitle } from "@/lib/groupByCategory"
import type { Channel } from "@/types/channel"
import { watchUrlForChannel } from "@/lib/paths"

type Props = {
  channel: Channel
  channelNo: number
  linkless?: boolean
}

export function ChannelDetailsRow({ channel, channelNo, linkless }: Props) {
  const logoSrc = channel.logo ? publicUrl(channel.logo) : null
  const to = watchUrlForChannel(channel)

  const body = (
    <>
      <div className="channel-details-row__thumb">
        {logoSrc ? (
          <img src={logoSrc} alt="" loading="lazy" decoding="async" />
        ) : (
          <span className="channel-details-row__ph" aria-hidden>
            TV
          </span>
        )}
      </div>
      <div className="channel-details-row__main">
        <span className="channel-details-row__title">{channel.name ?? channel.slug}</span>
        <span className="channel-details-row__cat">
          {formatCategoryTitle(channel.category_path)}
        </span>
      </div>
      <div className="channel-details-row__meta">
        {channel.stream_host && (
          <span className="channel-details-row__host">{channel.stream_host}</span>
        )}
        {channel.requires_proxy && (
          <span className="channel-details-row__badge">Proxy</span>
        )}
      </div>
    </>
  )

  return (
    <div className="channel-details-row-wrap">
      <span className="channel-id-badge channel-id-badge--details" title={`Channel ${channelNo}`}>
        CH {channelNo}
      </span>
      {linkless ? (
        <div className="channel-details-row channel-details-row--linkless">{body}</div>
      ) : (
        <Link className="channel-details-row" to={to} tabIndex={0}>
          {body}
        </Link>
      )}
      <FavoriteButton channel={channel} className="channel-details-row-wrap__fav" />
    </div>
  )
}
