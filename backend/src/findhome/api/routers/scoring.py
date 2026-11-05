"""Commute matrix and score recomputation."""
from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime
from typing import Any

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
log = logging.getLogger(__name__)


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
    background: bool = False     # every listing, in the background: missing house analyses first, then scores


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


async def _location(conn, b, L: dict, coords=None) -> dict | None:
    """The listing's house scores (transport with reach, services) and its zone's services index, for the
    transport / services / neighbourhood groups. Cached data only, no provider call: the house analysis must exist
    (open the listing or `findhome listings location --all`); the reach is refreshed from the caches here."""
    if L.get("lat") is None or L.get("lon") is None:
        return None
    from findhome.api.routers.house import house_scores_for
    from findhome.zone import analysis as za
    from findhome.zone.house import version as house_version

    row = await (await conn.execute("SELECT payload FROM listing_location WHERE listing_id = %s AND version = %s",
                                    (L["id"], house_version(b, float(L["lat"]), float(L["lon"]))))).fetchone()
    if not row:
        from findhome.geo.store import load_zones, zone_at

        return {"outside": True} if zone_at(load_zones(), L["lat"], L["lon"]) is None else None
    pl = row["payload"]
    sc = await house_scores_for(conn, b, L, pl, coords)
    zi = await (await conn.execute("SELECT payload FROM zone_index WHERE zone_id = %s AND version = %s",
                                   (pl["zone"]["id"], za.version(b, za.index_sets(b))))).fetchone()
    w = sc["reach_cfg"]["weight"] if sc["reach"] is not None and sc["transport_access"] is not None else (1.0 if sc["reach"] is not None else 0.0)
    return {"services": sc["services"], "transport": sc["transport"], "transport_access": sc["transport_access"],
            "reach": sc["reach"], "reach_rows": sc["reach_rows"], "estimated": sc["estimated"],
            "reach_weight": w, "reach_weight_access": round(1 - w, 3),
            "zone_services": (zi["payload"].get("services") if zi else None)}


async def _score_rows(conn, b, rows: list[dict], progress: dict | None = None) -> dict[str, int]:
    """Geocode up to GEOCODE_PER_RECOMPUTE listings without coordinates, then score every row."""
    scored = rejected = geocoded = 0
    reg = registry()
    coords = await resolve_point_coords(conn, reg, b.locations.points, int(b.providers.cache.get("geocode_ttl_days", 365)))
    for L in rows:
        if L["lat"] is None and L.get("address_raw") and geocoded < GEOCODE_PER_RECOMPUTE:
            geocoded += 1
            L = await ensure_coords(conn, reg, L)
        result = score_listing(b, L, await repo.commute_for(conn, L["id"], b.config_hash), await _location(conn, b, L, coords))
        await repo.save_score(conn, L["id"], b.config_hash, result)
        scored += 1
        rejected += bool(result["rejected_by"])
        if progress is not None:
            progress["done"] = scored
    return {"scored": scored, "rejected": rejected, "geocoded": geocoded}


@router.post("/scores/recompute")
async def recompute(body: RecomputeBody | None = None, conn=Depends(get_conn)):
    """Scores under the current config. With `background`, every listing: the house analysis (transport and
    services from the exact address) of homes that have none yet, then all scores; follow it on
    GET /api/scores/recompute/status."""
    b = bundle()
    if body and body.background:
        if _JOB["running"]:
            return _status()
        _JOB.update(running=True, phase="starting", done=0, total=0, analysed=0, failed=0, result=None, error=None,
                    started_at=datetime.now(UTC).isoformat(), finished_at=None)
        _JOB["task"] = asyncio.create_task(_recompute_all())
        return _status()
    if body and body.short_ids:
        rows = [await repo.get_listing(conn, s) for s in body.short_ids]
    else:
        rows = await (await conn.execute("SELECT * FROM listings WHERE status <> 'archived'")).fetchall()
    return {"config_hash": b.config_hash, **await _score_rows(conn, b, rows)}


@router.get("/scores/recompute/status")
async def recompute_status():
    return _status()


_JOB: dict[str, Any] = {"running": False, "phase": None, "done": 0, "total": 0, "analysed": 0, "failed": 0,
                        "result": None, "error": None, "started_at": None, "finished_at": None, "task": None}


def _status() -> dict[str, Any]:
    return {k: v for k, v in _JOB.items() if k != "task"}


async def _recompute_all() -> None:
    """Background recompute: geocode is part of scoring; house analyses for homes without one, then every score."""
    from findhome.api.routers.house import house_payload
    from findhome.core.db import pool
    from findhome.zone.house import version as house_version

    b = bundle()
    try:
        async with pool().connection() as conn:
            rows = await (await conn.execute("SELECT * FROM listings WHERE status <> 'archived'")).fetchall()
            # coordinates first, so homes geocoded now get their house analysis in this same run
            reg, todo = registry(), [i for i, L in enumerate(rows) if L["lat"] is None and L.get("address_raw")]
            _JOB.update(phase="geocoding", total=min(len(todo), GEOCODE_PER_RECOMPUTE), done=0)
            for i in todo[:GEOCODE_PER_RECOMPUTE]:
                rows[i] = await ensure_coords(conn, reg, rows[i])
                _JOB["done"] += 1
            await conn.commit()
            have = {(r["listing_id"], r["version"]) for r in await (await conn.execute(
                "SELECT listing_id, version FROM listing_location")).fetchall()}
            missing = [L for L in rows if L["lat"] is not None and L["lon"] is not None
                       and (L["id"], house_version(b, float(L["lat"]), float(L["lon"]))) not in have]
            _JOB.update(phase="analysing", total=len(missing), done=0)
            for L in missing:
                try:
                    await house_payload(conn, b, L)
                    await conn.commit()
                    _JOB["analysed"] += 1
                except Exception as exc:  # noqa: BLE001 - outside every zone, missing data: score it without
                    await conn.rollback()
                    _JOB["failed"] += 1
                    log.info("recompute: house analysis of %s skipped: %s", L["short_id"], exc)
                _JOB["done"] += 1
            _JOB.update(phase="scoring", total=len(rows), done=0)
            res = await _score_rows(conn, b, rows, _JOB)
            await conn.commit()
            _JOB["result"] = {"config_hash": b.config_hash, **res, "analysed": _JOB["analysed"], "failed": _JOB["failed"]}
    except Exception as exc:  # noqa: BLE001 - shown on the page
        log.exception("recompute failed")
        _JOB["error"] = str(exc)
    finally:
        _JOB.update(running=False, phase="done", finished_at=datetime.now(UTC).isoformat())
