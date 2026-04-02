import { useCallback, useEffect, useRef, useState } from "react"

const DIGIT_TIMEOUT_MS = 2000

export type TvRemoteHandlers = {
  onDigitBuffer?: (buffer: string) => void
  onGoToChannelNumber?: (indexOneBased: number) => void
  onChannelUp?: () => void
  onChannelDown?: () => void
  digitsDisabled?: boolean
}

export function useTvRemote(handlers: TvRemoteHandlers) {
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

  const clearBuffer = useCallback(() => {
    clearTimer()
    bufferRef.current = ""
    setDigitBuffer("")
    handlersRef.current.onDigitBuffer?.("")
  }, [clearTimer])

  const scheduleClear = useCallback(() => {
    clearTimer()
    timerRef.current = setTimeout(() => {
      bufferRef.current = ""
      setDigitBuffer("")
      handlersRef.current.onDigitBuffer?.("")
    }, DIGIT_TIMEOUT_MS)
  }, [clearTimer])

  const appendDigit = useCallback(
    (d: string) => {
      if (handlersRef.current.digitsDisabled) return
      if (d.length !== 1 || d < "0" || d > "9") return
      const next =
        bufferRef.current.length >= 4 ? d : bufferRef.current + d
      bufferRef.current = next
      setDigitBuffer(next)
      handlersRef.current.onDigitBuffer?.(next)
      scheduleClear()
    },
    [scheduleClear],
  )

  const submitDigits = useCallback(() => {
    if (handlersRef.current.digitsDisabled) return
    if (bufferRef.current.length === 0) return
    const n = parseInt(bufferRef.current, 10)
    clearTimer()
    bufferRef.current = ""
    setDigitBuffer("")
    handlersRef.current.onDigitBuffer?.("")
    if (!Number.isNaN(n) && n >= 1) {
      handlersRef.current.onGoToChannelNumber?.(n)
    }
  }, [clearTimer])

  const backspaceDigit = useCallback(() => {
    if (handlersRef.current.digitsDisabled) return
    if (bufferRef.current.length === 0) return
    const next = bufferRef.current.slice(0, -1)
    bufferRef.current = next
    setDigitBuffer(next)
    handlersRef.current.onDigitBuffer?.(next)
    scheduleClear()
  }, [scheduleClear])

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
        scheduleClear()
        return
      }

      if (e.key === "Enter" && bufferRef.current.length > 0) {
        e.preventDefault()
        const n = parseInt(bufferRef.current, 10)
        clearTimer()
        bufferRef.current = ""
        setDigitBuffer("")
        h.onDigitBuffer?.("")
        if (!Number.isNaN(n) && n >= 1) {
          h.onGoToChannelNumber?.(n)
        }
        return
      }

      if (e.key === "Backspace" && bufferRef.current.length > 0) {
        e.preventDefault()
        const next = bufferRef.current.slice(0, -1)
        bufferRef.current = next
        setDigitBuffer(next)
        h.onDigitBuffer?.(next)
        scheduleClear()
      }
    }

    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [clearBuffer, scheduleClear, clearTimer])

  return {
    digitBuffer,
    resetBuffer: clearBuffer,
    appendDigit,
    submitDigits,
    backspaceDigit,
  }
}
