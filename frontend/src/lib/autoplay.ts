/**
 * Keeps a live stream playing.
 *
 * `<video autoplay>` alone is not enough: the browser blocks unmuted autoplay,
 * live streams stall on network hiccups, and a backgrounded tab often comes
 * back paused. Any of those leaves the page loaded with a stopped stream.
 *
 * The keeper retries playback on every event that can leave the element
 * paused, falls back to muted playback when the autoplay policy blocks sound,
 * and reports unrecoverable stalls so the caller can reload the source. A pause
 * the viewer asked for is left alone — see `pause` handling below.
 */

/** Retry delay after a rejected play() that muting did not fix. */
const RETRY_MS = 1000
/** How often to check that playback is actually progressing. */
const WATCHDOG_MS = 2000
/** A pause this soon after a click/keypress on the element is the viewer's. */
const USER_GESTURE_WINDOW_MS = 600
/** No progress for this long while unpaused means the stream needs a reload. */
const STALL_TOLERANCE_MS = 10_000

export type AutoplayKeeper = {
  /** Try to play now. Safe to call repeatedly. */
  attempt(): void
  /** Mark playback as deliberately stopped (or resumed) by the viewer. */
  setUserPaused(paused: boolean): void
  /** True while the viewer has deliberately paused. */
  isUserPaused(): boolean
  stop(): void
}

export type AutoplayOptions = {
  /** Called when sound had to be dropped to get playback started. */
  onMutedFallback?: () => void
  /** Called when playback is wedged; reload the source / seek to live. */
  onStalled?: () => void
}

export function createAutoplayKeeper(
  media: HTMLMediaElement,
  { onMutedFallback, onStalled }: AutoplayOptions = {},
): AutoplayKeeper {
  let stopped = false
  let userPaused = false
  let retryTimer = 0
  let lastGestureAt = 0
  let lastProgressAt = Date.now()
  let lastTime = -1

  const clearRetry = () => {
    if (retryTimer) {
      window.clearTimeout(retryTimer)
      retryTimer = 0
    }
  }

  const scheduleRetry = () => {
    if (stopped || userPaused || retryTimer) return
    retryTimer = window.setTimeout(() => {
      retryTimer = 0
      attempt()
    }, RETRY_MS)
  }

  const attempt = () => {
    if (stopped || userPaused || !media.paused) return
    const started = media.play()
    if (!started || typeof started.catch !== "function") return
    started.catch(() => {
      if (stopped || userPaused || !media.paused) return
      if (!media.muted) {
        // Autoplay policy blocked sound, not playback: mute and try again so
        // the viewer gets picture immediately rather than a stopped stream.
        media.muted = true
        onMutedFallback?.()
        const retried = media.play()
        if (retried && typeof retried.catch === "function") {
          retried.catch(() => scheduleRetry())
        }
        return
      }
      scheduleRetry()
    })
  }

  const noteGesture = () => {
    lastGestureAt = Date.now()
  }

  const onPlay = () => {
    userPaused = false
    clearRetry()
  }

  const onProgressing = () => {
    lastProgressAt = Date.now()
    lastTime = media.currentTime
    clearRetry()
  }

  const onPause = () => {
    // Only a pause traceable to a recent interaction with the element counts as
    // intentional; otherwise the browser or the stream stopped us, so resume.
    if (Date.now() - lastGestureAt <= USER_GESTURE_WINDOW_MS) {
      userPaused = true
      return
    }
    attempt()
  }

  const onEnded = () => {
    // Live streams should never end — treat it as a dropped connection.
    if (userPaused) return
    onStalled?.()
    attempt()
  }

  const onVisibility = () => {
    if (document.visibilityState === "visible") attempt()
  }

  const watchdog = window.setInterval(() => {
    if (stopped || userPaused) return
    if (media.paused) {
      attempt()
      return
    }
    if (media.currentTime !== lastTime) {
      lastTime = media.currentTime
      lastProgressAt = Date.now()
      return
    }
    if (Date.now() - lastProgressAt >= STALL_TOLERANCE_MS) {
      lastProgressAt = Date.now()
      onStalled?.()
      attempt()
    }
  }, WATCHDOG_MS)

  media.addEventListener("pointerdown", noteGesture)
  media.addEventListener("keydown", noteGesture)
  media.addEventListener("play", onPlay)
  media.addEventListener("playing", onProgressing)
  media.addEventListener("timeupdate", onProgressing)
  media.addEventListener("pause", onPause)
  media.addEventListener("ended", onEnded)
  media.addEventListener("canplay", attempt)
  media.addEventListener("loadedmetadata", attempt)
  media.addEventListener("stalled", attempt)
  media.addEventListener("waiting", attempt)
  media.addEventListener("suspend", attempt)
  document.addEventListener("visibilitychange", onVisibility)

  return {
    attempt,
    setUserPaused(paused: boolean) {
      userPaused = paused
      if (paused) clearRetry()
      else attempt()
    },
    isUserPaused() {
      return userPaused
    },
    stop() {
      stopped = true
      clearRetry()
      window.clearInterval(watchdog)
      media.removeEventListener("pointerdown", noteGesture)
      media.removeEventListener("keydown", noteGesture)
      media.removeEventListener("play", onPlay)
      media.removeEventListener("playing", onProgressing)
      media.removeEventListener("timeupdate", onProgressing)
      media.removeEventListener("pause", onPause)
      media.removeEventListener("ended", onEnded)
      media.removeEventListener("canplay", attempt)
      media.removeEventListener("loadedmetadata", attempt)
      media.removeEventListener("stalled", attempt)
      media.removeEventListener("waiting", attempt)
      media.removeEventListener("suspend", attempt)
      document.removeEventListener("visibilitychange", onVisibility)
    },
  }
}

/** Nudge an HLS live stream back to the live edge after a stall. */
export function seekToLiveEdge(media: HTMLMediaElement) {
  const buffered = media.buffered
  if (!buffered.length) return
  const end = buffered.end(buffered.length - 1)
  if (end - media.currentTime > 1) media.currentTime = end - 0.5
}
