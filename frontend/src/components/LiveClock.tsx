import { useEffect, useState } from "react"

function pad(n: number) {
  return n.toString().padStart(2, "0")
}

export function LiveClock() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const hh = pad(now.getHours())
  const mm = pad(now.getMinutes())
  const iso = now.toISOString()

  return (
    <time className="watch-bar__clock" dateTime={iso}>
      {hh}:{mm}
    </time>
  )
}
