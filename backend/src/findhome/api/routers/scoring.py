"""Commute matrix and score recomputation."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from findhome.api.state import bundle, registry
from findhome.core.db import get_conn
from findhome.db import repo
from findhome.domain.commute import RunBudget, compute_listing, resolve_point_coords
from findhome.domain.models import CommuteRequest
from findhome.domain.scoring import score_listing

router = APIRouter(prefix="/api", tags=["commute & scores"])
GEOCODE_PER_RECOMPUTE = 60          # Nominatim allows 1 req/s; cached answers are free


async def ensure_coords(conn, reg, L: dict) -> dict:
    """Geocode a listing without coordinates from its address (cached) and store the result."""
    if L["lat"] is not None or not L.get("address_raw"):
        return L
    from findhome.providers.geocode import geocode

    hit = await geocode(conn, reg, L["address_raw"])
    if not hit:
        return L
    await conn.execute("UPDATE listings SET lat = %s, lon = %s, geocode_source = 'nominatim' WHERE id = %s",
                       (hit.lat, hit.lon, L["id"]))
    return {**L, "lat": hit.lat, "lon": hit.lon}


class RecomputeBody(BaseModel):
    short_ids: list[str] | None = None


@router.post("/commute/compute")
async def compute(body: CommuteRequest, conn=Depends(get_conn)):
    b, reg = bundle(), registry()
    budget = RunBudget(body.budget if body.budget is not None else int(b.providers.budget["max_routing_calls_per_run"]))
    coords = await resolve_point_coords(conn, reg, b.locations.points, int(b.providers.cache.get("geocode_ttl_days", 365)))
    results = {}
    for sid in body.short_ids:
        L = await ensure_coords(conn, reg, await repo.get_listing(conn, sid))
        if L["lat"] is None:
            results[L["short_id"]] = {"error": "no coordinates (address could not be geocoded)"}
            continue
        results[L["short_id"]] = await compute_listing(conn, reg, b, L, coords, budget, body.dry_run, body.provider)
    return {"config_hash": b.config_hash, "budget_used": budget.used, "budget_max": budget.max_calls,
            "providers": reg.status(), "results": results}


@router.get("/commute/{short_id}")
async def commute(short_id: str, conn=Depends(get_conn)):
    L = await repo.get_listing(conn, short_id)
    return {"short_id": L["short_id"], "items": await repo.commute_for(conn, L["id"], bundle().config_hash)}


@router.post("/scores/recompute")
async def recompute(body: RecomputeBody | None = None, conn=Depends(get_conn)):
    b = bundle()
    if body and body.short_ids:
        rows = [await repo.get_listing(conn, s) for s in body.short_ids]
    else:
        rows = await (await conn.execute("SELECT * FROM listings WHERE status <> 'archived'")).fetchall()
    scored = rejected = geocoded = 0
    reg = registry()
    for L in rows:
        if L["lat"] is None and L.get("address_raw") and geocoded < GEOCODE_PER_RECOMPUTE:
            geocoded += 1
            L = await ensure_coords(conn, reg, L)
        result = score_listing(b, L, await repo.commute_for(conn, L["id"], b.config_hash))
        await repo.save_score(conn, L["id"], b.config_hash, result)
        scored += 1
        rejected += bool(result["rejected_by"])
    return {"config_hash": b.config_hash, "scored": scored, "rejected": rejected, "geocoded": geocoded}
