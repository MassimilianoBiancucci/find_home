"""The walking / cycling graph of one or more municipalities, loaded from data/geo/network/ (geo/build_network.py).

`load_network(codes)` is the only entry point the rest of the zone analysis uses, so the file format or the graph
library can change behind it. Graphs are cached per process and reloaded when a file changes.
"""
from __future__ import annotations

import gzip
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

import networkx as nx
from shapely import STRtree
from shapely.geometry import Point

from findhome.geo.build_network import network_dir

NetMode = Literal["walk", "bike"]
EDGE_U, EDGE_V, EDGE_LEN, EDGE_HW, EDGE_WALK, EDGE_BIKE, EDGE_GEOM = range(7)


@dataclass
class Network:
    codes: tuple[str, ...]
    nodes: dict[int, tuple[float, float]]            # osm id → (x, y) in EPSG:3006
    edges: list[list]                                # rows as in the file; the graph refers to them by index
    mtimes: tuple[float, ...]
    _graphs: dict[str, nx.Graph] = field(default_factory=dict, repr=False)
    _trees: dict[str, tuple[STRtree, list[int]]] = field(default_factory=dict, repr=False)

    def graph(self, mode: NetMode) -> nx.Graph:
        """Undirected graph of the edges usable in this mode; edge attrs: length (m), highway, idx (into edges)."""
        if mode not in self._graphs:
            col = EDGE_WALK if mode == "walk" else EDGE_BIKE
            g = nx.Graph()
            for i, e in enumerate(self.edges):
                if not e[col]:
                    continue
                u, v = e[EDGE_U], e[EDGE_V]
                old = g.get_edge_data(u, v)
                if old is None or old["length"] > e[EDGE_LEN]:     # parallel ways: keep the shorter
                    g.add_edge(u, v, length=e[EDGE_LEN], highway=e[EDGE_HW], idx=i)
            self._graphs[mode] = g
        return self._graphs[mode]

    def nearest_node(self, x: float, y: float, mode: NetMode) -> tuple[int, float] | None:
        """The closest graph node usable in this mode and its straight-line distance (m)."""
        if mode not in self._trees:
            ids = list(self.graph(mode).nodes)
            self._trees[mode] = (STRtree([Point(self.nodes[n]) for n in ids]), ids)
        tree, ids = self._trees[mode]
        if not ids:
            return None
        p = Point(x, y)
        i = int(tree.nearest(p))
        nx_, ny = self.nodes[ids[i]]
        return ids[i], ((nx_ - x) ** 2 + (ny - y) ** 2) ** 0.5


_cache: dict[tuple[str, ...], Network] = {}


def _files(codes: tuple[str, ...], base: Path | None) -> list[Path]:
    d = network_dir(base)
    return [d / f"{c}.json.gz" for c in codes if (d / f"{c}.json.gz").exists()]


def load_network(codes: list[str] | tuple[str, ...], base: Path | None = None) -> Network | None:
    """Merged network of these municipalities (ways crossing a border appear in both files and merge by node id).
    None when none of them is built yet (`findhome geo fetch network`)."""
    key = tuple(sorted(set(codes)))
    files = _files(key, base)
    if not files:
        return None
    mtimes = tuple(f.stat().st_mtime for f in files)
    hit = _cache.get(key)
    if hit and hit.mtimes == mtimes:
        return hit
    nodes: dict[int, tuple[float, float]] = {}
    edges: list[list] = []
    seen: set[tuple[int, int, float]] = set()
    for f in files:
        data = json.loads(gzip.decompress(f.read_bytes()))
        nodes.update({int(k): (v[0], v[1]) for k, v in data["nodes"].items()})
        for e in data["edges"]:
            sig = (min(e[0], e[1]), max(e[0], e[1]), e[2])
            if sig not in seen:
                seen.add(sig)
                edges.append(e)
    net = Network(key, nodes, edges, mtimes)
    _cache[key] = net
    return net
