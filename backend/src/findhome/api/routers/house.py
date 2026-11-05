"""House analysis of a listing (the house page and the 3D house view).

GET  /api/listings/{id}/location  walks, paths and the house indices from the exact address (local datasets only,
                                  cached in listing_location), the free station estimate to your points, the zone's
                                  indices for comparison and insight lines. No API calls.
POST /api/listings/{id}/transit   exact ResRobot itineraries to your points and to the nearest target of each
                                  service set ("Compute transit routes"); `dry=true` only counts the calls.
"""
from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from psycopg.types.json import Jsonb

from findhome.api.routers.zone import index_percentiles, stored_zone_indices
from findhome.api.state import bundle, registry
from findhome.config.timegrid import Slot, parse_hhmm
from findhome.core.db import get_conn
from findhome.db import repo
from findhome.domain.commute import resolve_point_coords
from findhome.domain.connectivity import aggregate, inputs_hash
from findhome.domain.probe import Destination, point_destinations, trips_to, uncached_trips
from findhome.geo.store import load_zones
from findhome.providers.base import LatLon
from findhome.zone import analysis as za
from findhome.zone import house as zh

router = APIRouter(prefix="/api/listings", tags=["house analysis"])


async def _listing_with_coords(conn, short_id: str) -> dict:
    L = await repo.get_listing(conn, short_id)
    if L.get("lat") is None or L.get("lon") is None:
        raise HTTPException(409, "the listing has no coordinates yet (recompute scores to geocode its address)")
    return L


async def house_payload(conn, b, L: dict) -> dict[str, Any]:
    """The cached house analysis of a listing, computed (a few seconds) and stored when missing."""
    zones = load_zones()
    if zones is None:
        raise HTTPException(409, "zones not built yet: run `findhome geo fetch zones`")
    lat, lon = float(L["lat"]), float(L["lon"])
    ver = zh.version(b, lat, lon)
    row = await (await conn.execute("SELECT payload FROM listing_location WHERE listing_id = %s AND version = %s",
                                    (L["id"], ver))).fetchone()
    if row:
        return {**row["payload"], "cached": True}
    try:
        payload = await asyncio.to_thread(zh.house_analysis, b, zones, lat, lon)
    except zh.OutsideZones as exc:
        raise HTTPException(409, str(exc)) from exc
    except za.MissingData as exc:
        raise HTTPException(409, str(exc)) from exc
    await conn.execute("DELETE FROM listing_location WHERE listing_id = %s", (L["id"],))
    await conn.execute("INSERT INTO listing_location (listing_id, version, payload) VALUES (%s, %s, %s)",
                       (L["id"], ver, Jsonb(payload)))
    return {**payload, "cached": False}


def _listing_minutes(commute: list[dict]) -> dict[str, float]:
    """Per point, the listing's own transit minutes (window-weighted median), when computed."""
    per: dict[str, list[tuple[float, float]]] = {}
    for c in commute:
        if c.get("median_min") is None or c.get("mode") not in (None, "transit"):
            continue
        per.setdefault(c["point_id"], []).append((float(c["median_min"]), float(c.get("window_weight") or 1)))
    return {p: round(sum(m * w for m, w in v) / (sum(w for _, w in v) or 1), 1) for p, v in per.items()}


@router.get("/{short_id}/location")
async def location(short_id: str, conn=Depends(get_conn)):
    b = bundle()
    L = await _listing_with_coords(conn, short_id)
    house = await house_payload(conn, b, L)
    zone_id = house["zone"]["id"]
    ih = inputs_hash(b)
    labels = {p.id: p.label for p in b.locations.points if p.enabled and p.trips}

    keys = list(house.get("station_walks") or {})
    st_rows = await (await conn.execute(
        """SELECT station_key, point_id, direction, day_type, window_label, window_weight, minutes FROM centroid_commute
           WHERE inputs_hash = %s AND station_key = ANY(%s) AND minutes IS NOT NULL""", (ih, keys))).fetchall() if keys else []
    zc = await (await conn.execute(
        """SELECT zone_id, point_id, direction, day_type, window_label, window_weight, minutes, estimate FROM zone_commute
           WHERE inputs_hash = %s AND minutes IS NOT NULL""", (ih,))).fetchall()
    est = zh.estimates(house.get("station_walks") or {}, st_rows, [r for r in zc if r["zone_id"] == zone_id], labels)
    agg = aggregate(zc, b)
    all_zones: dict[str, list[float]] = {}
    for z in agg.values():
        for pid, m in z["by_point"].items():
            all_zones.setdefault(pid, []).append(m)
    zone_minutes = (agg.get(zone_id) or {}).get("by_point", {})
    listing_commute = _listing_minutes(await repo.commute_for(conn, L["id"], b.config_hash))

    zones = load_zones()
    zone_index: dict[str, Any] | None
    try:
        zi = await stored_zone_indices(conn, b, zones, zone_id)
        zone_index = {k: zi.get(k) for k in ("transport", "services", "combined", "services_detail", "derivation",
                                              "density", "choice_within_min")}
        zone_index["percentiles"] = await index_percentiles(conn, b, zone_id)
    except za.MissingData:
        zone_index = None
    return {**house, "listing": {"short_id": L["short_id"], "lat": float(L["lat"]), "lon": float(L["lon"])},
            "estimates": est, "listing_commute": listing_commute, "zone_index": zone_index,
            "insights": zh.insights(house, (zone_index or {}).get("services_detail"), est, zone_minutes, all_zones,
                                    listing_commute)}


def _service_destinations(b, house: dict[str, Any]) -> list[Destination]:
    """The nearest target of each service set (from the cached walks), reached at the configured weekday time."""
    hc = zh.house_cfg(b)
    services = set(b.zone.indices.get("services", {}).get("sets", []))
    slot = Slot(parse_hhmm(str(hc.get("services_depart", "10:00"))), 1.0, "depart_at", "services")
    day = "weekday" if "weekday" in b.time_model.day_types else next(iter(b.time_model.day_types))
    out = []
    for sid, w in house["walks"].items():
        if sid not in services or not w.get("target_lonlat"):
            continue
        lon, lat = w["target_lonlat"]
        label = f"{house['set_labels'].get(sid, sid)} · {w['target']}" if w.get("target") else house["set_labels"].get(sid, sid)
        out.append(Destination(f"service:{sid}", label, "service", LatLon(lat, lon), "to_point", day, slot, sid))
    return out


@router.post("/{short_id}/transit")
async def transit(short_id: str, dry: bool = False, conn=Depends(get_conn)):
    """Itineraries from the house (ResRobot, cached per ~100 m cell for routing_ttl_days). With dry=true: the call
    count only. Service rows say whether transit beats walking to the same target."""
    b, reg = bundle(), registry()
    L = await _listing_with_coords(conn, short_id)
    house = await house_payload(conn, b, L)
    coords = await resolve_point_coords(conn, reg, b.locations.points, int(b.providers.cache.get("geocode_ttl_days", 365)))
    dests = point_destinations(b, coords) + _service_destinations(b, house)
    origin = LatLon(float(L["lat"]), float(L["lon"]))
    calls = await uncached_trips(conn, origin, dests)
    summary = {"destinations": len(dests), "calls": calls, "cached": len(dests) - calls,
               "ttl_days": int(b.providers.cache.get("routing_ttl_days", 30)), "provider": "resrobot"}
    if dry:
        return summary
    trips = await trips_to(conn, reg, b, origin, dests)
    for t in trips:
        if t["kind"] == "service":
            walk = house["walks"].get(t["category"], {}).get("minutes")
            t["walk_min"] = walk
            t["beats_walk"] = bool(t.get("minutes") is not None and walk is not None and t["minutes"] < walk)
    return {**summary, "trips": trips}
