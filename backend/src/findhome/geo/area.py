"""The search area: weighted pieces (zone sets and drawn shapes) minus erasers, and the address function.

area_score(p) = max_i( w_i * falloff(d_i) ), d_i = distance from p to piece i (0 inside),
falloff = 1 at the edge, linear to 0 at buffer_m. Overlaps take the best piece; erasers cut every piece.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from shapely.geometry import Point, mapping, shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union

from findhome.geo.crs import point_metric, polygonal, to_metric, to_wgs84
from findhome.geo.store import ZoneSet, load_zones


@dataclass
class Piece:
    id: str
    label: str
    weight: float
    kind: str
    geom: BaseGeometry              # EPSG:3006, erasers already removed
    zones: list[str] = field(default_factory=list)


@dataclass
class CompiledArea:
    buffer_m: float
    pieces: list[Piece]
    union: BaseGeometry | None
    missing_zones: list[str]
    zones: ZoneSet | None

    @property
    def defined(self) -> bool:
        return bool(self.pieces)


@dataclass
class AreaResult:
    inside: bool
    distance_m: float               # to the nearest piece; 0 inside
    depth_m: float | None           # inside: distance to the area border
    score: float
    best_piece: str | None
    contributions: list[dict[str, Any]]
    zone: dict[str, str] | None

    def as_dict(self) -> dict[str, Any]:
        return {"inside": self.inside, "distance_m": round(self.distance_m), "score": round(self.score, 3),
                "depth_m": None if self.depth_m is None else round(self.depth_m), "best_piece": self.best_piece,
                "contributions": self.contributions, "zone": self.zone}


def compile_area(cfg: dict[str, Any] | None, zones: ZoneSet | None) -> CompiledArea:
    cfg = cfg or {}
    buffer_m = float(cfg.get("buffer_m", 1500))
    raw = cfg.get("pieces") or []
    erasers = [polygonal(to_metric(shape(p["geometry"]))) for p in raw if p.get("kind") == "eraser"]
    cut = unary_union(erasers) if erasers else None
    pieces: list[Piece] = []
    missing: list[str] = []
    for p in raw:
        kind = p.get("kind")
        if kind == "eraser":
            continue
        if kind == "zones":
            ids = list(p.get("zones") or [])
            found = [zones.zones[z].geom for z in ids if zones and z in zones.zones]
            missing += [z for z in ids if not zones or z not in zones.zones]
            if not found:
                continue
            geom = unary_union([polygonal(g) for g in found])
        else:
            geom = polygonal(to_metric(shape(p["geometry"])))
        if cut is not None:
            geom = geom.difference(cut)
        if geom.is_empty:
            continue
        pieces.append(Piece(p["id"], p.get("label") or p["id"], float(p.get("weight", 1.0)), kind, geom,
                            list(p.get("zones") or [])))
    union = unary_union([p.geom for p in pieces]) if pieces else None
    return CompiledArea(buffer_m, pieces, union, missing, zones)


def area_eval(area: CompiledArea, lat: float, lon: float) -> AreaResult:
    pt = Point(point_metric(lon, lat))
    zone = area.zones.containing(pt) if area.zones else None
    zinfo = {"id": zone.id, "name": zone.name, "district": zone.district, "kommun": zone.kommun} if zone else None
    contribs = []
    for piece in area.pieces:
        d = piece.geom.distance(pt)
        value = piece.weight * max(0.0, 1 - d / area.buffer_m) if area.buffer_m > 0 else piece.weight * (d == 0)
        contribs.append({"piece": piece.id, "label": piece.label, "weight": piece.weight,
                         "distance_m": round(d), "value": round(value, 3)})
    contribs.sort(key=lambda c: -c["value"])
    if not contribs:
        return AreaResult(False, float("inf"), None, 0.0, None, [], zinfo)
    best = contribs[0]
    dist = min(c["distance_m"] for c in contribs)
    depth = area.union.boundary.distance(pt) if dist == 0 and area.union is not None else None
    return AreaResult(dist == 0, dist, depth, best["value"], best["piece"] if best["value"] > 0 else None, contribs, zinfo)


def outline_geojson(area: CompiledArea, simplify_m: float = 5) -> dict[str, Any] | None:
    if area.union is None:
        return None
    return mapping(to_wgs84(area.union.simplify(simplify_m)))


_compiled: dict[tuple, CompiledArea] = {}


def compiled_for(raw_search_area: dict[str, Any] | None, zones: ZoneSet | None = None) -> CompiledArea:
    """Cached per search_area content and zones file version."""
    import json

    zs = zones if zones is not None else load_zones()
    key = (json.dumps(raw_search_area or {}, sort_keys=True, default=str), zs.mtime if zs else None)
    hit = _compiled.get(key)
    if hit is None:
        _compiled.clear()
        hit = _compiled[key] = compile_area(raw_search_area, zs)
    return hit
