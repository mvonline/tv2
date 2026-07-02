import type { KeyboardEvent } from "react"

type Props = {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  id?: string
  onFocus?: () => void
  onBlur?: () => void
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void
}

export function SearchBar({
  value,
  onChange,
  placeholder,
  id,
  onFocus,
  onBlur,
  onKeyDown,
}: Props) {
  return (
    <div className="search-wrap">
      <label className="sr-only" htmlFor={id ?? "channel-search"}>
        Search channels
      </label>
      <input
        id={id ?? "channel-search"}
        className="search-input"
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        placeholder={placeholder ?? "Search channels…"}
        autoComplete="off"
        spellCheck={false}
      />
    </div>
  )
}
