"""XMLTV EPG download and parsing helpers."""

from __future__ import annotations

import gzip
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from urllib.parse import urlparse

import requests


XMLTV_TIME_RE = re.compile(r"^(\d{14})(?:\s*([+-]\d{4}))?")


def parse_xmltv_time(raw: str | None) -> int | None:
    if not raw:
        return None
    m = XMLTV_TIME_RE.match(raw.strip())
    if not m:
        return None
    base, offset = m.groups()
    fmt = "%Y%m%d%H%M%S"
    if offset:
        dt = datetime.strptime(base + offset, fmt + "%z")
    else:
        dt = datetime.strptime(base, fmt).replace(tzinfo=timezone.utc)
    return int(dt.timestamp())


def _text(node: ET.Element | None) -> str | None:
    if node is None or node.text is None:
        return None
    value = node.text.strip()
    return value or None


def fetch_xmltv(url: str, timeout: int = 45) -> bytes:
    r = requests.get(url, timeout=timeout, headers={"User-Agent": "TV2-EPG/1.0"})
    r.raise_for_status()
    body = r.content
    if urlparse(url).path.endswith(".gz") or body[:2] == b"\x1f\x8b":
        body = gzip.decompress(body)
    return body


def parse_xmltv(body: bytes, keep_ids: set[str] | None = None) -> list[dict]:
    root = ET.fromstring(body)
    programmes: list[dict] = []
    for node in root.findall("programme"):
        epg_id = (node.attrib.get("channel") or "").strip()
        if not epg_id or (keep_ids is not None and epg_id not in keep_ids):
            continue
        start_ts = parse_xmltv_time(node.attrib.get("start"))
        stop_ts = parse_xmltv_time(node.attrib.get("stop"))
        if start_ts is None or stop_ts is None or stop_ts <= start_ts:
            continue
        title = _text(node.find("title")) or "Untitled"
        programmes.append(
            {
                "epg_id": epg_id,
                "start_ts": start_ts,
                "stop_ts": stop_ts,
                "title": title,
                "description": _text(node.find("desc")),
                "category": _text(node.find("category")),
            }
        )
    return programmes

