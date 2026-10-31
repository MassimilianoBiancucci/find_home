"""Geocoding through the app's cache, and address suggestions for the Locations editor."""
from __future__ import annotations

from collections import OrderedDict

from fastapi import APIRouter, Depends, HTTPException, Query

from findhome.api.state import bundle, registry
from findhome.core.db import get_conn
from findhome.providers.geocode import _norm, forget, geocode, provider_query

router = APIRouter(prefix="/api/geocode", tags=["geocode"])
_SUGGEST_CACHE: OrderedDict[str, list[dict]] = OrderedDict()
_SUGGEST_CACHE_SIZE = 200


@router.get("")
async def lookup(q: str = Query(min_length=2), refresh: bool = False, conn=Depends(get_conn)):
    """Same cached path the map and commute use; `refresh` drops the cached answer first."""
    if refresh:
        await forget(conn, q)
    row = await (await conn.execute(
        "SELECT lat, lon, display, provider FROM geocode_cache WHERE query = %s AND expires_at > now()",
        (_norm(q),))).fetchone()
    if row:
        return {"query": q, "sent": provider_query(q), "cached": True,
                "result": None if row["lat"] is None else {"lat": row["lat"], "lon": row["lon"], "display": row["display"]}}
    ttl = int(bundle().providers.cache.get("geocode_ttl_days", 365))
    hit = await geocode(conn, registry(), q, ttl)
    return {"query": q, "sent": provider_query(q), "cached": False,
            "result": None if hit is None else {"lat": hit.lat, "lon": hit.lon, "display": None}}


@router.get("/suggest")
async def suggest(q: str = Query(min_length=4, max_length=200)):
    sug = registry().suggester
    if not sug.available:
        raise HTTPException(503, "no address suggester configured: set ORS_API_KEY or enable photon in providers.yaml")
    key = " ".join(q.lower().split())
    if key in _SUGGEST_CACHE:
        _SUGGEST_CACHE.move_to_end(key)
        return {"items": _SUGGEST_CACHE[key]}
    center = bundle().providers.map.get("center", [59.3293, 18.0686])
    items = [s.__dict__ for s in await sug.suggest(q, (center[0], center[1]))]
    _SUGGEST_CACHE[key] = items
    if len(_SUGGEST_CACHE) > _SUGGEST_CACHE_SIZE:
        _SUGGEST_CACHE.popitem(last=False)
    return {"items": items}
