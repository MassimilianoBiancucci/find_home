"""Test point (probe): what a spot on the map offers. Area score, nearest POIs per category with walking minutes
(one OpenRouteService matrix call, cached per pair in routing_cache; straight-line estimate as fallback) and a
transit itinerary to each of your points (ResRobot, cached per ~100 m origin cell)."""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from psycopg.types.json import Jsonb
from shapely.geometry import Point

from findhome.config.loader import ConfigBundle
from findhome.config.timegrid import Slot, grid_slots, window_slots
from findhome.domain.commute import reference_date
from findhome.geo.area import area_eval, compiled_for
from findhome.geo.crs import point_metric
from findhome.geo.store import load_poi
from findhome.providers.base import LatLon

log = logging.getLogger(__name__)
CANDIDATES_PER_CATEGORY = 5


async def _cache_get(conn, keys: list[str]) -> dict[str, dict]:
    if not keys:
        return {}
    rows = await (await conn.execute(
        "SELECT key, response FROM routing_cache WHERE key = ANY(%s) AND expires_at > now()", (keys,))).fetchall()
    return {r["key"]: r["response"] for r in rows}


async def _cache_put(conn, key: str, provider: str, minutes: float | None, response: dict, ttl_days: int) -> None:
    await conn.execute(
        """INSERT INTO routing_cache (key, provider, minutes, response, expires_at) VALUES (%s,%s,%s,%s,%s)
           ON CONFLICT (key) DO UPDATE SET minutes = EXCLUDED.minutes, response = EXCLUDED.response,
           created_at = now(), expires_at = EXCLUDED.expires_at""",
        (key, provider, minutes, Jsonb(response), datetime.now(UTC) + timedelta(days=ttl_days)))


async def _cache_update(conn, key: str, response: dict) -> None:
    """New drawn geometry for a cached answer; its age and expiry stay."""
    await conn.execute("UPDATE routing_cache SET response = %s WHERE key = %s", (Jsonb(response), key))


def walk_key(origin: LatLon, dest: LatLon) -> str:
    return f"ors|walk|{origin.key()}|{dest.key()}|*"        # same shape as commute.cache_key for timeless providers


async def walk_minutes(conn, registry, origin: LatLon, dests: list[LatLon], ttl_days: int) -> tuple[list[dict], str | None]:
    """Per destination {minutes, distance_m, est}; the second value is the provider error, if any."""
    keys = [walk_key(origin, d) for d in dests]
    cached = await _cache_get(conn, keys)
    out: list[dict | None] = [({**cached[k], "est": False} if k in cached else None) for k in keys]
    missing = [i for i, v in enumerate(out) if v is None]
    error = None
    if missing and registry.ors is not None:
        try:
            res = await registry.ors.matrix(origin, [dests[i] for i in missing])
            for i, r in zip(missing, res, strict=True):
                if r is not None:
                    await _cache_put(conn, keys[i], "ors", r["minutes"], r, ttl_days)
                    out[i] = {**r, "est": False}
        except Exception as exc:  # noqa: BLE001 - fall back to estimates, report why
            error = f"ors: {exc.__class__.__name__}: {exc}"[:200]
            log.warning("walking matrix failed: %s", error)
    elif missing:
        error = "ors: ORS_API_KEY not set (straight-line estimates)"
    for i, v in enumerate(out):
        if v is None:
            out[i] = {"minutes": round(registry.haversine.estimate(origin, dests[i], "walk"), 1), "distance_m": None,
                      "est": True}
    return out, error  # type: ignore[return-value]


async def nearest_pois(conn, registry, bundle: ConfigBundle, origin: LatLon, k: int = 3,
                       categories: list[str] | None = None) -> dict[str, Any]:
    pt = Point(point_metric(origin.lon, origin.lat))
    picks: list[tuple[str, float, dict]] = []
    missing: list[str] = []
    for name, cat in bundle.poi.categories.items():
        if categories and name not in categories:
            continue
        idx = load_poi(name)
        if idx is None:
            missing.append(name)
            continue
        for dist, feat in idx.nearest(pt, CANDIDATES_PER_CATEGORY, within_m=max(3 * cat.radius_m, 3000)):
            picks.append((name, dist, feat))
    dests = [LatLon(f["geometry"]["coordinates"][1], f["geometry"]["coordinates"][0]) for _, _, f in picks]
    walks, error = await walk_minutes(conn, registry, origin, dests,
                                      int(bundle.providers.cache.get("routing_ttl_days", 30)))
    by_cat: dict[str, list[dict]] = {}
    for (name, dist, feat), w in zip(picks, walks, strict=True):
        p = feat["properties"]
        by_cat.setdefault(name, []).append({
            "id": p["id"], "name": p.get("name") or bundle.poi.categories[name].label, "brand": p.get("brand"),
            "lon": feat["geometry"]["coordinates"][0], "lat": feat["geometry"]["coordinates"][1],
            "straight_m": round(dist), **w})
    cats = []
    for name, items in by_cat.items():
        c = bundle.poi.categories[name]
        items.sort(key=lambda x: x["minutes"])
        top = items[:k]
        cats.append({"category": name, "label": c.label, "icon": c.icon, "color": c.color,
                     "max_walk_min": c.max_walk_min, "within": bool(top and c.max_walk_min and top[0]["minutes"] <= c.max_walk_min),
                     "items": top})
    return {"categories": cats, "not_fetched": missing, "walk_error": error}


def _probe_slot(bundle: ConfigBundle, trip) -> Slot:
    """One representative slot per trip: the middle slot of its first window (or of the default grid)."""
    if trip.use_default_grid or not trip.windows:
        slots = grid_slots(bundle.time_model.default_grid)
    else:
        slots = window_slots(trip.windows[0].model_dump(by_alias=True))
    return slots[len(slots) // 2]


@dataclass(frozen=True)
class Destination:
    """Where a transit itinerary goes (or comes from): one of your points, or the nearest target of a service set."""
    id: str
    label: str
    kind: str                     # point | service
    coords: LatLon
    direction: str                # to_point (origin → destination) | from_point
    day_type: str
    slot: Slot
    category: str | None = None


def point_destinations(bundle: ConfigBundle, point_coords: dict[str, LatLon]) -> list[Destination]:
    """Your enabled points with trips: their first trip's direction, day type and middle slot."""
    out = []
    for point in bundle.locations.points:
        coords = point_coords.get(point.id)
        if not point.enabled or coords is None or not point.trips:
            continue
        trip = point.trips[0]
        out.append(Destination(point.id, point.label, "point", coords,
                               "from_point" if trip.direction == "from_point" else "to_point", trip.day_types[0],
                               _probe_slot(bundle, trip), point.category))
    return out


def trip_key(origin: LatLon, d: Destination) -> str:
    """routing_cache key: the home side rounded to ~100 m, so nearby homes share a trip."""
    a, b = (origin, d.coords) if d.direction == "to_point" else (d.coords, origin)
    oc = LatLon(round(a.lat, 3), round(a.lon, 3)) if d.direction == "to_point" else a
    dc = b if d.direction == "to_point" else LatLon(round(b.lat, 3), round(b.lon, 3))
    return f"resrobot-trip|{oc.key(3)}|{dc.key(3)}|{d.day_type}|{d.slot.minutes}|{d.slot.kind}"


async def uncached_trips(conn, origin: LatLon, dests: list[Destination]) -> int:
    """How many of these itineraries would need a ResRobot call (the dry run of Compute transit routes)."""
    keys = [trip_key(origin, d) for d in dests]
    return len(keys) - len(await _cache_get(conn, keys))


async def trips_to(conn, registry, bundle: ConfigBundle, origin: LatLon, dests: list[Destination],
                   today=None) -> list[dict]:
    """One ResRobot itinerary per destination (cached in routing_cache), with legs dressed for the map."""
    tz = ZoneInfo(bundle.time_model.timezone)
    today = today or datetime.now(tz).date()
    skip = set(bundle.time_model.skip_dates)
    ttl = int(bundle.providers.cache.get("routing_ttl_days", 30))
    out = []
    for d in dests:
        a, b = (origin, d.coords) if d.direction == "to_point" else (d.coords, origin)
        dt = bundle.time_model.day_types[d.day_type]
        when = datetime.combine(reference_date(dt.days, dt.prefer, skip, today), time(0), tz) + timedelta(minutes=d.slot.minutes)
        base = {"point_id": d.id, "label": d.label, "category": d.category, "kind": d.kind, "direction": d.direction,
                "day_type": d.day_type, "slot": d.slot.label, "when_is": d.slot.kind}
        key = trip_key(origin, d)
        hit = (await _cache_get(conn, [key])).get(key)
        if hit is not None:
            if hit.get("dressed") != DRESSED:              # cached before the walks were routed: draw it once more
                dress_legs(hit.get("legs") or [], bundle)
                hit["dressed"] = DRESSED
                await _cache_update(conn, key, hit)
            out.append({**base, **hit, "est": False, "cached": True})
            continue
        if registry.resrobot is None:
            out.append({**base, "minutes": round(registry.haversine.estimate(a, b, "transit"), 1), "legs": [], "est": True,
                        "error": "resrobot: TRAFIKLAB_RESROBOT_KEY not set"})
            continue
        try:
            it = await registry.resrobot.itinerary(a, b, when, d.slot.kind)
        except Exception as exc:  # noqa: BLE001 - one failing destination must not hide the others
            out.append({**base, "minutes": round(registry.haversine.estimate(a, b, "transit"), 1), "legs": [],
                        "est": True, "error": f"resrobot: {exc.__class__.__name__}"})
            continue
        if it is None:
            out.append({**base, "minutes": None, "legs": [], "est": False, "error": "no connection found"})
            continue
        dress_legs(it.get("legs") or [], bundle)
        it["dressed"] = DRESSED
        await _cache_put(conn, key, "resrobot", it["minutes"], it, ttl)
        out.append({**base, **it, "est": False, "cached": False})
    return out


async def point_trips(conn, registry, bundle: ConfigBundle, origin: LatLon, point_coords: dict[str, LatLon],
                      today=None) -> list[dict]:
    """The test point's trips to each of your points (first trip, middle slot of its first window)."""
    trips = await trips_to(conn, registry, bundle, origin, point_destinations(bundle, point_coords), today)
    for t in trips:                                     # the test point's payload names the slot kind "kind"
        t["kind"] = t.pop("when_is")
    return trips


DRESSED = 2                    # version of the drawn geometry stored with a cached itinerary (bump to redraw)


def dress_legs(legs: list[dict], bundle: ConfigBundle, streets: bool = True) -> None:
    """Colour each transit leg by its line and follow the real track when the transit layer has the line (through
    the stops in between); walk legs follow the street network where it is mapped (`streets`)."""
    from findhome.geo.build_transit import RAILISH, norm_ref
    from findhome.geo.store import load_transit, load_zones
    from findhome.zone.house import street_path

    transit = load_transit()
    zones = load_zones() if streets else None
    for leg in legs:
        if leg.get("mode") == "walk":
            a, b = leg.get("from") or {}, leg.get("to") or {}
            if zones is not None and a.get("lat") is not None and b.get("lat") is not None and len(leg.get("path") or []) <= 2:
                path = street_path(bundle, zones, (a["lon"], a["lat"]), (b["lon"], b["lat"]))
                leg["on_street"] = bool(path)
                if path:
                    leg["path"] = path
            continue
        ref = norm_ref(str(leg.get("line") or "")) or ""
        if transit and transit.key_for(leg["mode"], ref) is None and leg["mode"] in RAILISH:
            leg["mode"] = next((m for m in RAILISH if transit.key_for(m, ref)), leg["mode"])   # e.g. Roslagsbanan as "lokaltåg"
        key = transit.key_for(leg["mode"], ref) if transit else None
        leg["color"] = (transit.colours.get(key) if transit and key else None) or bundle.transit_colours.colour(leg["mode"], ref)
        a, b = leg.get("from") or {}, leg.get("to") or {}
        if transit and a.get("lat") is not None and b.get("lat") is not None:
            stops = [(p[0], p[1]) for p in (leg.get("path") or []) if p and p[0] is not None]
            via = stops[1:-1] if len(stops) > 2 else []                      # the stops in between (passlist)
            path = transit.leg_path(leg["mode"], ref, (a["lon"], a["lat"]), (b["lon"], b["lat"]), via)
            leg["on_track"] = bool(path)
            if path:
                leg["path"] = path


async def probe(conn, registry, bundle: ConfigBundle, lat: float, lon: float, point_coords: dict[str, LatLon],
                with_trips: bool = True) -> dict[str, Any]:
    origin = LatLon(lat, lon)
    area = compiled_for(bundle.raw.get("search_area"))
    res = area_eval(area, lat, lon)
    area_out = {"defined": area.defined, **res.as_dict()} if area.defined else {"defined": False, "zone": res.zone}
    pois = await nearest_pois(conn, registry, bundle, origin)
    trips = await point_trips(conn, registry, bundle, origin, point_coords) if with_trips else []
    return {"lat": lat, "lon": lon, "area": area_out, "pois": pois, "trips": trips}
