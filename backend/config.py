import re
from urllib.parse import urlparse

BASE_URL = "https://www.aparatchi.com"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
REQUEST_TIMEOUT_S = 30

# Seed category paths (level 1). Extend or replace after inspecting the homepage menu.
CATEGORY_PATHS = [
    "/iran-live-tv",
    "/afghan-live-tv",
    "/kurdish-live-tv",
    "/english-live-tv",
    "/arabic-live-tv",
    "/korean-live-tv",
    "/turkish-live-tv",
    "/indian-live-tv",
    "/spanish-live-tv",
    "/french-live-tv",
    "/azerbaijan-live-tv",
    "/news-live-tv",
    "/entertainment-live-tv",
    "/sport-live-tv",
    "/film-live-tv",
    "/series-live-tv",
    "/kids-live-tv",
    "/music-live-tv",
    "/scientific-live-tv",
    "/irib-live-tv",
    "/irib-ostani-live-tv",
    "/politics-live-tv",
    "/iranian-live-radio",
    "/religion-live-tv",
]

# Channel pages: /{region}-live-tv/{group}/{slug} or /iranian-live-radio/{group}/{slug}
CHANNEL_PATH_RE = re.compile(
    r"^/(?:[a-z0-9]+-live-tv|iranian-live-radio)/[a-z0-9-]+/[a-z0-9-]+/?$",
    re.IGNORECASE,
)

# Top-level category index pages (single path segment), e.g. /sport-live-tv, /iranian-live-radio
CATEGORY_INDEX_RE = re.compile(
    r"^/(?:[a-z0-9-]+-live-tv|iranian-live-radio)/?$",
    re.IGNORECASE,
)

# Hosts that must go through the HLS proxy (CORS-blocked or geo/ISP-blocked in EU).
_PROXY_HOSTS = (
    ".hls2.xyz",    # aparatchi CDN — blocks off-site Origin/Referer
    ".presstv.ir",  # iFilm / PressTV — DNS-blocked by many EU ISPs (live*, live4*, etc.)
)

def stream_requires_proxy(url: str | None) -> bool:
    if not url:
        return False
    host = urlparse(url).netloc.lower()
    return any(host == h or host.endswith("." + h) if not h.startswith(".") else host.endswith(h) for h in _PROXY_HOSTS)
