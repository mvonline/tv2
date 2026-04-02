type Props = {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  id?: string
}

export function SearchBar({ value, onChange, placeholder, id }: Props) {
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
        placeholder={placeholder ?? "Search channels…"}
        autoComplete="off"
        spellCheck={false}
      />
    </div>
  )
}
