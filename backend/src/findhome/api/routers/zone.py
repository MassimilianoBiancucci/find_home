"""Zone analysis (Map → Zone): facts, targets and walking / cycling heatmaps of one zone, cached in zone_heatmap."""
from __future__ import annotations

import asyncio
from datetime import date
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
    """Every zone's stored indices (transport, services, combined) and POI density for the current inputs, with
    percentiles (the map colours by them). `window` picks one time window for transport and combined."""
    b = bundle()
    ver = za.version(b, za.index_sets(b))
    rows = await (await conn.execute("SELECT zone_id, payload FROM zone_index WHERE version = %s", (ver,))).fetchall()

    def value(pl: dict, key: str):
        if key == "services":                       # services has no time window
            return pl.get(key)
        return pl["windows"].get(window, {}).get(key) if window else pl.get(key)

    out: dict[str, dict] = {}
    for key in ("transport", "services", "combined"):
        vals = {r["zone_id"]: value(r["payload"], key) for r in rows}
        pct = za.percentiles(vals)
        for zid, v in vals.items():
            out.setdefault(zid, {})[key] = {"value": v, "percentile": pct[zid]}
    # POI density per services set and unit, with percentiles (Explore heatmaps)
    sets = sorted({s for r in rows for s in ((r["payload"].get("density") or {}).get("sets") or {})})
    for sid in sets:
        for unit in ("count", "per_1000_homes", "per_km2"):
            vals = {r["zone_id"]: ((r["payload"].get("density") or {}).get("sets") or {}).get(sid, {}).get(unit) for r in rows}
            pct = za.percentiles(vals)
            for zid, v in vals.items():
                out[zid].setdefault("density", {}).setdefault(sid, {})[unit] = {"value": v, "percentile": pct[zid]}
    windows = list((b.zone.indices or {}).get("windows", {}))
    return {"version": ver, "window": window, "windows": windows, "density_sets": sets, "zones": out, "count": len(rows),
            "zone_count": len(_zones_or_404().zones)}


_listing_zone: dict[tuple, str | None] = {}           # (listing id, lat, lon) → zone id (zones change rarely)


@router.get("/stats")
async def listing_stats(statuses: str | None = None, seen: Literal["active", "gone", "all"] = "all", active_days: int = 14,
                        scored: Literal["passing", "rejected", "all"] = "all",
                        posted_from: date | None = None, posted_to: date | None = None,
                        first_seen_from: date | None = None, first_seen_to: date | None = None,
                        rent_min: float | None = None, rent_max: float | None = None,
                        size_min: float | None = None, size_max: float | None = None,
                        rooms_min: float | None = None, rooms_max: float | None = None, min_n: int = 3,
                        conn=Depends(get_conn)):
    """Listing statistics per zone for the Explore heatmaps: count, per km², and (from min_n listings) median, p25
    and p75 of rent, rent per m², size and rooms. The filters choose which listings count."""
    from shapely.geometry import Point

    from findhome.domain.listing_stats import StatsFilter, where_sql, zone_stats
    from findhome.geo.crs import point_metric

    b, zones = bundle(), _zones_or_404()
    f = StatsFilter(tuple(x for x in (statuses or "").split(",") if x), seen, active_days, scored, posted_from, posted_to,
                    first_seen_from, first_seen_to, rent_min, rent_max, size_min, size_max, rooms_min, rooms_max, min_n)
    where, args = where_sql(f)
    rows = await (await conn.execute(
        f"""SELECT l.id, l.lat, l.lon, l.rent_sek, l.size_m2, l.rooms_rok FROM listings l
            LEFT JOIN scores s ON s.listing_id = l.id AND s.config_hash = %s WHERE {where}""",
        (b.config_hash, *args))).fetchall()
    data, points = [], []
    for r in rows:
        key = (r["id"], float(r["lat"]), float(r["lon"]))
        if key not in _listing_zone:
            z = zones.containing(Point(point_metric(key[2], key[1])))
            _listing_zone[key] = z.id if z else None
        data.append({"zone_id": _listing_zone[key], "rent": r["rent_sek"], "size": r["size_m2"], "rooms": r["rooms_rok"]})
        points.append([round(key[2], 5), round(key[1], 5)])
    areas = {zid: z.props.get("area_km2") or z.geom.area / 1e6 for zid, z in zones.zones.items()}
    stats = zone_stats(data, areas, min_n)
    return {"listings": len(rows), "in_zones": sum(1 for d in data if d["zone_id"]), "min_n": min_n,
            "zones": stats, "zone_count": len(zones.zones),
            "points": points}                     # [lon, lat] of the counted listings (density heatmap)


async def stored_zone_indices(conn, b, zones, zone_id: str) -> dict:
    """A zone's indices from zone_index, computed and stored first when missing (a few seconds, no API calls).
    Raises za.MissingData when a dataset is not built."""
    ver = za.version(b, za.index_sets(b))
    row = await (await conn.execute("SELECT payload FROM zone_index WHERE zone_id = %s AND version = %s",
                                    (zone_id, ver))).fetchone()
    if row:
        return {**row["payload"], "cached": True}
    payload = await asyncio.to_thread(za.zone_indices, b, zones, zone_id)
    await conn.execute("INSERT INTO zone_index (zone_id, version, payload) VALUES (%s, %s, %s) ON CONFLICT DO NOTHING",
                       (zone_id, ver, Jsonb(payload)))
    return {**payload, "cached": False}


async def index_percentiles(conn, b, zone_id: str) -> dict[str, float | None]:
    """The zone's percentile among the stored zones for transport, services and combined (day average)."""
    ver = za.version(b, za.index_sets(b))
    rows = await (await conn.execute("SELECT zone_id, payload FROM zone_index WHERE version = %s", (ver,))).fetchall()
    out: dict[str, float | None] = {}
    for key in ("transport", "services", "combined"):
        out[key] = za.percentiles({r["zone_id"]: r["payload"].get(key) for r in rows}).get(zone_id)
    return out


@router.get("/{zone_id}/indices")
async def zone_indices(zone_id: str, conn=Depends(get_conn)):
    """Indices of one zone (transport, services, combined, with derivations, per-set services detail and POI
    density); computed once per inputs version (a few seconds), then from zone_index."""
    b, zones = bundle(), _zones_or_404()
    if zone_id not in zones.zones:
        raise HTTPException(404, "unknown zone")
    try:
        return await stored_zone_indices(conn, b, zones, zone_id)
    except za.MissingData as exc:
        raise HTTPException(409, str(exc)) from exc


@router.get("/{zone_id}/centroids")
async def zone_centroids(zone_id: str, conn=Depends(get_conn)):
    """The zone's connectivity centroids (stations), the share of its homes within the walk limit of each, and the
    patterns of the latest station refresh: which stations and groups the homes' best routes start from."""
    from findhome.db.connectivity_repo import read_patterns
    from findhome.domain.connectivity import inputs_hash
    from findhome.zone.centroid_build import load_centroids

    b = bundle()
    doc = load_centroids()
    if doc is None or zone_id not in doc["zones"]:
        raise HTTPException(409, "no centroids yet: run `findhome zone centroids`")
    z = doc["zones"][zone_id]
    limit = b.zone.centroids.get("walk_min", 5) * 60
    total = sum(w for w, _ in z["homes"]) or 1.0
    out = []
    for i, c in enumerate(z["centroids"]):
        st = doc["stations"][c["key"]]
        near = sum(w for w, walks in z["homes"] if walks.get(str(i), 1e9) <= limit)
        out.append({**c, **st, "share_within_walk": round(near / total, 3)})
    patterns = await read_patterns(conn, inputs_hash(b), zone_id)
    return {"zone_id": zone_id, "walk_min": limit / 60, "range_m": b.zone.centroids.get("range_m", 400),
            "coverage": z["coverage"], "homes": len(z["homes"]),
            "centroids": out, "patterns": patterns}


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
