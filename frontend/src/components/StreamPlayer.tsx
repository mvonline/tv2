import { useLayoutEffect } from "react"
import type { Channel } from "@/types/channel"
import { RadioPlayer } from "@/components/RadioPlayer"
import { VideoPlayer } from "@/components/VideoPlayer"

type Props = {
  channel: Channel
  className?: string
  onVideoRef?: (el: HTMLVideoElement | null) => void
}

export function isRadioChannel(channel: Channel): boolean {
  if (channel.media_type === "radio") return true
  return channel.category_path.toLowerCase().includes("radio")
}

/** Native video PiP is only for direct / HLS video, not iframe embeds or radio. */
export function channelSupportsPictureInPicture(channel: Channel): boolean {
  if (isRadioChannel(channel)) return false
  if (channel.stream_type === "iframe") return false
  return Boolean(channel.stream_url)
}

export function StreamPlayer({ channel, className, onVideoRef }: Props) {
  useLayoutEffect(() => {
    if (isRadioChannel(channel)) {
      onVideoRef?.(null)
    }
  }, [channel, onVideoRef])

  if (isRadioChannel(channel)) {
    return <RadioPlayer channel={channel} className={className} />
  }
  return (
    <VideoPlayer
      channel={channel}
      className={className}
      onVideoRef={onVideoRef}
    />
  )
}
