import { useLayoutEffect } from "react"
import type { Channel } from "@/types/channel"
import { RadioPlayer } from "@/components/RadioPlayer"
import { VideoPlayer } from "@/components/VideoPlayer"

type Props = {
  channel: Channel
  className?: string
  onVideoRef?: (el: HTMLVideoElement | null) => void
  muted?: boolean
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

/** Multi-view: iframe embeds cannot isolate audio — exclude from picker. */
export function channelSupportsMultiViewStream(channel: Channel): boolean {
  if (!channel.stream_url && !channel.raw_iframe_src) return false
  if (channel.stream_type === "iframe") return false
  return true
}

export function StreamPlayer({
  channel,
  className,
  onVideoRef,
  muted,
}: Props) {
  useLayoutEffect(() => {
    if (isRadioChannel(channel)) {
      onVideoRef?.(null)
    }
  }, [channel, onVideoRef])

  if (isRadioChannel(channel)) {
    return (
      <RadioPlayer channel={channel} className={className} muted={muted} />
    )
  }
  return (
    <VideoPlayer
      channel={channel}
      className={className}
      onVideoRef={onVideoRef}
      muted={muted}
    />
  )
}
