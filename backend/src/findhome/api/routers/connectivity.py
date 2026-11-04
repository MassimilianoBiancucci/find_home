"""Connectivity map mode: zone × point commute matrix, its background refresh, route status and per-zone details."""
from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from findhome.api.state import bundle, registry
from findhome.config.writer import apply_ops
from findhome.core import db
from findhome.core.db import get_conn
from findhome.db import connectivity_repo as repo
from findhome.domain import connectivity as cn
from findhome.domain import connectivity_status as cs
from findhome.domain.commute import cache_key, resolve_point_coords
from findhome.geo.store import load_zones

router = APIRouter(prefix="/api/connectivity", tags=["connectivity"])
DEFAULT_MAX_CALLS = 2500


class RefreshBody(BaseModel):
    scope: list[str] | None = None          # missing | estimates | failed | stale | all; default missing + estimates


class DecisionBody(BaseModel):
    action: Literal["continue", "estimate", "stop"]
    remember: bool = False                  # write connectivity.on_provider_failure (continue / estimate only)


def _zones_or_404():
    zones = load_zones()
    if zones is None:
        raise HTTPException(404, "zones not built yet: run `findhome geo fetch zones`")
    return zones


def _settings(b) -> tuple[int, str, int]:
    """max calls per run, failure policy, cache TTL (days). The old budget key still works."""
    c = b.providers.connectivity or {}
    max_calls = c.get("max_calls_per_run", (b.providers.budget or {}).get("max_connectivity_calls_per_run", DEFAULT_MAX_CALLS))
    policy = c.get("on_provider_failure", "ask")
    return int(max_calls), policy if policy in cn.POLICIES else "ask", int(b.providers.cache.get("routing_ttl_days", 30))


async def _planned(conn, b, zones):
    coords = await resolve_point_coords(conn, registry(), b.locations.points, int(b.providers.cache.get("geocode_ttl_days", 365)))
    return coords, cn.plan(b, zones, coords)


@router.get("")
async def matrix(conn=Depends(get_conn)):
    b, zones = bundle(), _zones_or_404()
    h = cn.inputs_hash(b)
    rows = await (await conn.execute(
        "SELECT zone_id, point_id, window_weight, minutes, estimate FROM zone_commute WHERE inputs_hash = %s", (h,))).fetchall()
    old = await (await conn.execute("SELECT count(*) AS n FROM zone_commute WHERE inputs_hash <> %s", (h,))).fetchone()
    _, reqs = await _planned(conn, b, zones)
    _, _, ttl = _settings(b)
    stored = await repo.read_rows(conn, h)
    counts = cs.counts(reqs, stored, ttl, datetime.now(UTC), cn.JOB.running)
    cats = b.locations.categories
    points = [{"id": p.id, "label": p.label, "color": cats[p.category].color if p.category in cats else None,
               "icon": cats[p.category].icon if p.category in cats else None, "weight": b.locations.effective_weight(p)}
              for p in b.locations.points if p.enabled]
    data = cn.aggregate(rows, b)
    real = cn.aggregate([r for r in rows if not r["estimate"]], b) if any(r["estimate"] for r in rows) else data
    failed_zones = sorted({k[0] for k, v in stored.items() if v.status == "failed"} - set(data))
    return {"inputs_hash": h, "points": points, "zones": data, "zones_real": real, "covered": len(data), "zone_count": len(zones.zones),
            "failed_zones": failed_zones, "stale_rows": old["n"], "counts": counts, "job": cn.JOB.public()}


@router.get("/routes")
async def routes(status: str | None = None, zone: str | None = None, point: str | None = None, q: str | None = None,
                 offset: int = 0, limit: int = 100, conn=Depends(get_conn)):
    """Every planned route with its status; filter by status (comma list), zone id, point id or text in the zone name."""
    b, zones = bundle(), _zones_or_404()
    _, reqs = await _planned(conn, b, zones)
    _, _, ttl = _settings(b)
    labels = {p.id: p.label for p in b.locations.points}
    items = cs.route_items(reqs, await repo.read_rows(conn, cn.inputs_hash(b)), zones, labels, ttl, datetime.now(UTC),
                           cn.JOB.running)
    wanted = set(status.split(",")) if status else None
    text = (q or "").strip().lower()
    hits = [i for i in items if (wanted is None or i["status"] in wanted) and (zone is None or i["zone_id"] == zone)
            and (point is None or i["point_id"] == point) and (not text or text in i["zone"].lower())]
    limit = max(1, min(limit, 500))
    return {"total": len(hits), "offset": offset, "limit": limit, "items": hits[offset:offset + limit]}


@router.get("/plan")
async def refresh_plan(scope: str | None = None, conn=Depends(get_conn)):
    """What a refresh with this scope would do, before spending calls: provider calls, cache hits, skipped."""
    b, zones, reg = bundle(), _zones_or_404(), registry()
    try:
        sc = cn.parse_scope(scope.split(",") if scope else None)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    _, reqs = await _planned(conn, b, zones)
    max_calls, _, ttl = _settings(b)
    provider = reg.for_mode(cn.MODE)
    real = provider.name != "haversine"
    rows = await repo.read_rows(conn, cn.inputs_hash(b))
    failures = {} if not real or "failed" in sc else await repo.read_failures(conn, provider.name)
    keys = {cache_key(provider, r): r for _, r in reqs}
    ages = await repo.cache_ages(conn, list(keys)) if real else {}
    now = datetime.now(UTC)
    out = {"skip": 0, "fail": 0, "cache": 0, "call": 0, "estimate": 0}
    for zid, r in reqs:
        k = cache_key(provider, r)
        hit = repo.CacheHit(None, ages[k]) if k in ages else None
        out[cn.decide(rows.get(cs.pair_key(zid, r)), cn.zone_side(r).key() in failures, hit, sc, real, ttl, now)] += 1
    interval = getattr(getattr(provider, "limiter", None), "interval", 0)     # seconds between calls
    calls = min(out["call"], max_calls)
    return {"scope": list(sc), "provider": provider.name, "calls": calls, "calls_over_budget": out["call"] - calls,
            "cached": out["cache"], "failed_skipped": out["fail"], "estimates": out["estimate"], "skipped": out["skip"],
            "eta_s": round(calls * interval) if interval else None, "max_calls": max_calls}


@router.get("/zone/{zone_id}")
async def zone_detail(zone_id: str, conn=Depends(get_conn)):
    b, zones = bundle(), _zones_or_404()
    z = zones.zones.get(zone_id)
    if z is None:
        raise HTTPException(404, "unknown zone")
    rows = await (await conn.execute(
        """SELECT point_id, direction, day_type, window_label, window_weight, provider, minutes, estimate, status, error
           FROM zone_commute WHERE inputs_hash = %s AND zone_id = %s ORDER BY point_id, direction, window_label""",
        (cn.inputs_hash(b), zone_id))).fetchall()
    o = cn.zone_origin(z)
    return {"zone": {"id": z.id, "name": z.name, "district": z.district, "kommun": z.kommun},
            "origin": [o.lon, o.lat], "rows": [{**r, "minutes": None if r["minutes"] is None else float(r["minutes"]),
                                                "window_weight": float(r["window_weight"])} for r in rows]}


@router.get("/status")
async def status():
    return cn.JOB.public()


@router.post("/refresh", status_code=202)
async def refresh(body: RefreshBody | None = None, conn=Depends(get_conn)):
    if cn.JOB.running:
        raise HTTPException(409, "a connectivity refresh is already running")
    b, reg, zones = bundle(), registry(), _zones_or_404()
    try:
        scope = cn.parse_scope(body.scope if body else None)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    coords, _ = await _planned(conn, b, zones)
    max_calls, policy, _ = _settings(b)
    cn.JOB._task = asyncio.create_task(cn.run(repo.PgConnectivityStore(db.pool()), reg, b, zones, coords, max_calls,
                                              scope=list(scope), policy=policy))
    await asyncio.sleep(0)
    return cn.JOB.public()


@router.post("/decision")
async def decision(body: DecisionBody):
    """Answer a paused refresh; with `remember`, the answer becomes connectivity.on_provider_failure."""
    if cn.JOB.state != "paused":
        raise HTTPException(409, "no refresh is waiting for a decision")
    if body.remember and body.action != "stop":
        connectivity = bundle().providers.connectivity
        op = ({"op": "add", "path": "/connectivity/on_provider_failure", "value": body.action} if connectivity
              else {"op": "add", "path": "/connectivity", "value": {"on_provider_failure": body.action}})
        apply_ops("providers", [op])
        cn.JOB.policy = body.action
    cn.JOB.decide(body.action)
    await asyncio.sleep(0)
    return cn.JOB.public()


@router.post("/cancel")
async def cancel():
    if cn.JOB._task and not cn.JOB._task.done():
        cn.JOB._task.cancel()
        return {"cancelled": True}
    return {"cancelled": False}
