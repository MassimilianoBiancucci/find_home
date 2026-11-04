"""Build data/geo/network/<kommun>.json.gz: the streets and paths a person can walk or cycle, as a graph.

One Overpass request per municipality (region-wide fetch on a schedule, never per query). Ways are split at the nodes
they share with other ways, so every edge joins two junctions or dead ends. Coordinates are EPSG:3006 metres.
Buildings are not obstacles here: the ways already go around them.

File shape (kept small, read by zone/network.py):
    {"kommun": "0183", "nodes": {"<osm id>": [x, y]},
     "edges": [[u, v, length_m, highway, walk, bike, [[x, y], ...]]]}
"""
from __future__ import annotations

import gzip
import json
import logging
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

from findhome.config.models import GeoConfig
from findhome.core.paths import data_dir
from findhome.geo.crs import points_metric
from findhome.geo.overpass import area, overpass
from findhome.providers.osm import USER_AGENT

log = logging.getLogger(__name__)
NO = {"no", "private"}
YES = {"yes", "designated", "permissive", "destination"}


def network_dir(base: Path | None = None) -> Path:
    return (base or data_dir()) / "geo" / "network"


def access(tags: dict[str, str], rules: dict[str, Any]) -> tuple[bool, bool]:
    """(walk, bike) for one way from its highway class and access tags."""
    hw = tags.get("highway", "")
    general_no = tags.get("access") in NO
    foot, bicycle = tags.get("foot"), tags.get("bicycle")
    walk = (hw in rules["walk"] or foot in YES) and foot not in NO and not (general_no and foot not in YES)
    bike = ((hw in rules["bike"] or (hw in rules.get("bike_if_allowed", []) and bicycle in YES) or bicycle in YES)
            and bicycle not in NO and not (general_no and bicycle not in YES))
    return walk, bike


def edges_from_ways(elements: list[dict[str, Any]], rules: dict[str, Any]) -> tuple[dict[int, list[float]], list[list]]:
    """Overpass `out geom` ways → (nodes, edges). Pure: no I/O, so it is tested on a hand-made answer."""
    ways = []
    for el in elements:
        if el.get("type") != "way" or len(el.get("nodes", [])) < 2 or len(el.get("geometry", [])) != len(el["nodes"]):
            continue
        walk, bike = access(el.get("tags", {}), rules)
        if walk or bike:
            ways.append((el, walk, bike))
    uses: dict[int, int] = {}
    for el, _, _ in ways:
        for n in el["nodes"]:
            uses[n] = uses.get(n, 0) + 1
    nodes: dict[int, list[float]] = {}
    edges: list[list] = []
    for el, walk, bike in ways:
        ids = el["nodes"]
        xs, ys = points_metric([g["lon"] for g in el["geometry"]], [g["lat"] for g in el["geometry"]])
        pts = [[round(x, 1), round(y, 1)] for x, y in zip(xs, ys, strict=True)]
        start, length = 0, 0.0
        for i in range(1, len(ids)):
            length += ((pts[i][0] - pts[i - 1][0]) ** 2 + (pts[i][1] - pts[i - 1][1]) ** 2) ** 0.5
            if i == len(ids) - 1 or uses[ids[i]] > 1:          # a junction or the way's end closes an edge
                u, v = ids[start], ids[i]
                if u != v:
                    nodes[u], nodes[v] = pts[start], pts[i]
                    edges.append([u, v, round(length, 1), el["tags"].get("highway", ""), walk, bike, pts[start:i + 1]])
                start, length = i, 0.0
    return nodes, edges


def query(code: str, rules: dict[str, Any]) -> str:
    classes = sorted(set(rules["walk"]) | set(rules["bike"]) | set(rules.get("bike_if_allowed", [])))
    return (f'[out:json][timeout:600];{area([code])}'
            f'way(area.k)["highway"~"^({"|".join(classes)})$"];out geom;')


def build_network(geo: GeoConfig, out_dir: Path | None = None, client: httpx.Client | None = None,
                  only: list[str] | None = None, refresh: bool = False) -> dict[str, Any]:
    rules = geo.datasets.get("network") or {}
    if not rules.get("walk"):
        raise ValueError("geo.yaml datasets.network.walk is empty")
    codes = only or sorted(geo.region["kommuner"])
    target = network_dir(out_dir)
    raw = (out_dir or data_dir()) / "geo" / "raw"
    target.mkdir(parents=True, exist_ok=True)
    raw.mkdir(parents=True, exist_ok=True)
    max_age = float(rules.get("refresh_days", 30)) * 86400
    own = client is None
    client = client or httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=700)
    counts: dict[str, dict[str, int]] = {}
    try:
        for code in codes:
            raw_path = raw / f"osm_network_{code}.json.gz"
            if not refresh and raw_path.exists() and time.time() - raw_path.stat().st_mtime < max_age:
                data = json.loads(gzip.decompress(raw_path.read_bytes()))
            else:
                data = overpass(client, query(code, rules))
                raw_path.write_bytes(gzip.compress(json.dumps(data).encode()))
                time.sleep(2)
            nodes, edges = edges_from_ways(data.get("elements", []), rules)
            out = {"kommun": code, "nodes": {str(k): v for k, v in nodes.items()}, "edges": edges}
            (target / f"{code}.json.gz").write_bytes(gzip.compress(json.dumps(out, separators=(",", ":")).encode()))
            counts[code] = {"nodes": len(nodes), "edges": len(edges),
                            "walk": sum(e[4] for e in edges), "bike": sum(e[5] for e in edges)}
            log.info("network %s: %s", code, counts[code])
    finally:
        if own:
            client.close()
    meta_path = target / "meta.json"
    meta = json.loads(meta_path.read_text()) if meta_path.exists() else {"kommuner": {}}
    meta["kommuner"].update(counts)
    meta["built_at"] = datetime.now(UTC).isoformat(timespec="seconds")
    meta_path.write_text(json.dumps(meta, indent=1), encoding="utf-8")
    return meta
