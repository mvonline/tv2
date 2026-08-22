import re
from urllib.parse import urlparse

BASE_URL = "https://www.aparatchii.com"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
REQUEST_TIMEOUT_S = 30

# Seed pages crawled for channel links (level 1). The homepage lists most channels.
CATEGORY_PATHS = [
    "/",
    "/chanells/iran-live-tv/",
    "/chanells/afghan-live-tv/",
    "/chanells/kurdish-live-tv/",
    "/chanells/arabic-live-tv/",
    "/chanells/azerbaijan-live-tv/",
    "/chanells/turkish-live-tv/",
    "/chanells/indian-live-tv/",
    "/chanells/korean-live-tv/",
    "/chanells/spanish-live-tv/",
    "/chanells/french-live-tv/",
    "/chanells/english-religion-tv/",
    "/news-live-tv",
    "/entertainment-live-tv",
    "/sport-live-tv",
    "/film-live-tv",
    "/series-live-tv",
    "/kids-live-tv",
    "/music-live-tv",
    "/scientific-live-tv",
    "/politics-live-tv",
    "/religion-live-tv",
    "/irib-live-tv",
    "/irib-ostani-live-tv",
    "/iranian-live-radio",
]

# Channel pages are now two segments: /{group}/{slug} (e.g. /farsi-news-tv/voa-persian,
# /irib-live-tv/irib1-live, /iranian-radio/radio-donya, /tajik/varzish-tv).
# The group slug is not predictable, so exclude the site's non-channel sections instead.
_NON_CHANNEL_SEGMENTS = (
    "articles",
    "other-pages",
    "chanells",
    "images",
    "media",
    "templates",
    "modules",
    "component",
    "index.php",
    "api",
    "log-in",
    "create-an-account",
    "lost-password",
    "lost-user-name",
    "contact-us",
    "add-tv-channel",
)
_NON_CHANNEL_LEAVES = ("feed", "rss", "atom")

CHANNEL_PATH_RE = re.compile(
    r"^/(?!(?:" + "|".join(re.escape(x) for x in _NON_CHANNEL_SEGMENTS) + r")/)"
    r"[a-z0-9][a-z0-9-]*/(?!(?:" + "|".join(_NON_CHANNEL_LEAVES) + r")/?$)"
    r"[a-z0-9][a-z0-9-]*/?$",
    re.IGNORECASE,
)

# Category index pages: /sport-live-tv, /irib-live-tv, /chanells/iran-live-tv/
CATEGORY_INDEX_RE = re.compile(
    r"^(?:/chanells)?/(?:[a-z0-9-]+-live-tv|[a-z0-9-]+-live-radio|iranian-live-radio)/?$",
    re.IGNORECASE,
)

# Hosts that must go through the HLS proxy (CORS-blocked or geo/ISP-blocked in EU).
_PROXY_HOSTS = (
    ".hls2.xyz",    # aparatchii CDN — blocks off-site Origin/Referer
    ".presstv.ir",  # iFilm / PressTV — DNS-blocked by many EU ISPs (live*, live4*, etc.)
    ".telewebion.ir",
)

def stream_requires_proxy(url: str | None) -> bool:
    if not url:
        return False
    host = urlparse(url).netloc.lower()
    return any(host == h or host.endswith("." + h) if not h.startswith(".") else host.endswith(h) for h in _PROXY_HOSTS)
