"""Loads the built geodata files under data/geo/ once per process and reloads them when they change."""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from shapely.geometry import Point, shape
from shapely.geometry.base import BaseGeometry
from shapely.strtree import STRtree

from findhome.core.paths import data_dir
from findhome.geo.crs import to_metric

ZONES_FILE = "geo/zones.geojson"


@dataclass
class Zone:
    id: str
    name: str
    kommun_code: str
    kommun: str
    district: str
    props: dict[str, Any]
    geom: BaseGeometry          # EPSG:3006


@dataclass
class ZoneSet:
    zones: dict[str, Zone]
    tree: STRtree
    order: list[str]
    mtime: float
    path: Path

    def containing(self, pt) -> Zone | None:
        for i in self.tree.query(pt, predicate="intersects"):
            return self.zones[self.order[int(i)]]
        return None


_cache: dict[str, ZoneSet] = {}


def zones_path() -> Path:
    return data_dir() / ZONES_FILE


def load_zones(path: Path | None = None) -> ZoneSet | None:
    """None when the zones file has not been built yet (`findhome geo fetch zones`)."""
    p = path or zones_path()
    if not p.exists():
        return None
    mtime = p.stat().st_mtime
    hit = _cache.get(str(p))
    if hit and hit.mtime == mtime:
        return hit
    fc = json.loads(p.read_text(encoding="utf-8"))
    zones: dict[str, Zone] = {}
    for f in fc["features"]:
        pr = f["properties"]
        zones[pr["zone_id"]] = Zone(pr["zone_id"], pr["name"], pr.get("kommun_code", ""), pr.get("kommun", ""),
                                    pr.get("district", ""), pr, to_metric(shape(f["geometry"])))
    order = list(zones)
    zs = ZoneSet(zones, STRtree([zones[z].geom for z in order]), order, mtime, p)
    _cache[str(p)] = zs
    return zs


def read_geojson(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


@dataclass
class PoiIndex:
    category: str
    features: list[dict[str, Any]]
    points: list[Any]               # shapely Points in EPSG:3006
    tree: STRtree
    mtime: float

    def nearest(self, pt, k: int = 5, within_m: float = 3000) -> list[tuple[float, dict[str, Any]]]:
        idx = self.tree.query(pt.buffer(within_m))
        if len(idx) == 0:
            idx = self.tree.query_nearest(pt)
        found = sorted((self.points[int(i)].distance(pt), self.features[int(i)]) for i in idx)
        return found[:k]


_poi_cache: dict[str, PoiIndex] = {}


def load_poi(category: str) -> PoiIndex | None:
    """None when the category has not been fetched yet (`findhome geo fetch poi`)."""
    from shapely.geometry import Point

    p = data_dir() / "geo" / "poi" / f"{category}.geojson"
    if not p.exists():
        return None
    mtime = p.stat().st_mtime
    hit = _poi_cache.get(category)
    if hit and hit.mtime == mtime:
        return hit
    feats = read_geojson(p)["features"]
    if not feats:
        return None
    from findhome.geo.crs import point_metric

    pts = [Point(point_metric(*f["geometry"]["coordinates"])) for f in feats]
    idx = PoiIndex(category, feats, pts, STRtree(pts), mtime)
    _poi_cache[category] = idx
    return idx


@dataclass
class TransitIndex:
    """Lines per (mode, ref) in EPSG:3006, to draw itinerary legs along the real track."""
    lines: dict[tuple[str, str], BaseGeometry]
    colours: dict[tuple[str, str], str]
    mtime: float

    def leg_path(self, mode: str, ref: str | None, a: tuple[float, float], b: tuple[float, float],
                 max_off_m: float = 300) -> list[list[float]] | None:
        """[lon, lat] points along the line between boarding a and alighting b ([lon, lat]); None if not found."""
        from shapely.geometry import LineString, Point
        from shapely.ops import substring

        from findhome.geo.crs import point_metric, to_wgs84

        geom = self.lines.get((mode, ref or ""))
        if geom is None:
            return None
        pa, pb = Point(point_metric(*a)), Point(point_metric(*b))
        parts = list(getattr(geom, "geoms", [geom]))
        best = min(parts, key=lambda g: g.distance(pa) + g.distance(pb))
        if best.distance(pa) > max_off_m or best.distance(pb) > max_off_m:
            return None
        da, db = best.project(pa), best.project(pb)
        seg = substring(best, min(da, db), max(da, db))
        if not isinstance(seg, LineString) or seg.length == 0:
            return None
        coords = [[round(x, 6), round(y, 6)] for x, y in to_wgs84(seg).coords]
        return coords if da <= db else coords[::-1]


_transit_cache: dict[str, TransitIndex] = {}


def transit_dir() -> Path:
    return data_dir() / "geo" / "transit"


def load_transit() -> TransitIndex | None:
    """None until `findhome geo fetch transit` has run."""
    meta = transit_dir() / "meta.json"
    if not meta.exists():
        return None
    mtime = meta.stat().st_mtime
    hit = _transit_cache.get("idx")
    if hit and hit.mtime == mtime:
        return hit
    lines, colours = {}, {}
    for p in transit_dir().glob("lines_*.geojson"):
        for f in read_geojson(p)["features"]:
            pr = f["properties"]
            key = (pr["mode"], pr.get("ref") or "")
            lines[key] = to_metric(shape(f["geometry"]))
            colours[key] = pr.get("colour")
    idx = TransitIndex(lines, colours, mtime)
    _transit_cache["idx"] = idx
    return idx


@dataclass
class TimetableIndex:
    """Stops with the lines they serve and (with GTFS) departures per hour, from data/geo/timetable/."""
    source: str                                       # gtfs | osm
    ref_dates: dict[str, str]
    lines: dict[str, dict[str, Any]]                  # line id → {mode, ref, name}
    stops: dict[str, dict[str, Any]]                  # stop id → {name, lat, lon, parent, lines}
    departures: dict[str, dict[str, list[int]]]       # day kind → stop id → 24 counts; {} without GTFS
    ids: list[str]
    points: list[Any]                                 # shapely Points in EPSG:3006, same order as ids
    tree: STRtree
    mtime: float

    def stops_near(self, pt, within_m: float) -> list[tuple[float, str]]:
        """(distance m, stop id) of the stops within the radius, nearest first."""
        idx = self.tree.query(pt.buffer(within_m))
        return sorted((self.points[int(i)].distance(pt), self.ids[int(i)]) for i in idx
                      if self.points[int(i)].distance(pt) <= within_m)

    def lines_at(self, stop_id: str) -> list[dict[str, Any]]:
        return [{"id": lid, **self.lines[lid]} for lid in self.stops.get(stop_id, {}).get("lines", []) if lid in self.lines]

    def departures_at(self, stop_id: str, day_kind: str) -> list[int] | None:
        """24 hourly counts, or None when there is no timetable (OSM source)."""
        if not self.departures:
            return None
        return self.departures.get(day_kind, {}).get(stop_id, [0] * 24)


_timetable_cache: dict[str, TimetableIndex] = {}


def load_timetable() -> TimetableIndex | None:
    """None until `findhome geo fetch timetable` has run."""
    from findhome.geo.build_timetable import timetable_dir

    d = timetable_dir()
    meta = d / "meta.json"
    if not meta.exists():
        return None
    mtime = meta.stat().st_mtime
    hit = _timetable_cache.get("idx")
    if hit and hit.mtime == mtime:
        return hit
    doc = json.loads((d / "stops.json").read_text(encoding="utf-8"))
    dep_path = d / "departures.json"
    departures = json.loads(dep_path.read_text(encoding="utf-8")) if dep_path.exists() else {}
    ids = list(doc["stops"])
    points = [to_metric(Point(doc["stops"][i]["lon"], doc["stops"][i]["lat"])) for i in ids]
    idx = TimetableIndex(doc["source"], doc.get("ref_dates", {}), doc["lines"], doc["stops"], departures, ids, points,
                         STRtree(points), mtime)
    _timetable_cache["idx"] = idx
    return idx
