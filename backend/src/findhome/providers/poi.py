"""Nearby services via OSM Overpass, cached in poi_cache. Used by the poi-layer backlog task;
init ships the client, the query builder and the cache."""
from __future__ import annotations

import hashlib
from datetime import UTC, datetime, timedelta

import httpx
from psycopg.types.json import Jsonb

from findhome.config.models import PoiCategory
from findhome.providers.base import LatLon, haversine_km


def tag_filters(tag: str) -> str:
    """'shop=a|b' → ["shop"~"^(a|b)$"]; 'name~^SATS' → ["name"~"^SATS"]; 'subway!=yes' → ["subway"!="yes"];
    'a=b&c=d' → both on one element."""
    out = ""
    for clause in tag.split("&"):
        if "!=" in clause:
            k, v = clause.split("!=", 1)
            out += f'["{k}"!="{v}"]'
        elif "~" in clause and ("=" not in clause or clause.index("~") < clause.index("=")):
            k, v = clause.split("~", 1)
            out += f'["{k}"~"{v}"]'
        else:
            k, v = clause.split("=", 1)
            out += f'["{k}"~"^({v})$"]' if "|" in v else f'["{k}"="{v}"]'
    return out


def overpass_query(cat: PoiCategory, at: LatLon) -> str:
    """Elements of one category around a point (see tag_filters for the tag grammar)."""
    parts = []
    for tag in cat.osm_tags:
        filters = tag_filters(tag)
        for kind in ("node", "way"):
            parts.append(f"{kind}{filters}(around:{cat.radius_m},{at.lat},{at.lon});")
    return f"[out:json][timeout:25];({''.join(parts)});out center 50;"


async def nearby(conn, cfg_url: str, name: str, cat: PoiCategory, at: LatLon, ttl_days: int = 90,
                 client: httpx.AsyncClient | None = None) -> dict:
    key = hashlib.sha1(f"overpass|{name}|{at.key(3)}|{cat.radius_m}|{cat.osm_tags}".encode()).hexdigest()
    row = await (await conn.execute(
        "SELECT result FROM poi_cache WHERE key = %s AND expires_at > now()", (key,))).fetchone()
    if row:
        return row["result"]
    client = client or httpx.AsyncClient(timeout=40, headers={"User-Agent": "findhome/0.1"})
    resp = await client.post(cfg_url, data={"data": overpass_query(cat, at)})
    resp.raise_for_status()
    found = []
    for el in resp.json().get("elements", []):
        lat = el.get("lat") or (el.get("center") or {}).get("lat")
        lon = el.get("lon") or (el.get("center") or {}).get("lon")
        if lat is None:
            continue
        found.append({"name": (el.get("tags") or {}).get("name"), "lat": lat, "lon": lon,
                      "km": round(haversine_km(at, LatLon(lat, lon)), 3)})
    found.sort(key=lambda x: x["km"])
    result = {"count": len(found), "nearest_km": found[0]["km"] if found else None, "items": found[:10]}
    await conn.execute(
        """INSERT INTO poi_cache (key, provider, category, result, expires_at) VALUES (%s, 'overpass', %s, %s, %s)
           ON CONFLICT (key) DO UPDATE SET result = EXCLUDED.result, expires_at = EXCLUDED.expires_at""",
        (key, name, Jsonb(result), datetime.now(UTC) + timedelta(days=ttl_days)))
    return result
