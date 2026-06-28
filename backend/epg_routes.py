"""EPG API: public schedule reads and admin XMLTV mapping/refresh."""

from __future__ import annotations

import os
import time
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

import epg_db
from category_routes import require_admin
from epg_fetch import fetch_xmltv, parse_xmltv

router = APIRouter(tags=["epg"])
admin_router = APIRouter(tags=["epg-admin"])


def default_epg_url() -> str | None:
    raw = os.environ.get("EPG_XMLTV_URL", "").strip()
    return raw or None


class EpgMappingPayload(BaseModel):
    epg_id: str = Field(..., min_length=1, max_length=256)
    epg_url: str | None = None


def refresh_epg_source(epg_url: str, keep_ids: set[str] | None = None) -> dict:
    body = fetch_xmltv(epg_url)
    programmes = parse_xmltv(body, keep_ids=keep_ids)
    with epg_db.connect() as conn:
        saved = epg_db.replace_programmes(conn, epg_url, programmes)
    return {"ok": True, "epg_url": epg_url, "programmes": saved}


def refresh_all_configured_sources() -> dict:
    with epg_db.connect() as conn:
        mappings = epg_db.list_mappings(conn)
    source_to_ids: dict[str, set[str]] = {}
    env_url = default_epg_url()
    for m in mappings:
        url = m.get("epg_url") or env_url
        if not url:
            continue
        source_to_ids.setdefault(url, set()).add(m["epg_id"])
    refreshed = []
    for url, ids in source_to_ids.items():
        refreshed.append(refresh_epg_source(url, keep_ids=ids))
    return {"ok": True, "sources": refreshed}


@router.get("/epg/channels")
def list_epg_channels() -> list[dict]:
    epg_db.init_db()
    with epg_db.connect() as conn:
        return epg_db.list_mappings(conn)


@router.get("/epg/{channel_slug}")
def get_channel_epg(
    channel_slug: str,
    from_ts: int = Query(default=0, alias="from"),
    to_ts: int = Query(default=0, alias="to"),
) -> dict:
    epg_db.init_db()
    now = int(time.time())
    if from_ts <= 0:
        from_ts = now - 3600
    if to_ts <= 0:
        to_ts = now + 24 * 3600
    with epg_db.connect() as conn:
        mapping = epg_db.get_mapping(conn, channel_slug)
        if not mapping:
            raise HTTPException(status_code=404, detail="No EPG mapping for channel")
        programmes = epg_db.list_programmes(conn, mapping["epg_id"], from_ts, to_ts)
    return {"channel_slug": channel_slug, "mapping": mapping, "programmes": programmes}


@router.get("/epg/{channel_slug}/now")
def get_channel_epg_now(channel_slug: str) -> dict:
    epg_db.init_db()
    now = int(time.time())
    with epg_db.connect() as conn:
        mapping = epg_db.get_mapping(conn, channel_slug)
        if not mapping:
            raise HTTPException(status_code=404, detail="No EPG mapping for channel")
        current = epg_db.now_programme(conn, mapping["epg_id"], now)
        upcoming = epg_db.list_programmes(conn, mapping["epg_id"], now, now + 12 * 3600)[:5]
    return {
        "channel_slug": channel_slug,
        "mapping": mapping,
        "now": current,
        "upcoming": upcoming,
        "at": now,
    }


@admin_router.get("/admin/epg/mappings")
def admin_list_epg_mappings(_: Annotated[None, Depends(require_admin)]) -> list[dict]:
    epg_db.init_db()
    with epg_db.connect() as conn:
        return epg_db.list_mappings(conn)


@admin_router.put("/admin/channels/{channel_slug}/epg")
def admin_set_epg_mapping(
    channel_slug: str,
    body: EpgMappingPayload,
    _: Annotated[None, Depends(require_admin)],
) -> dict:
    epg_db.init_db()
    with epg_db.connect() as conn:
        epg_db.set_mapping(conn, channel_slug, body.epg_id, body.epg_url)
    return {"ok": True, "channel_slug": channel_slug}


@admin_router.delete("/admin/channels/{channel_slug}/epg")
def admin_delete_epg_mapping(
    channel_slug: str,
    _: Annotated[None, Depends(require_admin)],
) -> dict:
    epg_db.init_db()
    with epg_db.connect() as conn:
        found = epg_db.delete_mapping(conn, channel_slug)
    if not found:
        raise HTTPException(status_code=404, detail="No EPG mapping for channel")
    return {"ok": True}


@admin_router.post("/admin/epg/refresh")
def admin_refresh_epg(_: Annotated[None, Depends(require_admin)]) -> dict:
    epg_db.init_db()
    result = refresh_all_configured_sources()
    if not result["sources"]:
        raise HTTPException(status_code=400, detail="No EPG sources configured")
    return result
