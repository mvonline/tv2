"""Public category list + HTTP Basic–protected admin CRUD."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import FileResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from pydantic import BaseModel, Field

from category_db import (
    connect,
    delete_category,
    delete_stream_override,
    get_all_channel_orders,
    get_channel_category_overrides,
    get_featured_channel_slugs,
    get_stream_overrides,
    init_db,
    list_all,
    list_categories_public,
    set_category_channel_order,
    set_channel_category,
    set_featured_channel_slugs,
    set_stream_override,
    upsert_category,
)


def _channels_json_path() -> Path:
    env = os.environ.get("CHANNELS_JSON_PATH", "").strip()
    if env:
        return Path(env)
    return Path(__file__).resolve().parent / "data" / "channels.json"


def _load_channels() -> list[dict]:
    path = _channels_json_path()
    if not path.exists():
        return []
    with open(path) as f:
        data = json.load(f)
    channels = data.get("channels", [])

    init_db()
    with connect() as conn:
        stream_ovr = get_stream_overrides(conn)

    if stream_ovr:
        for c in channels:
            ov = stream_ovr.get(c.get("slug", ""))
            if not ov:
                continue
            if ov["stream_url"] is not None:
                c["stream_url"] = ov["stream_url"]
            if ov["requires_proxy"] is not None:
                c["requires_proxy"] = ov["requires_proxy"]

    return channels

security_optional = HTTPBasic(auto_error=False)
security_required = HTTPBasic()

router = APIRouter(tags=["categories"])
admin_router = APIRouter(tags=["admin"])

ADMIN_USER = os.environ.get("ADMIN_USER", "admin")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")
SESSION_SECRET = os.environ.get(
    "ADMIN_SESSION_SECRET",
    "change-me-in-production",
).encode()


def _check_password(username: str, password: str) -> bool:
    if not ADMIN_PASSWORD:
        return False
    return secrets.compare_digest(username, ADMIN_USER) and secrets.compare_digest(
        password, ADMIN_PASSWORD
    )


def _sign_session(username: str) -> str:
    exp = int(time.time()) + 86400 * 7
    payload = json.dumps({"u": username, "exp": exp}, separators=(",", ":"))
    sig = hmac.new(SESSION_SECRET, payload.encode(), hashlib.sha256).hexdigest()
    return base64.urlsafe_b64encode(payload.encode()).decode() + "." + sig


def _verify_session(token: str) -> bool:
    try:
        raw, sig = token.rsplit(".", 1)
        payload = base64.urlsafe_b64decode(raw.encode()).decode()
        expect = hmac.new(SESSION_SECRET, payload.encode(), hashlib.sha256).hexdigest()
        if not secrets.compare_digest(expect, sig):
            return False
        data = json.loads(payload)
        if int(data.get("exp", 0)) < time.time():
            return False
        return data.get("u") == ADMIN_USER
    except Exception:
        return False


def require_admin(
    request: Request,
    credentials: Annotated[HTTPBasicCredentials | None, Depends(security_optional)],
) -> None:
    if credentials and _check_password(credentials.username, credentials.password):
        return
    if _verify_session(request.cookies.get("admin_session", "")):
        return
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication required",
        headers={"WWW-Authenticate": 'Basic realm="TV2 Admin"'},
    )


class CategoryPayload(BaseModel):
    slug: str = Field(..., min_length=1, max_length=64)
    label: str = Field(..., min_length=1, max_length=128)
    sort_order: int = 0
    active: bool = True


class CategoryPatch(BaseModel):
    label: str | None = None
    sort_order: int | None = None
    active: bool | None = None


@router.get("/config")
def get_public_config() -> dict[str, str]:
    """Public SPA hints: logos_base_url prefixes relative ``channel.logo`` paths from channels.json."""
    raw = os.environ.get("LOGOS_BASE_URL", "").strip().rstrip("/")
    return {"logos_base_url": raw}


@router.get("/categories")
def get_categories_public() -> list[dict]:
    init_db()
    with connect() as conn:
        return list_categories_public(conn)


@router.get("/channel-config")
def get_channel_config() -> dict:
    """Public: category overrides + per-category channel ordering for the frontend."""
    init_db()
    with connect() as conn:
        overrides = get_channel_category_overrides(conn)
        orders = get_all_channel_orders(conn)
    return {"category_overrides": overrides, "channel_order": orders}


@router.get("/featured-channels")
def get_featured_channels() -> dict:
    init_db()
    with connect() as conn:
        slugs = get_featured_channel_slugs(conn)
    return {"slugs": slugs}


@admin_router.post("/admin/session")
def admin_session(
    response: Response,
    credentials: Annotated[HTTPBasicCredentials, Depends(security_required)],
):
    if not _check_password(credentials.username, credentials.password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    token = _sign_session(credentials.username)
    response.set_cookie(
        key="admin_session",
        value=token,
        httponly=True,
        samesite="lax",
        max_age=86400 * 7,
        path="/",
    )
    return {"ok": True}


@admin_router.get("/admin/categories")
def admin_list_categories(_: None = Depends(require_admin)) -> list[dict]:
    init_db()
    with connect() as conn:
        return list_all(conn)


@admin_router.post("/admin/categories")
def admin_create_category(
    body: CategoryPayload,
    _: None = Depends(require_admin),
) -> dict:
    init_db()
    with connect() as conn:
        upsert_category(
            conn,
            body.slug,
            body.label,
            body.sort_order,
            body.active,
        )
    return {"ok": True, "slug": body.slug.strip().lower()}


@admin_router.patch("/admin/categories/{slug}")
def admin_patch_category(
    slug: str,
    body: CategoryPatch,
    _: None = Depends(require_admin),
) -> dict:
    init_db()
    with connect() as conn:
        row = conn.execute(
            "SELECT slug, label, sort_order, active FROM categories WHERE slug = ?",
            (slug.strip().lower(),),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Unknown slug")
        label = body.label if body.label is not None else row["label"]
        sort_order = body.sort_order if body.sort_order is not None else int(row["sort_order"])
        active = body.active if body.active is not None else bool(row["active"])
        upsert_category(conn, row["slug"], label, sort_order, active)
    return {"ok": True}


@admin_router.delete("/admin/categories/{slug}")
def admin_delete_category(slug: str, _: None = Depends(require_admin)) -> dict:
    init_db()
    with connect() as conn:
        if not delete_category(conn, slug):
            raise HTTPException(status_code=404, detail="Unknown slug")
    return {"ok": True}


class ChannelCategoryPayload(BaseModel):
    category_slug: str = Field(..., min_length=1, max_length=64)


class ChannelOrderPayload(BaseModel):
    order: list[str]


class FeaturedChannelsPayload(BaseModel):
    slugs: list[str]


@admin_router.get("/admin/channels")
def admin_list_channels(
    category: str | None = Query(default=None),
    _: None = Depends(require_admin),
) -> list[dict]:
    """List channels with their effective category. Filter by category slug if supplied."""
    init_db()
    channels = _load_channels()
    with connect() as conn:
        overrides = get_channel_category_overrides(conn)
        orders = get_all_channel_orders(conn)

    result = []
    for c in channels:
        slug = c.get("slug", "")
        ai_cat = (c.get("ai_category") or "other").lower()
        effective = overrides.get(slug, ai_cat)
        if category is not None and effective != category.lower():
            continue
        result.append({
            "slug": slug,
            "name": c.get("name") or slug,
            "ai_category": ai_cat,
            "effective_category": effective,
            "has_override": slug in overrides,
            "logo": c.get("logo"),
        })

    if category and category in orders:
        order_idx = {s: i for i, s in enumerate(orders[category])}
        result.sort(key=lambda ch: (order_idx.get(ch["slug"], len(orders[category])), (ch["name"] or "").lower()))
    else:
        result.sort(key=lambda ch: (ch["name"] or "").lower())

    return result


@admin_router.put("/admin/channels/{slug}/category")
def admin_move_channel(
    slug: str,
    body: ChannelCategoryPayload,
    _: None = Depends(require_admin),
) -> dict:
    """Override a channel's category."""
    init_db()
    with connect() as conn:
        set_channel_category(conn, slug, body.category_slug)
    return {"ok": True}


@admin_router.put("/admin/categories/{slug}/channels/order")
def admin_set_channel_order(
    slug: str,
    body: ChannelOrderPayload,
    _: None = Depends(require_admin),
) -> dict:
    """Set the display order of channels within a category."""
    init_db()
    with connect() as conn:
        set_category_channel_order(conn, slug.strip().lower(), body.order)
    return {"ok": True}


@admin_router.get("/admin/featured-channels")
def admin_get_featured_channels(_: None = Depends(require_admin)) -> dict:
    init_db()
    with connect() as conn:
        slugs = get_featured_channel_slugs(conn)
    return {"slugs": slugs}


@admin_router.put("/admin/featured-channels")
def admin_set_featured_channels(
    body: FeaturedChannelsPayload,
    _: None = Depends(require_admin),
) -> dict:
    init_db()
    with connect() as conn:
        set_featured_channel_slugs(conn, body.slugs)
        slugs = get_featured_channel_slugs(conn)
    return {"ok": True, "slugs": slugs}


class StreamOverridePayload(BaseModel):
    stream_url: str | None = None
    requires_proxy: bool | None = None


@admin_router.get("/admin/stream-overrides")
def admin_list_stream_overrides(_: None = Depends(require_admin)) -> list[dict]:
    init_db()
    with connect() as conn:
        ovr = get_stream_overrides(conn)
    return [{"slug": k, **v} for k, v in sorted(ovr.items())]


@admin_router.put("/admin/channels/{slug}/stream")
def admin_set_stream_override(
    slug: str,
    body: StreamOverridePayload,
    _: None = Depends(require_admin),
) -> dict:
    """Override stream_url and/or requires_proxy for a channel (survives re-fetch)."""
    init_db()
    with connect() as conn:
        set_stream_override(conn, slug, body.stream_url, body.requires_proxy)
    return {"ok": True}


@admin_router.delete("/admin/channels/{slug}/stream")
def admin_delete_stream_override(
    slug: str,
    _: None = Depends(require_admin),
) -> dict:
    init_db()
    with connect() as conn:
        found = delete_stream_override(conn, slug)
    if not found:
        raise HTTPException(status_code=404, detail="No override for that slug")
    return {"ok": True}


def _admin_html_path() -> str:
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "static", "admin.html")


def serve_admin_page(
    request: Request,
    credentials: Annotated[HTTPBasicCredentials | None, Depends(security_optional)],
):
    """Browser HTTP Basic and/or session cookie (set via POST /api/admin/session)."""
    if credentials and _check_password(credentials.username, credentials.password):
        pass
    elif _verify_session(request.cookies.get("admin_session", "")):
        pass
    else:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            headers={"WWW-Authenticate": 'Basic realm="TV2 Admin"'},
        )
    path = _admin_html_path()
    if os.path.isfile(path):
        return FileResponse(path, media_type="text/html")
    raise HTTPException(status_code=500, detail="admin.html missing")
