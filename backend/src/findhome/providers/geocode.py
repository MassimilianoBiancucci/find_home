"""Geocoding with a Postgres cache (geocode_cache)."""
from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta

from findhome.providers.base import LatLon


def _norm(query: str) -> str:
    return re.sub(r"\s+", " ", query.strip().lower())


async def geocode(conn, registry, query: str, ttl_days: int = 365) -> LatLon | None:
    key = _norm(query)
    if not key or key.startswith("todo"):
        return None
    row = await (await conn.execute(
        "SELECT lat, lon FROM geocode_cache WHERE query = %s AND expires_at > now()", (key,))).fetchone()
    if row:
        return LatLon(row["lat"], row["lon"]) if row["lat"] is not None else None
    hit = await registry.geocoder.geocode(query if "stockholm" in key or "sverige" in key else f"{query}, Sverige")
    lat, lon, display = hit if hit else (None, None, None)
    await conn.execute(
        """INSERT INTO geocode_cache (query, provider, lat, lon, display, expires_at)
           VALUES (%s, %s, %s, %s, %s, %s)
           ON CONFLICT (query) DO UPDATE SET lat = EXCLUDED.lat, lon = EXCLUDED.lon,
             display = EXCLUDED.display, created_at = now(), expires_at = EXCLUDED.expires_at""",
        (key, registry.geocoder.name, lat, lon, display, datetime.now(UTC) + timedelta(days=ttl_days)))
    return LatLon(lat, lon) if lat is not None else None
