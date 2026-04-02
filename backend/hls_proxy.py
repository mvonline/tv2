"""
Standalone HLS proxy for gg.* hosts (same Origin + Referer as aparatchi.com).

Run: uvicorn hls_proxy:app --host 127.0.0.1 --port 8787

Frontend: VITE_HLS_PROXY_BASE=http://127.0.0.1:8787/proxy/hls
"""

from __future__ import annotations

import re
from urllib.parse import urlparse, urljoin, urlencode

import requests
from fastapi import APIRouter, FastAPI, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware

SESSION = requests.Session()
# Ignore HTTP(S)_PROXY from the environment — a corporate proxy often returns 403 for gg.*.
try:
    SESSION.trust_env = False
except AttributeError:
    pass

UPSTREAM_HEADERS = {
    # Nimble/CDN expects the embedder site (same as a browser on aparatchi.com).
    "Referer": "https://www.aparatchi.com/",
    "Origin": "https://www.aparatchi.com",
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


def allowed_host(hostname: str) -> bool:
    h = hostname.lower()
    return h.startswith("gg.") or h.startswith("www.gg.")


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


router = APIRouter(tags=["hls-proxy"])


@router.get("/proxy/hls")
def proxy_hls(request: Request, url: str = Query(..., description="Upstream HLS or segment URL")):
    try:
        target = urlparse(url)
    except Exception:
        return Response("Invalid url", status_code=400)

    if not allowed_host(target.netloc):
        return Response("Host not allowed", status_code=403)

    proxy_self = proxy_base_url(request)
    # Do not merge with client request headers — only embedder headers to upstream.
    r = SESSION.get(
        url,
        headers=dict(UPSTREAM_HEADERS),
        timeout=60,
        allow_redirects=True,
    )
    ct = r.headers.get("content-type") or ""

    if not r.ok:
        return Response(content=r.content, status_code=r.status_code, media_type=ct or "text/plain")

    lower = url.lower()
    is_m3u8 = (
        ".m3u8" in lower
        or "mpegurl" in ct.lower()
        or "m3u" in ct.lower()
    )

    if is_m3u8:
        text = r.text
        out = rewrite_playlist(text, url, proxy_self)
        return Response(
            content=out,
            media_type="application/vnd.apple.mpegurl",
            headers={
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "no-cache",
            },
        )

    return Response(
        content=r.content,
        media_type=ct or "application/octet-stream",
        headers={
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=30",
        },
    )


# Legacy entrypoint: `uvicorn hls_proxy:app` — HLS proxy only (use `main:app` for categories + admin).
app = FastAPI(title="HLS embedder proxy")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "OPTIONS"],
    allow_headers=["*"],
)
app.include_router(router)
