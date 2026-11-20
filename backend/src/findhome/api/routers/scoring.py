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
from findhome.rescore import GEOCODE_PER_RECOMPUTE, ensure_coords
from findhome.rescore import score_rows as _score_rows

router = APIRouter(prefix="/api", tags=["commute & scores"])
log = logging.getLogger(__name__)


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
