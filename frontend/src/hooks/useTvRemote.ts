import { useCallback, useEffect, useRef, useState } from "react"

/** After this many ms without a new digit, buffer is submitted like pressing Enter. */
export const DIGIT_AUTO_SUBMIT_AFTER_MS = 2000

export type TvRemoteHandlers = {
  onDigitBuffer?: (buffer: string) => void
  onGoToChannelNumber?: (indexOneBased: number) => void
  onChannelUp?: () => void
  onChannelDown?: () => void
  digitsDisabled?: boolean
}

export function useTvRemote(handlers: TvRemoteHandlers) {
  const digitsDisabled = handlers.digitsDisabled ?? false
  const [digitBuffer, setDigitBuffer] = useState("")
  const bufferRef = useRef("")
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const flushDigitsAsChannel = useCallback(() => {
    if (handlersRef.current.digitsDisabled) return
    if (bufferRef.current.length === 0) return
    const n = parseInt(bufferRef.current, 10)
    bufferRef.current = ""
    setDigitBuffer("")
    handlersRef.current.onDigitBuffer?.("")
    if (!Number.isNaN(n) && n >= 1) {
      handlersRef.current.onGoToChannelNumber?.(n)
    }
  }, [])

  const clearBuffer = useCallback(() => {
    clearTimer()
    bufferRef.current = ""
    setDigitBuffer("")
    handlersRef.current.onDigitBuffer?.("")
  }, [clearTimer])

  const scheduleAutoSubmit = useCallback(() => {
    clearTimer()
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      flushDigitsAsChannel()
    }, DIGIT_AUTO_SUBMIT_AFTER_MS)
  }, [clearTimer, flushDigitsAsChannel])

  useEffect(() => {
    if (digitsDisabled) clearTimer()
  }, [digitsDisabled, clearTimer])

  const appendDigit = useCallback(
    (d: string) => {
      if (handlersRef.current.digitsDisabled) return
      if (d.length !== 1 || d < "0" || d > "9") return
      const next =
        bufferRef.current.length >= 4 ? d : bufferRef.current + d
      bufferRef.current = next
      setDigitBuffer(next)
      handlersRef.current.onDigitBuffer?.(next)
      scheduleAutoSubmit()
    },
    [scheduleAutoSubmit],
  )

  const submitDigits = useCallback(() => {
    clearTimer()
    flushDigitsAsChannel()
  }, [clearTimer, flushDigitsAsChannel])

  const backspaceDigit = useCallback(() => {
    if (handlersRef.current.digitsDisabled) return
    if (bufferRef.current.length === 0) return
    const next = bufferRef.current.slice(0, -1)
    bufferRef.current = next
    setDigitBuffer(next)
    handlersRef.current.onDigitBuffer?.(next)
    if (next.length === 0) clearTimer()
    else scheduleAutoSubmit()
  }, [scheduleAutoSubmit, clearTimer])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (
        t &&
        (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
      ) {
        return
      }

      const h = handlersRef.current

      if (e.key === "ArrowUp" || e.key === "PageUp") {
        e.preventDefault()
        h.onChannelUp?.()
        clearBuffer()
        return
      }
      if (e.key === "ArrowDown" || e.key === "PageDown") {
        e.preventDefault()
        h.onChannelDown?.()
        clearBuffer()
        return
      }

      if (h.digitsDisabled) return

      if (e.key >= "0" && e.key <= "9") {
        e.preventDefault()
        const next =
          bufferRef.current.length >= 4 ? e.key : bufferRef.current + e.key
        bufferRef.current = next
        setDigitBuffer(next)
        h.onDigitBuffer?.(next)
        scheduleAutoSubmit()
        return
      }

      if (e.key === "Enter" && bufferRef.current.length > 0) {
        e.preventDefault()
        clearTimer()
        flushDigitsAsChannel()
        return
      }

      if (e.key === "Backspace" && bufferRef.current.length > 0) {
        e.preventDefault()
        const next = bufferRef.current.slice(0, -1)
        bufferRef.current = next
        setDigitBuffer(next)
        h.onDigitBuffer?.(next)
        if (next.length === 0) clearTimer()
        else scheduleAutoSubmit()
      }
    }

    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [
    clearBuffer,
    scheduleAutoSubmit,
    clearTimer,
    flushDigitsAsChannel,
  ])

  return {
    digitBuffer,
    resetBuffer: clearBuffer,
    appendDigit,
    submitDigits,
    backspaceDigit,
  }
}
