"""Public category list + HTTP Basic–protected admin CRUD."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import FileResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from pydantic import BaseModel, Field

from category_db import (
    connect,
    delete_category,
    init_db,
    list_all,
    list_categories_public,
    upsert_category,
)

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


@router.get("/categories")
def get_categories_public() -> list[dict]:
    init_db()
    with connect() as conn:
        return list_categories_public(conn)


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
