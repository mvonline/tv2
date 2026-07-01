import Hls from "hls.js"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { Link } from "react-router-dom"
import { Pause, Play, X } from "lucide-react"
import type { Channel } from "@/types/channel"
import { hlsPlaybackUrl } from "@/lib/hlsProxyUrl"
import { channelLogoUrl } from "@/lib/publicUrl"
import { watchUrlForChannel } from "@/lib/paths"

const RESUME_AUDIO_VISUALIZER_EVENT = "tv2:resume-audio-visualizer"

type PersistentRadioContextValue = {
  channel: Channel | null
  audioEl: HTMLAudioElement | null
  isPlaying: boolean
  error: string | null
  playChannel: (channel: Channel) => void
  toggle: () => void
  stop: () => void
}

const PersistentRadioContext =
  createContext<PersistentRadioContextValue | null>(null)

function tryPlay(media: HTMLMediaElement | null, onFailed?: () => void) {
  if (!media) return
  const result = media.play()
  if (result && typeof result.catch === "function") {
    result.catch(() => onFailed?.())
  }
}

function resetMedia(media: HTMLMediaElement) {
  media.pause()
  media.removeAttribute("src")
  media.load()
}

function streamKeyFor(channel: Channel | null) {
  return channel ? `${channel.page_url}|${channel.stream_url ?? ""}` : "empty"
}

export function PersistentRadioProvider({ children }: { children: ReactNode }) {
  const [channel, setChannel] = useState<Channel | null>(null)
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hlsRef = useRef<Hls | null>(null)
  const shouldPlayRef = useRef(false)

  const streamKey = streamKeyFor(channel)

  const playChannel = useCallback((next: Channel) => {
    shouldPlayRef.current = true
    setError(null)
    setChannel(next)
  }, [])

  const stop = useCallback(() => {
    shouldPlayRef.current = false
    const audio = audioEl
    if (audio) resetMedia(audio)
    hlsRef.current?.destroy()
    hlsRef.current = null
    setChannel(null)
    setIsPlaying(false)
    setError(null)
  }, [audioEl])

  const toggle = useCallback(() => {
    const audio = audioEl
    if (!audio) return
    if (audio.paused) {
      shouldPlayRef.current = true
      window.dispatchEvent(new Event(RESUME_AUDIO_VISUALIZER_EVENT))
      tryPlay(audio)
    } else {
      shouldPlayRef.current = false
      audio.pause()
    }
  }, [audioEl])

  useEffect(() => {
    const audio = audioEl
    if (!audio) return

    const sync = () => setIsPlaying(!audio.paused)
    audio.addEventListener("play", sync)
    audio.addEventListener("playing", sync)
    audio.addEventListener("pause", sync)
    audio.addEventListener("ended", sync)
    sync()
    return () => {
      audio.removeEventListener("play", sync)
      audio.removeEventListener("playing", sync)
      audio.removeEventListener("pause", sync)
      audio.removeEventListener("ended", sync)
    }
  }, [audioEl])

  useEffect(() => {
    const audio = audioEl
    if (!audio || !channel?.stream_url) return

    setError(null)
    const url = channel.stream_url
    const isHls =
      channel.stream_type === "hls" ||
      (url.toLowerCase().includes(".m3u8") ?? false)
    const isIframe = channel.stream_type === "iframe"
    if (isIframe) return

    const source = isHls
      ? (hlsPlaybackUrl(url, channel.requires_proxy, channel.stream_type) ?? url)
      : url

    const playWhenReady = () => {
      if (shouldPlayRef.current) tryPlay(audio)
    }

    if (isHls && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: false,
        lowLatencyMode: true,
        maxBufferLength: 15,
        maxMaxBufferLength: 20,
        maxBufferSize: 8 * 1024 * 1024,
      })
      hlsRef.current = hls
      hls.loadSource(source)
      hls.attachMedia(audio)
      audio.addEventListener("canplay", playWhenReady)
      hls.on(Hls.Events.MANIFEST_PARSED, playWhenReady)
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) setError("Radio stream error. Try again later.")
      })
      return () => {
        audio.removeEventListener("canplay", playWhenReady)
        hls.detachMedia()
        hls.destroy()
        hlsRef.current = null
        resetMedia(audio)
      }
    }

    audio.src = source
    audio.addEventListener("canplay", playWhenReady)
    playWhenReady()
    return () => {
      audio.removeEventListener("canplay", playWhenReady)
      resetMedia(audio)
    }
  }, [audioEl, channel])

  const value = useMemo(
    () => ({
      channel,
      audioEl,
      isPlaying,
      error,
      playChannel,
      toggle,
      stop,
    }),
    [audioEl, channel, error, isPlaying, playChannel, stop, toggle],
  )

  return (
    <PersistentRadioContext.Provider value={value}>
      {children}
      <audio
        key={streamKey}
        ref={setAudioEl}
        className="persistent-radio-audio"
        crossOrigin="anonymous"
      />
      <PersistentRadioBar />
    </PersistentRadioContext.Provider>
  )
}

export function usePersistentRadio() {
  const ctx = useContext(PersistentRadioContext)
  if (!ctx) {
    throw new Error("usePersistentRadio must be used inside PersistentRadioProvider")
  }
  return ctx
}

function PersistentRadioBar() {
  const { channel, isPlaying, error, toggle, stop } = usePersistentRadio()
  if (!channel) return null

  const logo = channelLogoUrl(channel.logo)
  return (
    <div className="persistent-radio-bar" role="region" aria-label="Radio player">
      <button
        type="button"
        className="persistent-radio-bar__play"
        onClick={toggle}
        aria-label={isPlaying ? "Pause radio" : "Play radio"}
      >
        {isPlaying ? <Pause size={18} aria-hidden /> : <Play size={18} aria-hidden />}
      </button>
      <Link to={watchUrlForChannel(channel)} className="persistent-radio-bar__meta">
        {logo ? <img src={logo} alt="" /> : <span aria-hidden>RAD</span>}
        <span>
          <strong>{channel.name ?? channel.slug}</strong>
          <small>{error ?? (isPlaying ? "Playing" : "Paused")}</small>
        </span>
      </Link>
      <button
        type="button"
        className="persistent-radio-bar__close"
        onClick={stop}
        aria-label="Close radio player"
      >
        <X size={18} aria-hidden />
      </button>
    </div>
  )
}
