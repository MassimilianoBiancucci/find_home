"""Test point (probe): what a spot on the map offers. Area score, nearest POIs per category with walking minutes
(one OpenRouteService matrix call, cached per pair in routing_cache; straight-line estimate as fallback) and a
transit itinerary to each of your points (ResRobot, cached per ~100 m origin cell)."""
from __future__ import annotations

import logging
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


async def point_trips(conn, registry, bundle: ConfigBundle, origin: LatLon, point_coords: dict[str, LatLon],
                      today=None) -> list[dict]:
    tz = ZoneInfo(bundle.time_model.timezone)
    today = today or datetime.now(tz).date()
    skip = set(bundle.time_model.skip_dates)
    ttl = int(bundle.providers.cache.get("routing_ttl_days", 30))
    out = []
    for point in bundle.locations.points:
        coords = point_coords.get(point.id)
        if not point.enabled or coords is None or not point.trips:
            continue
        trip = point.trips[0]
        direction = "from_point" if trip.direction == "from_point" else "to_point"
        a, b = (origin, coords) if direction == "to_point" else (coords, origin)
        day_type = trip.day_types[0]
        slot = _probe_slot(bundle, trip)
        dt = bundle.time_model.day_types[day_type]
        when = datetime.combine(reference_date(dt.days, dt.prefer, skip, today), time(0), tz) + timedelta(minutes=slot.minutes)
        base = {"point_id": point.id, "label": point.label, "category": point.category, "direction": direction,
                "day_type": day_type, "slot": slot.label, "kind": slot.kind}
        oc = LatLon(round(a.lat, 3), round(a.lon, 3)) if direction == "to_point" else a
        dc = b if direction == "to_point" else LatLon(round(b.lat, 3), round(b.lon, 3))
        key = f"resrobot-trip|{oc.key(3)}|{dc.key(3)}|{day_type}|{slot.minutes}|{slot.kind}"
        hit = (await _cache_get(conn, [key])).get(key)
        if hit is not None:
            out.append({**base, **hit, "est": False, "cached": True})
            continue
        if registry.resrobot is None:
            out.append({**base, "minutes": round(registry.haversine.estimate(a, b, "transit"), 1), "legs": [], "est": True,
                        "error": "resrobot: TRAFIKLAB_RESROBOT_KEY not set"})
            continue
        try:
            it = await registry.resrobot.itinerary(a, b, when, slot.kind)
        except Exception as exc:  # noqa: BLE001 - one failing point must not hide the others
            out.append({**base, "minutes": round(registry.haversine.estimate(a, b, "transit"), 1), "legs": [],
                        "est": True, "error": f"resrobot: {exc.__class__.__name__}"})
            continue
        if it is None:
            out.append({**base, "minutes": None, "legs": [], "est": False, "error": "no connection found"})
            continue
        await _cache_put(conn, key, "resrobot", it["minutes"], it, ttl)
        out.append({**base, **it, "est": False, "cached": False})
    for trip in out:
        dress_legs(trip.get("legs") or [], bundle)
    return out


def dress_legs(legs: list[dict], bundle: ConfigBundle) -> None:
    """Colour each transit leg by its line and follow the real track when the transit layer has the line."""
    from findhome.geo.build_transit import RAILISH, norm_ref
    from findhome.geo.store import load_transit

    transit = load_transit()
    for leg in legs:
        if leg.get("mode") == "walk":
            continue
        ref = norm_ref(str(leg.get("line") or "")) or ""
        if transit and (leg["mode"], ref) not in transit.lines and leg["mode"] in RAILISH:
            leg["mode"] = next((m for m in RAILISH if (m, ref) in transit.lines), leg["mode"])   # e.g. Roslagsbanan as "lokaltåg"
        leg["color"] = (transit.colours.get((leg["mode"], ref)) if transit else None) or bundle.transit_colours.colour(leg["mode"], ref)
        a, b = leg.get("from") or {}, leg.get("to") or {}
        if transit and a.get("lat") is not None and b.get("lat") is not None:
            path = transit.leg_path(leg["mode"], ref, (a["lon"], a["lat"]), (b["lon"], b["lat"]))
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
