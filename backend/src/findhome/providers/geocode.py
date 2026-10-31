"""Geocoding with a Postgres cache (geocode_cache). Hits keep the configured TTL; misses are retried after a day."""
from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta

from findhome.providers.base import LatLon

MISS_TTL = timedelta(days=1)
_COUNTRY = re.compile(r"\b(sverige|sweden)\b")


def _norm(query: str) -> str:
    return re.sub(r"\s+", " ", query.strip().lower())


def provider_query(query: str) -> str:
    """The text sent to the geocoder: add the country only when the address names none."""
    return query if _COUNTRY.search(_norm(query)) else f"{query}, Sverige"


async def forget(conn, query: str) -> None:
    await conn.execute("DELETE FROM geocode_cache WHERE query = %s", (_norm(query),))


async def geocode(conn, registry, query: str, ttl_days: int = 365) -> LatLon | None:
    key = _norm(query)
    if not key or key.startswith("todo"):
        return None
    row = await (await conn.execute(
        "SELECT lat, lon FROM geocode_cache WHERE query = %s AND expires_at > now()", (key,))).fetchone()
    if row:
        return LatLon(row["lat"], row["lon"]) if row["lat"] is not None else None
    hit = await registry.geocoder.geocode(provider_query(query))
    lat, lon, display = hit if hit else (None, None, None)
    ttl = timedelta(days=ttl_days) if hit else MISS_TTL
    await conn.execute(
        """INSERT INTO geocode_cache (query, provider, lat, lon, display, expires_at)
           VALUES (%s, %s, %s, %s, %s, %s)
           ON CONFLICT (query) DO UPDATE SET lat = EXCLUDED.lat, lon = EXCLUDED.lon,
             display = EXCLUDED.display, created_at = now(), expires_at = EXCLUDED.expires_at""",
        (key, registry.geocoder.name, lat, lon, display, datetime.now(UTC) + ttl))
    return LatLon(lat, lon) if lat is not None else None
