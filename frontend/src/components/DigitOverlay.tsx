type Props = {
  buffer: string
  hint?: string
}

export function DigitOverlay({ buffer, hint }: Props) {
  if (!buffer) return null
  return (
    <div className="digit-overlay" role="status" aria-live="polite">
      <span className="digit-overlay__nums">{buffer}</span>
      {hint && <span className="digit-overlay__hint">{hint}</span>}
    </div>
  )
}
