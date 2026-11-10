"""Connectivity map mode: zone × point commute matrix, its background refresh, route status and per-zone details."""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
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
from findhome.domain import connectivity_derive as cd
from findhome.domain import connectivity_status as cs
from findhome.domain.commute import cache_key, resolve_point_coords
from findhome.geo.store import load_zones
from findhome.zone.centroid_build import load_centroids

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


@dataclass
class Planned:
    coords: dict
    reqs: list                  # (origin id, Request)
    kind: str                   # zone | stations (connectivity.origin)
    names: dict                 # origin id → (name, district)
    centroids: dict | None


def origin_kind(b) -> str:
    """connectivity.origin: stations (connectivity centroids, when built) or zone (one point inside each zone)."""
    want = (b.providers.connectivity or {}).get("origin", "zone")
    return "stations" if want == "stations" and load_centroids() is not None else "zone"


async def _planned(conn, b, zones) -> Planned:
    coords = await resolve_point_coords(conn, registry(), b.locations.points, int(b.providers.cache.get("geocode_ttl_days", 365)))
    if origin_kind(b) == "stations":
        doc = load_centroids()
        uses: dict[str, int] = {}
        for z in doc["zones"].values():
            for c in z["centroids"]:
                uses[c["key"]] = uses.get(c["key"], 0) + 1
        names = {k: (v["name"], f"station · {uses.get(k, 0)} zones") for k, v in doc["stations"].items()}
        return Planned(coords, cn.plan_stations(b, doc["stations"], coords), "stations", names, doc)
    names = {z.id: (z.name, z.district) for z in zones.zones.values()}
    return Planned(coords, cn.plan(b, zones, coords), "zone", names, None)


async def derive_zones(b, centroids: dict, reqs: list) -> int:
    """The comparison pass: zone rows and patterns from the station commutes; returns the zone routes written."""
    h = cn.inputs_hash(b)
    async with db.pool().connection() as conn:
        rows = await repo.read_rows(conn, h, "stations")
    results = await asyncio.to_thread(cd.derive, centroids, rows, cd.routes_of(reqs))
    await repo.write_derived(db.pool(), h, results)
    return len(results)


_restore_lock = asyncio.Lock()


async def restore(conn, b, pl: Planned) -> dict:
    """Put back, without a call, every planned route that has no row under the current inputs hash but a cached
    answer (or a known unroutable coordinate): after a locations edit only the new or moved routes stay missing.
    Station origins then re-derive the zone values. Not while a refresh runs (it writes the same rows)."""
    provider = registry().for_mode(cn.MODE)
    if provider.name == "haversine" or cn.JOB.running:
        return {"restored": 0}
    async with _restore_lock:
        h = cn.inputs_hash(b)
        rows = await repo.read_rows(conn, h, pl.kind)
        todo = [(zid, r) for zid, r in pl.reqs if cs.pair_key(zid, r) not in rows]
        if not todo:
            return {"restored": 0}
        hits = await repo.cache_hits(conn, sorted({cache_key(provider, r) for _, r in todo}))
        failures = await repo.read_failures(conn, provider.name)
        writes = cn.restore_rows(h, todo, rows, failures, hits, provider.name, lambda r: cache_key(provider, r))
        await repo.PgConnectivityStore(db.pool(), pl.kind).write_many(writes)
        if writes and pl.kind == "stations":
            await derive_zones(b, pl.centroids, pl.reqs)
        return {"restored": len(writes), "still_missing": len(todo) - len(writes)}


def _points(b) -> list[dict]:
    """The enabled points with their category colour and icon and their effective weight."""
    cats = b.locations.categories
    return [{"id": p.id, "label": p.label, "color": cats[p.category].color if p.category in cats else None,
             "icon": cats[p.category].icon if p.category in cats else None, "weight": b.locations.effective_weight(p)}
            for p in b.locations.points if p.enabled]


@router.get("")
async def matrix(conn=Depends(get_conn)):
    b, zones = bundle(), _zones_or_404()
    h = cn.inputs_hash(b)
    pl = await _planned(conn, b, zones)
    restored = await restore(conn, b, pl)
    rows = await (await conn.execute(
        "SELECT zone_id, point_id, window_weight, minutes, estimate FROM zone_commute WHERE inputs_hash = %s", (h,))).fetchall()
    old = await (await conn.execute("SELECT count(*) AS n FROM zone_commute WHERE inputs_hash <> %s", (h,))).fetchone()
    _, _, ttl = _settings(b)
    stored = await repo.read_rows(conn, h)
    route_rows = stored if pl.kind == "zone" else await repo.read_rows(conn, h, "stations")
    counts = cs.counts(pl.reqs, route_rows, ttl, datetime.now(UTC), cn.JOB.running)
    points = _points(b)
    data = cn.aggregate(rows, b)
    real = cn.aggregate([r for r in rows if not r["estimate"]], b) if any(r["estimate"] for r in rows) else data
    failed_zones = sorted({k[0] for k, v in stored.items() if v.status == "failed"} - set(data))
    return {"inputs_hash": h, "points": points, "zones": data, "zones_real": real, "covered": len(data), "zone_count": len(zones.zones),
            "failed_zones": failed_zones, "stale_rows": old["n"], "counts": counts, "origin": pl.kind,
            "restored": restored["restored"], "job": cn.JOB.public()}


@router.get("/minutes")
async def minutes(window: str | None = None, conn=Depends(get_conn)):
    """Zone minutes per point and the weighted mix for one travel period (`day_type|window_label`), or over every
    period as the matrix does; plus the periods there are. Used by the Area mode's reach pieces."""
    b = bundle()
    rows = await (await conn.execute(
        "SELECT zone_id, point_id, day_type, window_label, window_weight, minutes, estimate FROM zone_commute"
        " WHERE inputs_hash = %s", (cn.inputs_hash(b),))).fetchall()
    rows = [dict(r) for r in rows]
    periods = cn.periods(rows)
    if window:
        if window not in {p["key"] for p in periods}:
            raise HTTPException(404, f"unknown travel period {window!r}")
        rows = [r for r in rows if cn.period_key(r) == window]
    real = [r for r in rows if not r["estimate"]]
    data = cn.aggregate(rows, b)
    return {"window": window or None, "points": _points(b), "periods": periods, "zones": data,
            "zones_real": cn.aggregate(real, b) if len(real) < len(rows) else data}


@router.post("/restore")
async def restore_cached(conn=Depends(get_conn)):
    """Rebuild the matrix for the current locations from cached answers only (no provider call)."""
    b, zones = bundle(), _zones_or_404()
    return await restore(conn, b, await _planned(conn, b, zones))


@router.get("/routes")
async def routes(status: str | None = None, zone: str | None = None, point: str | None = None, q: str | None = None,
                 offset: int = 0, limit: int = 100, conn=Depends(get_conn)):
    """Every planned route with its status; filter by status (comma list), zone id, point id or text in the zone name."""
    b, zones = bundle(), _zones_or_404()
    pl = await _planned(conn, b, zones)
    _, _, ttl = _settings(b)
    labels = {p.id: p.label for p in b.locations.points}
    items = cs.route_items(pl.reqs, await repo.read_rows(conn, cn.inputs_hash(b), pl.kind), pl.names, labels, ttl,
                           datetime.now(UTC), cn.JOB.running)
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
    pl = await _planned(conn, b, zones)
    await restore(conn, b, pl)
    reqs = pl.reqs
    max_calls, _, ttl = _settings(b)
    provider = reg.for_mode(cn.MODE)
    real = provider.name != "haversine"
    rows = await repo.read_rows(conn, cn.inputs_hash(b), pl.kind)
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
    pl = await _planned(conn, b, zones)
    await restore(conn, b, pl)                  # cached answers in bulk first; the job then only meets the rest
    max_calls, policy, _ = _settings(b)

    async def job():
        try:
            await cn.run(repo.PgConnectivityStore(db.pool(), pl.kind), reg, b, zones, pl.coords, max_calls,
                         scope=list(scope), policy=policy, reqs=pl.reqs)
        finally:                                   # stations: zone values follow even after a stop or a budget cut
            if pl.kind == "stations":
                await derive_zones(b, pl.centroids, pl.reqs)

    cn.JOB._task = asyncio.create_task(job())
    await asyncio.sleep(0)
    return cn.JOB.public()


@router.post("/derive")
async def derive(conn=Depends(get_conn)):
    """Recompute the zone values from the station commutes already stored (no provider call)."""
    b, zones = bundle(), _zones_or_404()
    pl = await _planned(conn, b, zones)
    if pl.kind != "stations":
        raise HTTPException(409, "connectivity.origin is not stations (or `findhome zone centroids` has not run)")
    return {"zone_routes": await derive_zones(b, pl.centroids, pl.reqs)}


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
