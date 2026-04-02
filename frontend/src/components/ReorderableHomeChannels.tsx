import { useCallback, useRef, type ReactNode } from "react"
import type { LayoutMode } from "@/context/UiStyleContext"
import type { Channel } from "@/types/channel"

const MIME = "application/x-tv2-page-url"

function moveIndex<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) {
    return list
  }
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

type Props = {
  channels: Channel[]
  layout: LayoutMode
  onReorder: (pageUrls: string[]) => void
  renderChannel: (ch: Channel, channelNo: number, opts: { linkless: boolean }) => ReactNode
}

export function ReorderableHomeChannels({
  channels,
  layout,
  onReorder,
  renderChannel,
}: Props) {
  const dragUrl = useRef<string | null>(null)

  const onDragStart = useCallback((e: React.DragEvent, pageUrl: string) => {
    dragUrl.current = pageUrl
    e.dataTransfer.setData(MIME, pageUrl)
    e.dataTransfer.effectAllowed = "move"
    const el = e.currentTarget as HTMLElement
    el.classList.add("reorder-item--dragging")
  }, [])

  const onDragEnd = useCallback((e: React.DragEvent) => {
    dragUrl.current = null
    const el = e.currentTarget as HTMLElement
    el.classList.remove("reorder-item--dragging")
  }, [])

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent, dropIndex: number) => {
      e.preventDefault()
      const url =
        e.dataTransfer.getData(MIME) || dragUrl.current
      dragUrl.current = null
      if (!url) return
      const fromIndex = channels.findIndex((c) => c.page_url === url)
      if (fromIndex < 0 || fromIndex === dropIndex) return
      const next = moveIndex(channels, fromIndex, dropIndex)
      onReorder(next.map((c) => c.page_url))
    },
    [channels, onReorder],
  )

  const gridClass =
    layout === "thumbnail"
      ? "channel-grid channel-grid--reorder"
      : layout === "list"
        ? "channel-list channel-list--reorder"
        : "channel-details channel-details--reorder"

  return (
    <div className={gridClass} role="list" aria-label="Reorder channels">
      {channels.map((ch, index) => (
        <div
          key={ch.page_url}
          className="reorder-item"
          role="listitem"
          draggable
          onDragStart={(e) => onDragStart(e, ch.page_url)}
          onDragEnd={onDragEnd}
          onDragOver={onDragOver}
          onDrop={(e) => onDrop(e, index)}
        >
          {renderChannel(ch, index + 1, { linkless: true })}
        </div>
      ))}
    </div>
  )
}
