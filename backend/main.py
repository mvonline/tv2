"""
TV2 backend: HLS proxy + category API + admin UI.

Run: uvicorn main:app --host 0.0.0.0 --port 8787

Env:
  ADMIN_USER / ADMIN_PASSWORD — required for admin API & /admin UI
  CATEGORY_DB_PATH — optional sqlite path (default: backend/data/categories.db)
  ADMIN_SESSION_SECRET — optional HMAC secret for admin_session cookie
  CHANNELS_JSON_URL — optional; HTTP(S) URL to download channels.json at startup
  CHANNELS_JSON_PATH — optional; destination for URL fetch (default: backend/data/channels.json)
  SKIP_CHANNELS_FETCH — set to 1 to skip CHANNELS_JSON_URL download
  LOGOS_BASE_URL — optional origin for channel logos (see GET /api/config); paths stay logo/… in JSON
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from category_routes import admin_router, router as category_public_router, serve_admin_page
from channels_fetch import maybe_fetch_channels_json
from hls_proxy import router as hls_router


@asynccontextmanager
async def lifespan(_app: FastAPI):
    maybe_fetch_channels_json()
    yield


app = FastAPI(title="TV2", description="HLS proxy + categories", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(hls_router)
app.include_router(category_public_router, prefix="/api")
app.include_router(admin_router, prefix="/api")

# Admin HTML — HTTP Basic (same handler at both paths)
app.add_api_route("/admin", serve_admin_page, methods=["GET"])
app.add_api_route("/api/admin", serve_admin_page, methods=["GET"])
