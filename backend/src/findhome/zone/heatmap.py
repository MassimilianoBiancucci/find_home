"""Walking / cycling time from every street segment of a zone to the nearest target of each target set.

One Dijkstra per target set from a virtual source joined to every target's nearest node (the snap walk is its
weight), with a cutoff. Pure: the network, the targets and the homes come in, a Heatmap goes out; nothing is read or
written here.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import networkx as nx
from shapely import STRtree
from shapely.geometry import Point
from shapely.prepared import prep

from findhome.zone.extent import Extent
from findhome.zone.network import NetMode, Network

SOURCE = -1                                        # the virtual source node (OSM ids are positive)


@dataclass(frozen=True)
class HeatmapParams:
    mode: NetMode
    speed_mps: float
    cutoff_s: float
    snap_max_m: float
    factors: dict[str, float] = field(default_factory=dict)


@dataclass
class Heatmap:
    segments: list[tuple[int, dict[str, float]]]   # (edge index in Network.edges, seconds per target set)
    summary: dict[str, dict[str, Any]]             # per target set and "any": home-weighted stats
    targets: dict[str, int]                        # targets per set that reached the network
    homes: int                                     # homes (or nodes, without buildings) behind the summary


def weighted_quantile(values: list[tuple[float, float]], q: float) -> float | None:
    """values: (value, weight). The smallest value whose cumulative weight reaches q of the total."""
    if not values:
        return None
    vs = sorted(values)
    total = sum(w for _, w in vs)
    acc = 0.0
    for v, w in vs:
        acc += w
        if acc >= q * total:
            return v
    return vs[-1][0]


def _summary(times: list[tuple[float | None, float]], n_targets: int) -> dict[str, Any]:
    total = sum(w for _, w in times) or 1.0
    reached = [(t, w) for t, w in times if t is not None]

    def share(limit: float) -> float:
        return round(sum(w for t, w in reached if t <= limit) / total, 3)

    med, p90 = weighted_quantile(reached, 0.5), weighted_quantile(reached, 0.9)
    return {"targets": n_targets, "median_s": None if med is None else round(med),
            "p90_s": None if p90 is None else round(p90), "share_le_5min": share(300), "share_le_10min": share(600),
            "share_reached": round(sum(w for _, w in reached) / total, 3)}


class ExtentGraph:
    """The network inside an extent with edge times for one mode, node snapping, and the focus homes snapped to it.
    Built once per analysis and shared by the heatmap and the reach search of the indices."""

    def __init__(self, net: Network, ext: Extent, p: HeatmapParams, homes: list[tuple[float, float, float]]):
        self.net, self.ext, self.p = net, ext, p
        self.g: nx.Graph = net.graph(p.mode).subgraph(net.nodes_within(ext.search, p.mode)).copy()
        for _, _, d in self.g.edges(data=True):
            d["t"] = d["length"] / (p.speed_mps * p.factors.get(d["highway"], 1.0))
        self.node_ids = list(self.g.nodes)
        self._tree = STRtree([Point(net.nodes[n]) for n in self.node_ids]) if self.node_ids else None
        focus = prep(ext.focus)
        self.inside = {n for n in self.node_ids if focus.contains(Point(net.nodes[n]))}
        points = [(Point(x, y), w) for x, y, w in homes if focus.contains(Point(x, y))]
        if not points:                                        # no buildings: every network node counts once
            points = [(Point(net.nodes[n]), 1.0) for n in self.inside]
        snapped = [(self.snap(pt), w) for pt, w in points]
        self.homes: list[tuple[tuple[int, float], float]] = [(s, w) for s, w in snapped if s]

    def snap(self, pt: Point) -> tuple[int, float] | None:
        """Nearest node and the distance to it, or None beyond snap_max_m."""
        if self._tree is None:
            return None
        n = self.node_ids[int(self._tree.nearest(pt))]
        d = pt.distance(Point(self.net.nodes[n]))
        return (n, d) if d <= self.p.snap_max_m else None

    def times_from(self, starts: dict[int, float], cutoff_s: float) -> dict[int, float]:
        """Seconds to every node reachable within the cutoff from any start node (start node → initial seconds)."""
        if not starts:
            return {}
        self.g.add_weighted_edges_from(((SOURCE, n, t) for n, t in starts.items()), weight="t")
        try:
            dist = nx.single_source_dijkstra_path_length(self.g, SOURCE, cutoff=cutoff_s, weight="t")
        finally:
            self.g.remove_node(SOURCE)
        dist.pop(SOURCE, None)
        return dist

    def starts(self, pts: list[Point]) -> dict[int, float]:
        out: dict[int, float] = {}
        for pt in pts:
            s = self.snap(pt)
            if s:
                out[s[0]] = min(out.get(s[0], float("inf")), s[1] / self.p.speed_mps)
        return out


def compute(net: Network, ext: Extent, targets: dict[str, list[Point]], p: HeatmapParams,
            homes: list[tuple[float, float, float]], eg: ExtentGraph | None = None) -> Heatmap:
    eg = eg or ExtentGraph(net, ext, p, homes)
    times: dict[str, dict[int, float]] = {}
    reached: dict[str, int] = {}
    for sid, pts in targets.items():
        starts = eg.starts(pts)
        reached[sid] = len(starts)
        times[sid] = eg.times_from(starts, p.cutoff_s)

    segments = []
    for u, v, d in eg.g.edges(data=True):
        if u not in eg.inside and v not in eg.inside:
            continue
        per = {sid: round((t[u] + t[v]) / 2, 1) for sid, t in times.items() if u in t and v in t}
        segments.append((d["idx"], per))

    snapped = eg.homes
    summary: dict[str, dict[str, Any]] = {}
    for sid, t in times.items():
        summary[sid] = _summary([(t[n] + d / p.speed_mps if n in t else None, w) for (n, d), w in snapped], reached[sid])
    if times:
        best = [(min((t[n] for t in times.values() if n in t), default=None), w, d) for (n, d), w in snapped]
        summary["any"] = _summary([(None if b is None else b + d / p.speed_mps, w) for b, w, d in best],
                                  sum(reached.values()))
    return Heatmap(segments, summary, reached, len(snapped))
