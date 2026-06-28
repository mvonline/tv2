"""
TV2 backend: HLS proxy + category API + admin UI.

Run: uvicorn main:app --host 0.0.0.0 --port 8787

Env:
  ADMIN_USER / ADMIN_PASSWORD — required for admin API & /admin UI
  CATEGORY_DB_PATH — optional sqlite path (default: backend/data/categories.db)
  ANALYTICS_DB_PATH — optional sqlite path (default: backend/data/analytics.db)
  ANALYTICS_RETENTION_DAYS — delete analytics rows older than N days (default: 90)
  ADMIN_SESSION_SECRET — optional HMAC secret for admin_session cookie
  CHANNELS_JSON_URL — optional; HTTP(S) URL to download channels.json at startup
  CHANNELS_JSON_PATH — optional; destination for URL fetch (default: backend/data/channels.json)
  SKIP_CHANNELS_FETCH — set to 1 to skip CHANNELS_JSON_URL download
  LOGOS_BASE_URL — optional prefix URL for relative channel.logo paths (see GET /api/config)
  CORS_ORIGINS — comma-separated allowed browser origins, or * (default). Empty env falls back to *.
"""

from __future__ import annotations

import asyncio
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import analytics_db
import epg_db
from analytics_routes import admin_router as analytics_admin_router
from analytics_routes import router as analytics_router
from category_routes import admin_router, router as category_public_router, serve_admin_page
from channels_fetch import maybe_fetch_channels_json
from epg_routes import admin_router as epg_admin_router
from epg_routes import refresh_all_configured_sources
from epg_routes import router as epg_router
from hls_proxy import router as hls_router
from scraper_routes import router as scraper_router


def _cors_allow_origins() -> list[str]:
    raw = os.environ.get("CORS_ORIGINS", "*").strip()
    if not raw or raw == "*":
        return ["*"]
    return [o.strip() for o in raw.split(",") if o.strip()]


async def _analytics_cleanup_loop(retention_days: int) -> None:
    """Purge rows older than retention_days once every 24 hours."""
    while True:
        cutoff = int(time.time()) - retention_days * 86400
        analytics_db.purge_old_views(cutoff)
        await asyncio.sleep(86400)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    analytics_db.init_db()
    epg_db.init_db()
    maybe_fetch_channels_json()
    if os.environ.get("EPG_REFRESH_ON_STARTUP", "0").strip() == "1":
        try:
            refresh_all_configured_sources()
        except Exception as exc:
            print(f"EPG startup refresh failed: {exc}", flush=True)
    retention_days = max(1, int(os.environ.get("ANALYTICS_RETENTION_DAYS", "90")))
    cleanup_task = asyncio.create_task(_analytics_cleanup_loop(retention_days))
    try:
        yield
    finally:
        cleanup_task.cancel()
        try:
            await cleanup_task
        except asyncio.CancelledError:
            pass


app = FastAPI(title="TV2", description="HLS proxy + categories", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_allow_origins(),
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(hls_router)
app.include_router(category_public_router, prefix="/api")
app.include_router(admin_router, prefix="/api")
app.include_router(analytics_router, prefix="/api")
app.include_router(analytics_admin_router, prefix="/api")
app.include_router(epg_router, prefix="/api")
app.include_router(epg_admin_router, prefix="/api")
app.include_router(scraper_router, prefix="/api")

# Admin HTML — HTTP Basic (same handler at both paths)
app.add_api_route("/admin", serve_admin_page, methods=["GET"])
app.add_api_route("/api/admin", serve_admin_page, methods=["GET"])
