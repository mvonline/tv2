"""Analytics API — public view recording + admin stats."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

import analytics_db
from category_routes import require_admin

router = APIRouter(tags=["analytics"])
admin_router = APIRouter(tags=["analytics-admin"])


def _client_ip(request: Request) -> str:
    xff = (request.headers.get("x-forwarded-for") or "").strip()
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


class ViewBody(BaseModel):
    channel_slug: str
    channel_name: str | None = None


@router.post("/analytics/view", status_code=204)
def record_view(body: ViewBody, request: Request) -> None:
    ip = _client_ip(request)
    ua = request.headers.get("user-agent") or None
    analytics_db.record_view(body.channel_slug, body.channel_name, ip, ua)


@admin_router.get("/admin/analytics/summary")
def analytics_summary(_: Annotated[None, Depends(require_admin)]) -> dict:
    return analytics_db.get_summary()


@admin_router.get("/admin/analytics/top-channels")
def top_channels(
    _: Annotated[None, Depends(require_admin)],
    days: int = 30,
    limit: int = 10,
) -> list:
    return analytics_db.get_top_channels(days=days, limit=limit)


@admin_router.get("/admin/analytics/recent")
def recent_views(
    _: Annotated[None, Depends(require_admin)],
    limit: int = 50,
) -> list:
    return analytics_db.get_recent_views(limit=limit)


@admin_router.get("/admin/analytics/by-hour")
def views_by_hour(
    _: Annotated[None, Depends(require_admin)],
    days: int = 7,
) -> list:
    return analytics_db.get_views_by_hour(days=days)


@admin_router.get("/admin/analytics/by-day")
def views_by_day(
    _: Annotated[None, Depends(require_admin)],
    days: int = 30,
) -> list:
    return analytics_db.get_views_by_day(days=days)
