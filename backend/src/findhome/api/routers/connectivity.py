"""Connectivity map mode: zone × point commute matrix, its background refresh and per-zone details."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException

from findhome.api.state import bundle, registry
from findhome.core import db
from findhome.core.db import get_conn
from findhome.domain import connectivity as cn
from findhome.domain.commute import resolve_point_coords
from findhome.geo.store import load_zones

router = APIRouter(prefix="/api/connectivity", tags=["connectivity"])
DEFAULT_MAX_CALLS = 2500


def _zones_or_404():
    zones = load_zones()
    if zones is None:
        raise HTTPException(404, "zones not built yet: run `findhome geo fetch zones`")
    return zones


@router.get("")
async def matrix(conn=Depends(get_conn)):
    b, zones = bundle(), _zones_or_404()
    h = cn.inputs_hash(b)
    rows = await (await conn.execute(
        "SELECT zone_id, point_id, window_weight, minutes, estimate FROM zone_commute WHERE inputs_hash = %s", (h,))).fetchall()
    old = await (await conn.execute("SELECT count(*) AS n FROM zone_commute WHERE inputs_hash <> %s", (h,))).fetchone()
    cats = b.locations.categories
    points = [{"id": p.id, "label": p.label, "color": cats[p.category].color if p.category in cats else None,
               "icon": cats[p.category].icon if p.category in cats else None, "weight": b.locations.effective_weight(p)}
              for p in b.locations.points if p.enabled]
    data = cn.aggregate(rows, b)
    return {"inputs_hash": h, "points": points, "zones": data, "covered": len(data), "zone_count": len(zones.zones),
            "stale_rows": old["n"], "job": cn.JOB.public()}


@router.get("/zone/{zone_id}")
async def zone_detail(zone_id: str, conn=Depends(get_conn)):
    b, zones = bundle(), _zones_or_404()
    z = zones.zones.get(zone_id)
    if z is None:
        raise HTTPException(404, "unknown zone")
    rows = await (await conn.execute(
        """SELECT point_id, direction, day_type, window_label, window_weight, provider, minutes, estimate
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
async def refresh(conn=Depends(get_conn)):
    if cn.JOB.running:
        raise HTTPException(409, "a connectivity refresh is already running")
    b, reg, zones = bundle(), registry(), _zones_or_404()
    coords = await resolve_point_coords(conn, reg, b.locations.points, int(b.providers.cache.get("geocode_ttl_days", 365)))
    max_calls = int((b.providers.budget or {}).get("max_connectivity_calls_per_run", DEFAULT_MAX_CALLS))
    cn.JOB._task = asyncio.create_task(cn.run(db.pool(), reg, b, zones, coords, max_calls))
    await asyncio.sleep(0)
    return cn.JOB.public()


@router.post("/cancel")
async def cancel():
    if cn.JOB._task and not cn.JOB._task.done():
        cn.JOB._task.cancel()
        return {"cancelled": True}
    return {"cancelled": False}
