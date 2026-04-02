import { Check, Delete } from "lucide-react"

type Props = {
  appendDigit: (d: string) => void
  submitDigits: () => void
  backspaceDigit: () => void
  /** e.g. when search box has focus content on home */
  disabled?: boolean
  /** Fixed to viewport (home); absolute inside player column (watch) */
  fixed?: boolean
  className?: string
}

const KEYS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
] as const

export function ChannelNumpad({
  appendDigit,
  submitDigits,
  backspaceDigit,
  disabled = false,
  fixed = false,
  className,
}: Props) {
  return (
    <div
      className={`channel-numpad ${fixed ? "channel-numpad--fixed" : ""} ${disabled ? "channel-numpad--disabled" : ""} ${className ?? ""}`.trim()}
      role="group"
      aria-label="Channel number"
    >
      {KEYS.map((row) => (
        <div key={row.join("")} className="channel-numpad__row">
          {row.map((d) => (
            <button
              key={d}
              type="button"
              className="channel-numpad__key"
              disabled={disabled}
              onClick={() => appendDigit(d)}
              aria-label={`Digit ${d}`}
            >
              {d}
            </button>
          ))}
        </div>
      ))}
      <div className="channel-numpad__row">
        <button
          type="button"
          className="channel-numpad__key channel-numpad__key--icon"
          disabled={disabled}
          onClick={backspaceDigit}
          aria-label="Backspace"
        >
          <Delete size={20} strokeWidth={2} aria-hidden />
        </button>
        <button
          type="button"
          className="channel-numpad__key"
          disabled={disabled}
          onClick={() => appendDigit("0")}
          aria-label="Digit 0"
        >
          0
        </button>
        <button
          type="button"
          className="channel-numpad__key channel-numpad__key--icon channel-numpad__key--go"
          disabled={disabled}
          onClick={submitDigits}
          aria-label="Go to channel"
        >
          <Check size={22} strokeWidth={2.5} aria-hidden />
        </button>
      </div>
    </div>
  )
}
