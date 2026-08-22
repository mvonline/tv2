"""
Standalone HLS proxy for gg.* hosts (same Origin + Referer as aparatchii.com).

Run: uvicorn hls_proxy:app --host 127.0.0.1 --port 8787

Frontend: VITE_HLS_PROXY_BASE=http://127.0.0.1:8787/proxy/hls

Latency notes (measured against gg.hls2.xyz):
  * A cold TLS connection costs 170-2800 ms; a pooled one ~100 ms. Connection
    reuse is by far the biggest win, so one long-lived AsyncClient is shared.
  * Startup is serial: master playlist -> media playlist -> first segment.
    Segments are ~4 MB at TARGETDURATION 10, so the live-edge segment is
    prefetched while the client is still parsing the playlist it was named in.
  * Media playlists are re-requested by every viewer every ~10 s and are
    identical between them, so they get a sub-target-duration micro-cache with
    single-flight coalescing. Segments are immutable and get an LRU cache.
"""

from __future__ import annotations

import asyncio
import re
import time
from collections import OrderedDict
from contextlib import asynccontextmanager
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse

import httpx
from fastapi import APIRouter, FastAPI, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

# Segments are streamed in 64 KB chunks — large enough to reduce syscall overhead,
# small enough that the browser starts receiving data well before the full segment arrives.
SEGMENT_CHUNK = 64 * 1024

# Keep sockets to the CDN warm well past one segment interval (TARGETDURATION is
# 10 s upstream) so a steady viewer never pays for a new TLS handshake.
_LIMITS = httpx.Limits(
    max_connections=100,
    max_keepalive_connections=40,
    keepalive_expiry=120.0,
)
# Split timeouts: a dead host must fail fast on connect instead of occupying the
# request for the old flat 60 s.
_TIMEOUT = httpx.Timeout(connect=5.0, read=20.0, write=10.0, pool=5.0)

# Media playlists change once per target duration; anything below that is safe to
# reuse and collapses N concurrent viewers of one channel into one upstream fetch.
MANIFEST_TTL_S = 1.5
# Past that, keep serving the old body while refreshing behind the request, so a
# viewer never waits on an upstream round trip for a playlist. Well under the
# upstream TARGETDURATION of 10 s.
MANIFEST_STALE_S = 5.0
# Segments are immutable, so they only leave the cache by age or LRU pressure.
SEGMENT_TTL_S = 60.0
SEGMENT_MAX_BYTES = 8 * 1024 * 1024
SEGMENT_CACHE_MAX_BYTES = 192 * 1024 * 1024
# hls.js starts at the live edge and buffers liveSyncDurationCount segments, so
# warming only the last one still left the second fetch paying full latency.
PREFETCH_SEGMENTS = 2
# Keep a warm TLS socket (and warm playlist) for recently watched channels: a
# cold handshake to the CDN measured 170-2800 ms versus ~100 ms pooled.
WARM_INTERVAL_S = 45.0
WARM_IDLE_EVICT_S = 300.0
WARM_MAX_CHANNELS = 8

# Nimble mints a fresh ?nimblesessionid= on every master-playlist fetch and
# embeds it in every media-playlist and segment URL. The bytes behind those URLs
# are identical between sessions (verified: one segment, two session ids, same
# sha256), so caching on the raw URL meant a key that was unique per viewer per
# reload — the cache almost never hit for anyone but the viewer who filled it.
# Cache keys therefore drop these params, while upstream still gets the original
# URL because segments 404 without a session id.
_VOLATILE_QUERY_PARAMS = frozenset({"nimblesessionid"})


def _strip_volatile_query(url: str) -> str:
    parsed = urlparse(url)
    if not parsed.query:
        return url
    kept = [(k, v) for k, v in parse_qsl(parsed.query, keep_blank_values=True)
            if k.lower() not in _VOLATILE_QUERY_PARAMS]
    return urlunparse(parsed._replace(query=urlencode(kept)))


def cache_key(url: str) -> str:
    """Session-independent identity of an upstream resource."""
    return _strip_volatile_query(url)


UPSTREAM_HEADERS = {
    # Nimble/CDN expects the embedder site (same as a browser on aparatchii.com).
    "Referer": "https://www.aparatchii.com/",
    "Origin": "https://www.aparatchii.com",
    "Accept": "*/*",
    "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Sec-Fetch-Site": "cross-site",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
    "DNT": "1",
}


TELEWEBION_HEADERS = {
    **UPSTREAM_HEADERS,
    "Referer": "https://www.telewebion.com/",
    "Origin": "https://www.telewebion.com",
}


_ALLOWED_SUFFIXES = (".hls2.xyz", ".presstv.ir", ".telewebion.ir")

# Upstream said the resource is simply not there — retrying cannot help, so the
# client is told once and left alone.
_PERMANENT_STATUSES = frozenset({400, 401, 403, 404, 410, 451})


def allowed_host(hostname: str) -> bool:
    h = hostname.lower()
    return any(h == s or h.endswith("." + s) if not s.startswith(".") else h.endswith(s) for s in _ALLOWED_SUFFIXES)


def upstream_headers(hostname: str) -> dict[str, str]:
    h = hostname.lower()
    if h == "telewebion.ir" or h.endswith(".telewebion.ir"):
        return dict(TELEWEBION_HEADERS)
    return dict(UPSTREAM_HEADERS)


# ── Shared upstream client ────────────────────────────────────────────────────

_client: httpx.AsyncClient | None = None
_client_lock = asyncio.Lock()


async def get_client() -> httpx.AsyncClient:
    """One pooled client per process. Created lazily so import stays cheap."""
    global _client
    if _client is not None and not _client.is_closed:
        return _client
    async with _client_lock:
        if _client is None or _client.is_closed:
            _client = httpx.AsyncClient(
                limits=_LIMITS,
                timeout=_TIMEOUT,
                follow_redirects=True,
                # Ignore HTTP(S)_PROXY from the environment — a corporate proxy
                # often returns 403 for gg.*.
                trust_env=False,
                http2=True,
            )
    return _client


async def aclose_client() -> None:
    global _client
    if _client is not None and not _client.is_closed:
        await _client.aclose()
    _client = None


# ── Caches ───────────────────────────────────────────────────────────────────

# url -> (expires_at, content type, body); ordered oldest-first for LRU eviction
_segment_cache: "OrderedDict[str, tuple[float, str, bytes]]" = OrderedDict()
_segment_cache_bytes = 0
_segment_prefetching: set[str] = set()

# Only the *upstream* body is cached: rewriting is a few regexes over ~250 bytes,
# so it is cheaper to redo per request than to key the cache by proxy origin too.
# key -> (fresh_until, stale_until, body, resolved url)
_manifest_cache: dict[str, tuple[float, float, str, str]] = {}
# key -> in-flight fetch shared by every concurrent requester of that playlist
_manifest_inflight: dict[str, asyncio.Task[tuple[str, str]]] = {}


def _manifest_cached(key: str) -> tuple[str, str, bool] | None:
    """Returns (body, resolved url, is_fresh) or None. A stale body is worth
    serving while a refresh runs behind it — the alternative is a viewer waiting
    on an upstream round trip for a 250-byte playlist."""
    hit = _manifest_cache.get(key)
    if hit is None:
        return None
    fresh_until, stale_until, body, resolved = hit
    now = time.monotonic()
    if now <= fresh_until:
        return body, resolved, True
    if now <= stale_until:
        return body, resolved, False
    _manifest_cache.pop(key, None)
    return None


def _manifest_store(url: str, body: str, resolved: str) -> None:
    now = time.monotonic()
    _manifest_cache[cache_key(url)] = (
        now + MANIFEST_TTL_S,
        now + MANIFEST_STALE_S,
        body,
        resolved,
    )
    if len(_manifest_cache) > 512:
        for k, (_f, stale_until, _b, _r) in list(_manifest_cache.items()):
            if stale_until < now:
                _manifest_cache.pop(k, None)


def _invalidate_manifests_for(segment_url: str) -> None:
    """
    A segment 404 usually means the session id baked into the playlist we served
    has aged out. Drop the playlists for that directory so the next request
    re-fetches and mints a fresh one instead of serving the same dead URLs.
    """
    prefix = cache_key(segment_url).rsplit("/", 1)[0]
    for key in [k for k in _manifest_cache if k.startswith(prefix)]:
        _manifest_cache.pop(key, None)


async def _fetch_upstream_manifest(url: str) -> tuple[str, str]:
    """
    Fetch a playlist and cache it. Session params are dropped on the way out:
    `chunks.m3u8` serves fine without one (verified), so every viewer shares a
    single canonical fetch instead of minting a private session each.
    """
    client = await get_client()
    r = await client.get(
        _strip_volatile_query(url),
        headers=upstream_headers(urlparse(url).netloc),
    )
    r.raise_for_status()
    body = r.text
    resolved = str(r.url) or url
    _manifest_store(url, body, resolved)
    return body, resolved


def _segment_cached(url: str) -> tuple[str, bytes] | None:
    url = cache_key(url)
    hit = _segment_cache.get(url)
    if hit is None:
        return None
    expires, ctype, body = hit
    if expires < time.monotonic():
        _segment_drop(url)
        return None
    _segment_cache.move_to_end(url)
    return ctype, body


def _segment_drop(url: str) -> None:
    global _segment_cache_bytes
    hit = _segment_cache.pop(cache_key(url), None)
    if hit is not None:
        _segment_cache_bytes -= len(hit[2])


def _segment_store(url: str, ctype: str, body: bytes) -> None:
    global _segment_cache_bytes
    if len(body) > SEGMENT_MAX_BYTES:
        return
    _segment_drop(url)
    _segment_cache[cache_key(url)] = (time.monotonic() + SEGMENT_TTL_S, ctype, body)
    _segment_cache_bytes += len(body)
    while _segment_cache_bytes > SEGMENT_CACHE_MAX_BYTES and _segment_cache:
        oldest = next(iter(_segment_cache))
        _segment_drop(oldest)


# ── Playlist rewriting ───────────────────────────────────────────────────────

def proxy_base_url(request: Request) -> str:
    """Public URL of this proxy endpoint (for m3u8 rewrite). Must match the browser origin."""
    u = request.url
    path = u.path
    if not path.endswith("/proxy/hls"):
        path = "/proxy/hls"
    # Behind nginx/docker: Host may be wrong if only $host was forwarded (port stripped).
    forwarded_host = (request.headers.get("x-forwarded-host") or "").strip()
    host_header = (request.headers.get("host") or "").strip()
    netloc = forwarded_host or host_header or u.netloc
    scheme = (request.headers.get("x-forwarded-proto") or "").strip() or u.scheme
    return f"{scheme}://{netloc}{path}"


def rewrite_line(line: str, playlist_base: str, proxy_self: str) -> str:
    trimmed = line.strip()
    if not trimmed:
        return line

    m = re.search(r'URI="([^"]+)"', trimmed)
    if m:
        inner = m.group(1)
        try:
            abs_u = urljoin(playlist_base, inner)
            p = urlparse(abs_u)
            if allowed_host(p.netloc):
                prox = f'{proxy_self}?{urlencode({"url": abs_u})}'
                return trimmed.replace(m.group(0), f'URI="{prox}"')
        except Exception:
            pass

    if trimmed.startswith("#"):
        return line

    try:
        abs_u = urljoin(playlist_base, trimmed)
        p = urlparse(abs_u)
        if allowed_host(p.netloc):
            return f'{proxy_self}?{urlencode({"url": abs_u})}'
    except Exception:
        pass

    return line


def rewrite_playlist(body: str, playlist_url: str, proxy_self: str) -> str:
    lines = []
    for line in body.splitlines():
        lines.append(rewrite_line(line, playlist_url, proxy_self))
    return "\n".join(lines)


def segment_urls(body: str, playlist_url: str) -> list[str]:
    """Absolute, proxyable media URLs listed in a playlist, in playlist order."""
    out: list[str] = []
    for line in body.splitlines():
        trimmed = line.strip()
        if not trimmed or trimmed.startswith("#"):
            continue
        try:
            abs_u = urljoin(playlist_url, trimmed)
        except Exception:
            continue
        if allowed_host(urlparse(abs_u).netloc):
            out.append(abs_u)
    return out


# ── Prefetch ─────────────────────────────────────────────────────────────────

_prefetch_tasks: set[asyncio.Task] = set()


async def _prefetch_segment(url: str, key: str) -> None:
    """Warm the cache for a segment the client is about to ask for."""
    try:
        client = await get_client()
        r = await client.get(url, headers=upstream_headers(urlparse(url).netloc))
        if r.status_code == 200 and len(r.content) <= SEGMENT_MAX_BYTES:
            ctype = r.headers.get("content-type") or "application/octet-stream"
            _segment_store(url, ctype, r.content)
    except Exception:
        pass  # Prefetch is best-effort; the real request will fetch it.
    finally:
        _segment_prefetching.discard(key)


def schedule_live_edge_prefetch(body: str, playlist_url: str) -> None:
    """
    After serving a media playlist, start fetching the segments the player will
    ask for next. hls.js begins at the live edge and buffers
    `liveSyncDurationCount` segments, so warm that many from the end.
    """
    urls = segment_urls(body, playlist_url)
    if not urls:
        return
    if ".m3u" in urls[-1].lower():
        # Master playlist: entries are playlists. Fetching the variant now turns
        # the player's next request — an unavoidable extra round trip before any
        # media arrives — into a cache hit.
        _spawn(_prefetch_manifest(urls[-1]))
        return
    for target in urls[-PREFETCH_SEGMENTS:]:
        key = cache_key(target)
        if key in _segment_prefetching or _segment_cached(target) is not None:
            continue
        _segment_prefetching.add(key)
        _spawn(_prefetch_segment(target, key))


async def _prefetch_manifest(url: str) -> None:
    """Warm a variant playlist named by a master playlist, and its live edge."""
    if _manifest_cached(cache_key(url)) is not None:
        return
    try:
        body, resolved = await _fetch_upstream_manifest(url)
    except Exception:
        return  # Best effort; the player's own request will fetch it.
    schedule_live_edge_prefetch(body, resolved)


def _spawn(coro) -> None:
    """Run a background task, holding a reference so it is not GC'd mid-flight."""
    task = asyncio.create_task(coro)
    _prefetch_tasks.add(task)
    task.add_done_callback(_prefetch_tasks.discard)


# ── Keeping recently watched channels warm ───────────────────────────────────

# master playlist url -> last time a viewer asked for it
_warm_targets: "OrderedDict[str, float]" = OrderedDict()
_warm_task: asyncio.Task | None = None


def note_warm_target(url: str) -> None:
    """Remember a playlist so its TLS connection and body stay warm."""
    key = cache_key(url)
    _warm_targets[key] = time.monotonic()
    _warm_targets.move_to_end(key)
    while len(_warm_targets) > WARM_MAX_CHANNELS:
        _warm_targets.popitem(last=False)
    _ensure_warm_loop()


def _ensure_warm_loop() -> None:
    global _warm_task
    if _warm_task is not None and not _warm_task.done():
        return
    _warm_task = asyncio.create_task(_warm_loop())


async def _warm_loop() -> None:
    """
    Re-fetch recently watched playlists periodically. Playlists are ~250 bytes,
    so this is cheap, and it keeps both the TLS connection and the manifest cache
    warm — the difference between a click that plays and one that waits.
    """
    while True:
        await asyncio.sleep(WARM_INTERVAL_S)
        now = time.monotonic()
        for url, last_seen in list(_warm_targets.items()):
            if now - last_seen > WARM_IDLE_EVICT_S:
                _warm_targets.pop(url, None)
                continue
            try:
                body, resolved = await _fetch_upstream_manifest(url)
            except Exception:
                continue
            schedule_live_edge_prefetch(body, resolved)
        if not _warm_targets:
            return


# ── Routes ───────────────────────────────────────────────────────────────────

router = APIRouter(tags=["hls-proxy"])

_MANIFEST_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-cache",
}
_SEGMENT_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=30",
}


async def _manifest_response(url: str, proxy_self: str) -> Response:
    key = cache_key(url)
    hit = _manifest_cached(key)

    if hit is not None:
        body, resolved, fresh = hit
        if not fresh:
            # Serve now, refresh behind the response.
            if key not in _manifest_inflight:
                _spawn(_refresh_manifest(url))
        return Response(
            content=rewrite_playlist(body, resolved, proxy_self),
            media_type="application/vnd.apple.mpegurl",
            headers=_MANIFEST_HEADERS,
        )

    # Single-flight: concurrent viewers of one channel share one upstream fetch.
    task = _manifest_inflight.get(key)
    if task is None:
        task = asyncio.create_task(_fetch_upstream_manifest(url))
        _manifest_inflight[key] = task
        task.add_done_callback(lambda _t, k=key: _manifest_inflight.pop(k, None))
    try:
        body, resolved = await asyncio.shield(task)
    except httpx.HTTPStatusError as exc:
        return _upstream_error(exc.response.status_code)
    except httpx.HTTPError:
        return Response("Upstream unreachable", status_code=504, media_type="text/plain")

    schedule_live_edge_prefetch(body, resolved)
    return Response(
        content=rewrite_playlist(body, resolved, proxy_self),
        media_type="application/vnd.apple.mpegurl",
        headers=_MANIFEST_HEADERS,
    )


async def _refresh_manifest(url: str) -> None:
    key = cache_key(url)
    if key in _manifest_inflight:
        return
    task = asyncio.create_task(_fetch_upstream_manifest(url))
    _manifest_inflight[key] = task
    task.add_done_callback(lambda _t, k=key: _manifest_inflight.pop(k, None))
    try:
        body, resolved = await task
    except Exception:
        return
    schedule_live_edge_prefetch(body, resolved)


@router.get("/proxy/hls")
async def proxy_hls(request: Request, url: str = Query(..., description="Upstream HLS or segment URL")):
    try:
        target = urlparse(url)
    except Exception:
        return Response("Invalid url", status_code=400)

    if not allowed_host(target.netloc):
        return Response("Host not allowed", status_code=403)

    lower = url.lower()
    looks_like_manifest = ".m3u8" in lower or ".m3u" in lower

    # Segment cache hit: no upstream round trip at all.
    if not looks_like_manifest:
        cached = _segment_cached(url)
        if cached is not None:
            ctype, body = cached
            return Response(content=body, media_type=ctype, headers=_SEGMENT_HEADERS)

    proxy_self = proxy_base_url(request)

    if looks_like_manifest:
        note_warm_target(url)
        return await _manifest_response(url, proxy_self)

    # Segments (.ts, AAC, etc.): stream in fixed-size chunks so the browser starts
    # receiving data before the full segment has been fetched from upstream, while
    # accumulating a copy so the next viewer is served from memory.
    client = await get_client()
    req = client.build_request("GET", url, headers=upstream_headers(target.netloc))
    try:
        r = await client.send(req, stream=True)
    except httpx.HTTPError:
        return Response("Upstream unreachable", status_code=504, media_type="text/plain")

    if r.status_code != 200:
        status = r.status_code
        await r.aclose()
        if status in _PERMANENT_STATUSES:
            _invalidate_manifests_for(url)
        return _upstream_error(status)

    ctype = r.headers.get("content-type") or "application/octet-stream"

    async def _stream():
        chunks: list[bytes] = []
        total = 0
        cacheable = True
        try:
            async for chunk in r.aiter_bytes(SEGMENT_CHUNK):
                if cacheable:
                    total += len(chunk)
                    if total > SEGMENT_MAX_BYTES:
                        cacheable = False
                        chunks.clear()
                    else:
                        chunks.append(chunk)
                yield chunk
        except (httpx.HTTPError, asyncio.CancelledError):
            cacheable = False  # Partial body must never be cached.
            raise
        else:
            if cacheable and chunks:
                _segment_store(url, ctype, b"".join(chunks))
        finally:
            await r.aclose()

    return StreamingResponse(_stream(), media_type=ctype, headers=_SEGMENT_HEADERS)


def _upstream_error(status: int) -> Response:
    """
    Relay the upstream status with a short plain-text body. Upstream 404 pages are
    HTML, which only produces confusing parse errors in the player.
    """
    if status in _PERMANENT_STATUSES:
        detail = "Channel unavailable upstream"
    else:
        detail = "Upstream error"
    return Response(f"{detail} ({status})", status_code=status, media_type="text/plain")


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    yield
    await aclose_client()


# Legacy entrypoint: `uvicorn hls_proxy:app` — HLS proxy only (use `main:app` for categories + admin).
app = FastAPI(title="HLS embedder proxy", lifespan=_lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "OPTIONS"],
    allow_headers=["*"],
)
app.include_router(router)
