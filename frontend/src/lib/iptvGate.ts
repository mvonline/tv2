/**
 * Gate for iptv-org channels.
 *
 * Set VITE_IPTV_KEY at build time.  A visitor must provide ?iptv=<key> in the
 * URL to unlock iptv-org channels.  The unlocked state is kept in sessionStorage
 * so it survives in-app navigation but clears when the tab is closed.
 *
 * If VITE_IPTV_KEY is not configured, iptv channels are always hidden.
 */

const STORAGE_KEY = "tv2_iptv_unlocked"
const PARAM = "iptv"
const EXPECTED = (import.meta.env.VITE_IPTV_KEY ?? "").trim()

function persist(): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, "1")
  } catch {
    // sessionStorage unavailable (e.g. private mode with restrictions) — ignore
  }
}

function wasUnlocked(): boolean {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === "1"
  } catch {
    return false
  }
}

/**
 * Call once on app init.  Checks the URL param, writes sessionStorage if valid.
 * Returns true if iptv-org channels should be shown this session.
 */
export function resolveIptvGate(): boolean {
  if (!EXPECTED) return false
  if (wasUnlocked()) return true
  const params = new URLSearchParams(window.location.search)
  if (params.get(PARAM) === EXPECTED) {
    persist()
    return true
  }
  return false
}
