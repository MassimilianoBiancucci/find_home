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


def compute(net: Network, ext: Extent, targets: dict[str, list[Point]], p: HeatmapParams,
            homes: list[tuple[float, float, float]]) -> Heatmap:
    base = net.graph(p.mode)
    ids = net.nodes_within(ext.search, p.mode)
    g: nx.Graph = base.subgraph(ids).copy()
    for _, _, d in g.edges(data=True):
        d["t"] = d["length"] / (p.speed_mps * p.factors.get(d["highway"], 1.0))
    node_ids = list(g.nodes)
    tree = STRtree([Point(net.nodes[n]) for n in node_ids]) if node_ids else None

    def snap(pt: Point) -> tuple[int, float] | None:
        if tree is None:
            return None
        n = node_ids[int(tree.nearest(pt))]
        d = pt.distance(Point(net.nodes[n]))
        return (n, d) if d <= p.snap_max_m else None

    times: dict[str, dict[int, float]] = {}
    reached: dict[str, int] = {}
    for sid, pts in targets.items():
        starts: dict[int, float] = {}
        for pt in pts:
            s = snap(pt)
            if s:
                starts[s[0]] = min(starts.get(s[0], float("inf")), s[1] / p.speed_mps)
        reached[sid] = len(starts)
        if not starts:
            times[sid] = {}
            continue
        g.add_weighted_edges_from(((SOURCE, n, t) for n, t in starts.items()), weight="t")
        dist = nx.single_source_dijkstra_path_length(g, SOURCE, cutoff=p.cutoff_s, weight="t")
        g.remove_node(SOURCE)
        dist.pop(SOURCE, None)
        times[sid] = dist

    focus = prep(ext.focus)
    inside = {n for n in node_ids if focus.contains(Point(net.nodes[n]))}
    segments = []
    for u, v, d in g.edges(data=True):
        if u not in inside and v not in inside:
            continue
        per = {sid: round((t[u] + t[v]) / 2, 1) for sid, t in times.items() if u in t and v in t}
        segments.append((d["idx"], per))

    points = [(Point(x, y), w) for x, y, w in homes if focus.contains(Point(x, y))]
    if not points:                                            # no buildings: every network node counts once
        points = [(Point(net.nodes[n]), 1.0) for n in inside]
    snapped = [(snap(pt), w) for pt, w in points]
    snapped = [(s, w) for s, w in snapped if s]
    summary: dict[str, dict[str, Any]] = {}
    for sid, t in times.items():
        summary[sid] = _summary([(t[n] + d / p.speed_mps if n in t else None, w) for (n, d), w in snapped], reached[sid])
    if times:
        best = [(min((t[n] for t in times.values() if n in t), default=None), w, d) for (n, d), w in snapped]
        summary["any"] = _summary([(None if b is None else b + d / p.speed_mps, w) for b, w, d in best],
                                  sum(reached.values()))
    return Heatmap(segments, summary, reached, len(snapped))
