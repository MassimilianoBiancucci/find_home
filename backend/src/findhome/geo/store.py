"""Loads the built geodata files under data/geo/ once per process and reloads them when they change."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from shapely.geometry import Point, shape
from shapely.geometry.base import BaseGeometry
from shapely.strtree import STRtree

from findhome.core.paths import data_dir
from findhome.geo.crs import polygonal, to_metric

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
                                    pr.get("district", ""), pr, polygonal(to_metric(shape(f["geometry"]))))
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


GAP_M = 40                    # OSM route relations are split into ways; endpoints this close are joined
TRACKS_M = 60                 # tracks this much farther than the nearest one still join a stop (other direction)
DETOUR = 2.5                  # a piece between two stops longer than this × straight (+ 300 m) is not trusted


@dataclass
class _LineGraph:
    g: Any                                     # networkx.Graph: nodes (x, y) in EPSG:3006, edge weight "w" (m)
    segs: list[tuple[tuple[float, float], tuple[float, float]]]
    tree: STRtree                              # over segs


def _line_graph(geom: BaseGeometry) -> _LineGraph | None:
    """Every way piece of a line as one graph, with the small gaps between pieces bridged."""
    import math
    from itertools import pairwise

    import networkx as nx
    from shapely.geometry import LineString

    g = nx.Graph()
    segs, ends = [], set()
    for part in getattr(geom, "geoms", [geom]):
        cs = [(round(x, 1), round(y, 1)) for x, y in part.coords]
        for u, v in pairwise(cs):
            if u != v:
                g.add_edge(u, v, w=math.dist(u, v))
                segs.append((u, v))
        if len(cs) > 1:
            ends.update((cs[0], cs[-1]))
    if not segs:
        return None
    nodes = list(g.nodes)
    ntree = STRtree([Point(n) for n in nodes])
    for e in ends:
        for i in ntree.query(Point(e).buffer(GAP_M)):
            n = nodes[int(i)]
            if n != e and not g.has_edge(e, n):
                g.add_edge(e, n, w=math.dist(e, n) * 1.5)       # a jump, slightly dearer than the track
    return _LineGraph(g, segs, STRtree([LineString(s) for s in segs]))


@dataclass
class TransitIndex:
    """Lines per (mode, ref) in EPSG:3006, to draw itinerary legs along the real track."""
    lines: dict[tuple[str, str], BaseGeometry]
    colours: dict[tuple[str, str], str]
    mtime: float
    _graphs: dict[tuple[str, str], _LineGraph | None] = field(default_factory=dict, repr=False)

    def key_for(self, mode: str, ref: str | None) -> tuple[str, str] | None:
        """The stored line for a leg: exact ref, else without a trailing letter (176X → 176)."""
        import re

        for r in (ref or "", re.sub(r"[A-Za-z]+$", "", ref or "")):
            if (mode, r) in self.lines:
                return (mode, r)
        return None

    def leg_path(self, mode: str, ref: str | None, a: tuple[float, float], b: tuple[float, float],
                 via: list[tuple[float, float]] | tuple = (), max_off_m: float = 300) -> list[list[float]] | None:
        """[lon, lat] points along the line from boarding a to alighting b ([lon, lat]), through the stops in
        between (`via`, in order) so a branch or a loop is followed the right way. The line's way pieces are one
        graph; each stop is snapped onto its nearest piece and consecutive stops are joined by the shortest way
        along the track. A piece that cannot be followed is drawn straight between its two stops; None when the
        line is unknown, the ends are off the track, or less than half the leg follows it."""
        import math
        from itertools import pairwise

        import networkx as nx
        from shapely.geometry import LineString

        from findhome.geo.crs import point_metric, points_wgs84

        key = self.key_for(mode, ref)
        if key is None:
            return None
        if key not in self._graphs:
            self._graphs[key] = _line_graph(self.lines[key])
        lg = self._graphs[key]
        if lg is None:
            return None
        pts = [Point(point_metric(*p)) for p in [a, *via, b]]
        # each stop joins every track that passes it: the two directions are often separate pieces, joined only
        # at the termini, and a stop snapped to the other direction would send the path to the end and back
        snaps: list[tuple[int, tuple[float, float], list[tuple[tuple, float]]]] = []   # (index, point, [(node, w)])
        for i, pt in enumerate(pts):
            d0 = LineString(lg.segs[int(lg.tree.nearest(pt))]).distance(pt)
            if d0 > max_off_m:
                if i in (0, len(pts) - 1):
                    return None                                            # the ends must be on the track
                continue
            near = [LineString(lg.segs[int(j)]) for j in lg.tree.query(pt.buffer(d0 + TRACKS_M))]
            q0 = min(near, key=lambda sg: sg.distance(pt))
            q0 = q0.interpolate(q0.project(pt))
            links = []
            for sg in near:
                q = sg.interpolate(sg.project(pt))
                off = math.dist((q.x, q.y), (q0.x, q0.y))
                links += [(tuple(sg.coords[0]), off + math.dist((q.x, q.y), sg.coords[0])),
                          (tuple(sg.coords[-1]), off + math.dist((q.x, q.y), sg.coords[-1]))]
            snaps.append((i, (q0.x, q0.y), links))
        g = lg.g
        temp = []
        for i, _, links in snaps:
            node = ("stop", i)
            temp.append(node)
            for n, w in links:
                if not g.has_edge(node, n) or g[node][n]["w"] > w:
                    g.add_edge(node, n, w=w)
        for (i, q, _), (k, r, _) in pairwise(snaps):
            if math.dist(q, r) < 1:
                g.add_edge(("stop", i), ("stop", k), w=0.0)
        coords: list[tuple[float, float]] = []
        followed = 0
        try:
            pos = {("stop", i): q for i, q, _ in snaps}
            for (i, q, _), (k, r, _) in pairwise(snaps):
                straight = math.dist(q, r)
                try:
                    length, path = nx.single_source_dijkstra(g, ("stop", i), ("stop", k), weight="w")
                except nx.NetworkXNoPath:
                    path, length = None, math.inf
                if path is None or length > DETOUR * straight + 300:
                    piece = [q, r]
                else:
                    piece = [pos.get(n, n) for n in path]
                    followed += 1
                coords += piece if not coords else piece[1:]
        finally:
            g.remove_nodes_from(temp)
        pairs = max(len(snaps) - 1, 1)
        if len(coords) < 2 or followed / pairs < 0.5:
            return None
        return points_wgs84([c[0] for c in coords], [c[1] for c in coords])


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
    departures: dict[str, dict[str, dict[str, list[int]]]]   # day kind → stop → line → 24 counts; {} without GTFS
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

    def departures_by_line(self, stop_id: str, day_kind: str) -> dict[str, list[int]] | None:
        """line id → 24 hourly departures at this stop; None when there is no timetable (OSM source)."""
        if not self.departures:
            return None
        return self.departures.get(day_kind, {}).get(stop_id, {})

    def departures_at(self, stop_id: str, day_kind: str) -> list[int] | None:
        """24 hourly departures of every line at this stop, or None when there is no timetable (OSM source)."""
        by_line = self.departures_by_line(stop_id, day_kind)
        if by_line is None:
            return None
        return [sum(c[h] for c in by_line.values()) for h in range(24)]


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
