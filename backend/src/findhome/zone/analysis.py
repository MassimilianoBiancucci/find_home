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


def version(bundle: ConfigBundle, sets: list[str]) -> str:
    """Changes when a dataset is rebuilt or zone.yaml / the POI files the sets use change."""
    pois = sorted({c for s in sets for c in bundle.zone.target_sets[s].poi})
    poi_mtimes = [(c, (data_dir() / "geo" / "poi" / f"{c}.geojson").stat().st_mtime)
                  for c in pois if (data_dir() / "geo" / "poi" / f"{c}.geojson").exists()]
    blob = json.dumps([bundle.raw["zone"], _meta("network"), _meta("buildings"), _meta("timetable"), poi_mtimes],
                      sort_keys=True, default=str)
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
