"""Loads the built geodata files under data/geo/ once per process and reloads them when they change."""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from shapely.geometry import shape
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
