"""Puts the zone analysis together: loads the datasets a zone needs, runs the heatmap engine and shapes the answer.

No database here: the API router caches the payloads (zone_heatmap) and the CLI prints them.
"""
from __future__ import annotations

import hashlib
import json
from collections import Counter
from typing import Any

from shapely.geometry import mapping

from findhome.config.loader import ConfigBundle
from findhome.core.paths import data_dir
from findhome.geo.crs import points_wgs84, to_wgs84
from findhome.geo.store import ZoneSet, load_poi, load_timetable
from findhome.zone.extent import Extent, extent, neighbours
from findhome.zone.heatmap import HeatmapParams, compute
from findhome.zone.homes import load_homes
from findhome.zone.network import EDGE_GEOM, EDGE_HW, NetMode, load_network
from findhome.zone.targets import stop_modes, target_points


class MissingData(Exception):
    """A dataset the analysis needs is not built yet; the message says which command builds it."""


def parse_sets(bundle: ConfigBundle, sets: list[str] | str | None) -> list[str]:
    items = [s for s in (sets.split(",") if isinstance(sets, str) else sets or []) if s]
    unknown = [s for s in items if s not in bundle.zone.target_sets]
    if unknown:
        raise ValueError(f"unknown target sets {unknown} (zone.yaml target_sets: {', '.join(bundle.zone.target_sets)})")
    return sorted(set(items)) or ["rail", "bus"]


def params(bundle: ConfigBundle, mode: NetMode) -> HeatmapParams:
    z = bundle.zone
    return HeatmapParams(mode, z.speeds_mps[mode], z.cutoff_min * 60, z.snap_max_m, dict(z.factors))


def _meta(name: str) -> str:
    p = data_dir() / "geo" / name / "meta.json"
    return p.read_text(encoding="utf-8") if p.exists() else ""


# zone.yaml keys applied after the stored analyses (from cached rows, at read time): editing them must not throw the
# zone indices and house analyses away
NOT_HASHED = (("house", "reach"),)


def _hashed_zone(raw: dict) -> dict:
    out = {**raw}
    for section, key in NOT_HASHED:
        if isinstance(out.get(section), dict) and key in out[section]:
            out[section] = {k: v for k, v in out[section].items() if k != key}
    return out


def version(bundle: ConfigBundle, sets: list[str]) -> str:
    """Changes when a dataset is rebuilt or zone.yaml (but NOT_HASHED) / the POI files the sets use change."""
    pois = sorted({c for s in sets for c in bundle.zone.target_sets[s].poi})
    poi_mtimes = [(c, (data_dir() / "geo" / "poi" / f"{c}.geojson").stat().st_mtime)
                  for c in pois if (data_dir() / "geo" / "poi" / f"{c}.geojson").exists()]
    blob = json.dumps([_hashed_zone(bundle.raw["zone"]), bundle.raw.get("poi"), _meta("network"), _meta("buildings"), _meta("timetable"),
                       poi_mtimes], sort_keys=True, default=str)
    return hashlib.sha256(blob.encode()).hexdigest()[:16]


def _extent(bundle: ConfigBundle, zones: ZoneSet, zone_id: str, with_neighbours: bool, mode: NetMode) -> Extent:
    if zone_id not in zones.zones:
        raise KeyError(zone_id)
    p = params(bundle, mode)
    return extent(zones, zone_id, with_neighbours, p.speed_mps * p.cutoff_s)


def targets_for(bundle: ConfigBundle, ext: Extent, sets: list[str]):
    tt = load_timetable()
    if tt is None and any(bundle.zone.target_sets[s].stops for s in sets):
        raise MissingData("no timetable yet: run `findhome geo fetch timetable`")
    return {s: target_points(bundle.zone.target_sets[s], ext.search, tt, load_poi) for s in sets}


def heatmap(bundle: ConfigBundle, zones: ZoneSet, zone_id: str, sets: list[str], mode: NetMode,
            with_neighbours: bool) -> dict[str, Any]:
    ext = _extent(bundle, zones, zone_id, with_neighbours, mode)
    net = load_network(ext.kommuner)
    if net is None:
        raise MissingData("no walking network yet: run `findhome geo fetch network`")
    found = targets_for(bundle, ext, sets)
    hm = compute(net, ext, {s: [p for p, _ in pts] for s, pts in found.items()}, params(bundle, mode),
                 load_homes(ext.kommuner))
    features = []
    for idx, per in hm.segments:
        e = net.edges[idx]
        geom = e[EDGE_GEOM]
        coords = points_wgs84([c[0] for c in geom], [c[1] for c in geom])
        t = min(per.values()) if per else None
        features.append({"type": "Feature", "geometry": {"type": "LineString", "coordinates": coords},
                         "properties": {"t": t, **{f"t_{s}": v for s, v in per.items()}, "hw": e[EDGE_HW]}})
    return {"zone_id": zone_id, "zone_ids": list(ext.zone_ids), "mode": mode, "sets": sets,
            "neighbours": with_neighbours, "bins_min": bundle.zone.bins_min, "cutoff_min": bundle.zone.cutoff_min,
            "summary": hm.summary, "homes": hm.homes, "homes_source": "buildings" if load_homes(ext.kommuner) else "network",
            "segments": {"type": "FeatureCollection", "features": features}}


def targets_geojson(bundle: ConfigBundle, zones: ZoneSet, zone_id: str, sets: list[str],
                    with_neighbours: bool) -> dict[str, Any]:
    ext = _extent(bundle, zones, zone_id, with_neighbours, "walk")
    out = {}
    for s, pts in targets_for(bundle, ext, sets).items():
        xy = points_wgs84([p.x for p, _ in pts], [p.y for p, _ in pts]) if pts else []
        out[s] = {"type": "FeatureCollection", "features": [
            {"type": "Feature", "geometry": {"type": "Point", "coordinates": c}, "properties": {"name": name, "set": s}}
            for c, (_, name) in zip(xy, pts, strict=True)]}
    return out


def facts(bundle: ConfigBundle, zones: ZoneSet, zone_id: str) -> dict[str, Any]:
    """Name, outline, neighbours, and counts of stops by mode and POIs by target set inside the zone."""
    z = zones.zones[zone_id]
    tt = load_timetable()
    modes: Counter = Counter()
    lines: set[str] = set()
    if tt is not None:
        for i in tt.tree.query(z.geom, predicate="intersects"):
            sid = tt.ids[int(i)]
            modes.update(stop_modes(tt, sid))
            lines.update(tt.stops[sid].get("lines", []))
    poi_counts = {}
    for sid, ts in bundle.zone.target_sets.items():
        if ts.poi:
            poi_counts[sid] = len(target_points(ts.model_copy(update={"stops": []}), z.geom, None, load_poi))
    return {"zone": {"id": z.id, "name": z.name, "district": z.district, "kommun": z.kommun,
                     "area_km2": z.props.get("area_km2")},
            "outline": mapping(to_wgs84(z.geom)), "neighbours": [
                {"id": n, "name": zones.zones[n].name} for n in neighbours(zones, zone_id)],
            "stops_by_mode": dict(modes), "lines": len(lines), "poi": poi_counts,
            "timetable": tt.source if tt else None,
            "target_sets": {k: v.label for k, v in bundle.zone.target_sets.items()}}


def zone_at(zones: ZoneSet, lat: float, lon: float) -> dict[str, str] | None:
    from shapely.geometry import Point

    from findhome.geo.crs import point_metric

    z = zones.containing(Point(point_metric(lon, lat)))
    return {"id": z.id, "name": z.name, "district": z.district} if z else None


MODE_ORDER = ("metro", "commuter_rail", "local_rail", "tram", "train", "ferry", "bus", "other")


def _lines_in(bundle: ConfigBundle, tt, geoms, day_kind: str, skip: set[str] | None = None) -> list[dict[str, Any]]:
    """Lines serving the stops inside geoms, with the stops' names and the departures per hour of that line there."""
    by_line: dict[str, dict[str, Any]] = {}
    for geom in geoms:
        for i in tt.tree.query(geom, predicate="intersects"):
            sid = tt.ids[int(i)]
            stop = tt.stops[sid]
            deps = tt.departures_by_line(sid, day_kind)
            for lid in stop.get("lines", []):
                if lid not in tt.lines or (skip and lid in skip):
                    continue
                ln = tt.lines[lid]
                e = by_line.setdefault(lid, {"id": lid, "mode": ln["mode"], "ref": ln.get("ref"), "name": ln.get("name"),
                                             "colour": bundle.transit_colours.colour(ln["mode"], ln.get("ref")),
                                             "stops": [], "departures": [0] * 24 if deps is not None else None})
                name = stop.get("name") or sid
                if name not in e["stops"]:
                    e["stops"].append(name)
                if deps is not None and lid in deps:
                    e["departures"] = [a + b for a, b in zip(e["departures"], deps[lid], strict=True)]
    out = list(by_line.values())
    for e in out:
        e["peak_per_hour"] = max(e["departures"]) if e["departures"] else None
    def ref_key(e: dict[str, Any]) -> tuple:
        r = str(e["ref"] or "")
        return (MODE_ORDER.index(e["mode"]) if e["mode"] in MODE_ORDER else 99, int(r) if r.isdigit() else 9999, r)
    return sorted(out, key=ref_key)


def lines(bundle: ConfigBundle, zones: ZoneSet, zone_id: str, day_kind: str = "weekday") -> dict[str, Any]:
    """Lines at the zone's stops, then the extra lines at the neighbouring zones' stops."""
    tt = load_timetable()
    if tt is None:
        raise MissingData("no timetable yet: run `findhome geo fetch timetable`")
    own = _lines_in(bundle, tt, [zones.zones[zone_id].geom], day_kind)
    near = _lines_in(bundle, tt, [zones.zones[n].geom for n in neighbours(zones, zone_id)], day_kind,
                     skip={e["id"] for e in own})
    return {"zone_id": zone_id, "day_kind": day_kind, "source": tt.source, "ref_date": tt.ref_dates.get(day_kind),
            "lines": own, "nearby_lines": near}


def index_sets(bundle: ConfigBundle) -> list[str]:
    """Target sets the indices measure: rail and bus, plus the services sets of zone.yaml indices."""
    return sorted({"rail", "bus", *bundle.zone.indices.get("services", {}).get("sets", [])} & set(bundle.zone.target_sets))


def set_weights(bundle: ConfigBundle) -> dict[str, float]:
    """Weight of each target set in the services index: the highest poi.yaml weight among its categories
    (sets without POI categories, such as stop sets, weigh 1)."""
    cats = bundle.poi.categories
    out = {}
    for sid, ts in bundle.zone.target_sets.items():
        ws = [cats[c].weight for c in ts.poi if c in cats]
        out[sid] = max(ws) if ws else 1.0
    return out


def density(bundle: ConfigBundle, zones: ZoneSet, zone_id: str, homes: list[tuple[float, float, float]]) -> dict[str, Any]:
    """Per services set: POIs inside the zone, per 1,000 homes (home units: buildings weighted by floors) and per km²."""
    from shapely.geometry import Point
    from shapely.prepared import prep

    z = zones.zones[zone_id]
    inside = prep(z.geom)
    home_units = sum(w for x, y, w in homes if inside.contains(Point(x, y)))
    area = z.props.get("area_km2") or (z.geom.area / 1e6)
    per = float((bundle.zone.density or {}).get("per_homes", 1000))
    out: dict[str, Any] = {}
    for sid in bundle.zone.indices.get("services", {}).get("sets", []):
        ts = bundle.zone.target_sets.get(sid)
        if ts is None or not ts.poi:
            continue
        n = len(target_points(ts.model_copy(update={"stops": []}), z.geom, None, load_poi))
        out[sid] = {"count": n, "per_1000_homes": round(per * n / home_units, 2) if home_units else None,
                    "per_km2": round(n / area, 2) if area else None}
    return {"home_units": round(home_units, 1), "area_km2": round(area, 3) if area else None, "sets": out}


def zone_indices(bundle: ConfigBundle, zones: ZoneSet, zone_id: str) -> dict[str, Any]:
    from findhome.zone.heatmap import ExtentGraph
    from findhome.zone.indices import ServiceInput, choice_cfg, indices, service_set_score
    from findhome.zone.measure import measure

    if not bundle.zone.indices:
        raise MissingData("zone.yaml has no indices block")
    sets = index_sets(bundle)
    ext = _extent(bundle, zones, zone_id, False, "walk")
    net = load_network(ext.kommuner)
    if net is None:
        raise MissingData("no walking network yet: run `findhome geo fetch network`")
    p = params(bundle, "walk")
    found = targets_for(bundle, ext, sets)
    homes = load_homes(ext.kommuner)
    eg = ExtentGraph(net, ext, p, homes)
    comps, detail = measure(bundle, ext, eg, load_timetable(), {s: [pt for pt, _ in v] for s, v in found.items()}, p)
    weights = set_weights(bundle)
    ix = indices(comps, bundle.zone.indices, weights, (bundle.zone.combined or {}).get("parts"))
    services_detail = {sid: {"label": bundle.zone.target_sets[sid].label, "walk_min": comps.services_min.get(sid),
                             "choice": comps.services_choice.get(sid), "weight": weights.get(sid, 1.0),
                             "score": service_set_score(ServiceInput(comps.services_min.get(sid), comps.services_choice.get(sid)),
                                                        bundle.zone.indices)}
                       for sid in bundle.zone.indices["services"]["sets"] if sid in comps.services_min}
    return {"zone_id": zone_id, **ix, "services_detail": services_detail,
            "choice_within_min": choice_cfg(bundle.zone.indices)["within_min"],
            "density": density(bundle, zones, zone_id, homes),
            "measured": {"rail_access_min": comps.rail_access_min, "bus_access_min": comps.bus_access_min,
                         "coverage": comps.coverage, "lines": comps.lines, "frequency": comps.frequency,
                         "services_min": comps.services_min, "services_choice": comps.services_choice, **detail}}


def percentiles(values: dict[str, float | None]) -> dict[str, float | None]:
    """Rank of each zone among the zones with a value, 0 (lowest) to 100 (highest)."""
    have = sorted(v for v in values.values() if v is not None)
    n = len(have)
    if n == 0:
        return dict.fromkeys(values)
    from bisect import bisect_left, bisect_right

    return {k: None if v is None else round(100 * (bisect_left(have, v) + bisect_right(have, v)) / (2 * n), 1)
            for k, v in values.items()}
