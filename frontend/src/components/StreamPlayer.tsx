import type { Channel } from "@/types/channel"
import { RadioPlayer } from "@/components/RadioPlayer"
import { VideoPlayer } from "@/components/VideoPlayer"

type Props = {
  channel: Channel
  className?: string
}

function isRadioChannel(channel: Channel): boolean {
  if (channel.media_type === "radio") return true
  return channel.category_path.toLowerCase().includes("radio")
}

export function StreamPlayer({ channel, className }: Props) {
  if (isRadioChannel(channel)) {
    return <RadioPlayer channel={channel} className={className} />
  }
  return <VideoPlayer channel={channel} className={className} />
}
