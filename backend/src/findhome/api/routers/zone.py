"""Zone analysis (Map → Zone): facts, targets and walking / cycling heatmaps of one zone, cached in zone_heatmap."""
from __future__ import annotations

import asyncio
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from psycopg.types.json import Jsonb

from findhome.api.state import bundle
from findhome.core.db import get_conn
from findhome.geo.store import load_zones
from findhome.zone import analysis as za

router = APIRouter(prefix="/api/zone", tags=["zone analysis"])


def _zones_or_404():
    zones = load_zones()
    if zones is None:
        raise HTTPException(404, "zones not built yet: run `findhome geo fetch zones`")
    return zones


def _sets(b, sets: str | None) -> list[str]:
    try:
        return za.parse_sets(b, sets)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("/at")
async def zone_at(lat: float, lon: float):
    """The zone under a point (the map's right-click menu); null outside every zone."""
    return {"zone": za.zone_at(_zones_or_404(), lat, lon)}


@router.get("/indices")
async def all_indices(window: str | None = None, conn=Depends(get_conn)):
    """Every zone's stored indices for the current inputs, with percentiles (the map colours by them)."""
    b = bundle()
    ver = za.version(b, za.index_sets(b))
    rows = await (await conn.execute("SELECT zone_id, payload FROM zone_index WHERE version = %s", (ver,))).fetchall()

    def value(pl: dict, key: str):
        return pl["windows"].get(window, {}).get(key) if window else pl.get(key)

    out = {}
    for key in ("transport", "transport_services"):
        vals = {r["zone_id"]: value(r["payload"], key) for r in rows}
        pct = za.percentiles(vals)
        for zid, v in vals.items():
            out.setdefault(zid, {})[key] = {"value": v, "percentile": pct[zid]}
    windows = list((b.zone.indices or {}).get("windows", {}))
    return {"version": ver, "window": window, "windows": windows, "zones": out, "count": len(rows),
            "zone_count": len(_zones_or_404().zones)}


@router.get("/{zone_id}/indices")
async def zone_indices(zone_id: str, conn=Depends(get_conn)):
    """Mobility indices of one zone; computed once per inputs version (a few seconds), then from zone_index."""
    b, zones = bundle(), _zones_or_404()
    if zone_id not in zones.zones:
        raise HTTPException(404, "unknown zone")
    ver = za.version(b, za.index_sets(b))
    row = await (await conn.execute("SELECT payload FROM zone_index WHERE zone_id = %s AND version = %s",
                                    (zone_id, ver))).fetchone()
    if row:
        return {**row["payload"], "cached": True}
    try:
        payload = await asyncio.to_thread(za.zone_indices, b, zones, zone_id)
    except za.MissingData as exc:
        raise HTTPException(409, str(exc)) from exc
    await conn.execute("INSERT INTO zone_index (zone_id, version, payload) VALUES (%s, %s, %s) ON CONFLICT DO NOTHING",
                       (zone_id, ver, Jsonb(payload)))
    return {**payload, "cached": False}


@router.get("/{zone_id}/lines")
async def zone_lines(zone_id: str, day_kind: Literal["weekday", "saturday", "sunday"] = "weekday"):
    b, zones = bundle(), _zones_or_404()
    if zone_id not in zones.zones:
        raise HTTPException(404, "unknown zone")
    try:
        return za.lines(b, zones, zone_id, day_kind)
    except za.MissingData as exc:
        raise HTTPException(409, str(exc)) from exc


@router.get("/{zone_id}")
async def zone_facts(zone_id: str):
    b, zones = bundle(), _zones_or_404()
    if zone_id not in zones.zones:
        raise HTTPException(404, "unknown zone")
    return za.facts(b, zones, zone_id)


@router.get("/{zone_id}/targets")
async def zone_targets(zone_id: str, sets: str | None = None, neighbours: bool = False):
    b, zones = bundle(), _zones_or_404()
    if zone_id not in zones.zones:
        raise HTTPException(404, "unknown zone")
    try:
        return za.targets_geojson(b, zones, zone_id, _sets(b, sets), neighbours)
    except za.MissingData as exc:
        raise HTTPException(409, str(exc)) from exc


@router.get("/{zone_id}/heatmap")
async def zone_heatmap(zone_id: str, sets: str | None = None, mode: Literal["walk", "bike"] = "walk",
                       neighbours: bool = False, conn=Depends(get_conn)):
    """Street segments with minutes to the nearest target of each set; computed once per inputs version."""
    b, zones = bundle(), _zones_or_404()
    if zone_id not in zones.zones:
        raise HTTPException(404, "unknown zone")
    chosen = _sets(b, sets)
    key, ver = ",".join(chosen), za.version(b, chosen)
    row = await (await conn.execute(
        """SELECT payload FROM zone_heatmap WHERE zone_id = %s AND mode = %s AND targets_key = %s AND neighbours = %s
           AND version = %s""", (zone_id, mode, key, neighbours, ver))).fetchone()
    if row:
        return {**row["payload"], "cached": True}
    try:   # CPU work (Dijkstra over a few thousand edges): off the event loop
        payload = await asyncio.to_thread(za.heatmap, b, zones, zone_id, chosen, mode, neighbours)
    except za.MissingData as exc:
        raise HTTPException(409, str(exc)) from exc
    await conn.execute(
        """INSERT INTO zone_heatmap (zone_id, mode, targets_key, neighbours, version, payload) VALUES (%s,%s,%s,%s,%s,%s)
           ON CONFLICT DO NOTHING""", (zone_id, mode, key, neighbours, ver, Jsonb(payload)))
    return {**payload, "cached": False}
