"""Build data/geo/centroids/: every zone's connectivity centroids and each home's walk to them.

File centroids.json.gz:
    {"version", "stations": {key: {name, lat, lon, lines_w}},
     "zones": {zone_id: {"centroids": [{key, group}], "coverage": {group: share},
                         "homes": [[weight, {centroid index: walk seconds}], ...]}}}
Stations are shared between zones, so the matrix routes each one once. `load_centroids()` reads it back.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import logging
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from findhome.config.loader import ConfigBundle
from findhome.core.paths import data_dir
from findhome.geo.crs import points_wgs84
from findhome.geo.store import TimetableIndex, ZoneSet, load_timetable
from findhome.zone.analysis import _meta, params
from findhome.zone.centroids import candidates, select
from findhome.zone.extent import extent
from findhome.zone.heatmap import ExtentGraph
from findhome.zone.homes import load_homes
from findhome.zone.network import load_network

log = logging.getLogger(__name__)


def centroids_dir(base: Path | None = None) -> Path:
    return (base or data_dir()) / "geo" / "centroids"


def version(bundle: ConfigBundle) -> str:
    blob = json.dumps([bundle.raw["zone"].get("centroids"), bundle.raw["zone"].get("speeds_mps"),
                       _meta("network"), _meta("buildings"), _meta("timetable")], sort_keys=True, default=str)
    return hashlib.sha256(blob.encode()).hexdigest()[:16]


def zone_centroids(bundle: ConfigBundle, zones: ZoneSet, zone_id: str, tt: TimetableIndex) -> dict[str, Any]:
    cfg = bundle.zone.centroids
    p = params(bundle, "walk")
    ext = extent(zones, zone_id, False, p.speed_mps * cfg["max_walk_min"] * 60)
    net = load_network(ext.kommuner)
    eg = ExtentGraph(net, ext, p, load_homes(ext.kommuner))
    cands = candidates(tt, ext.search, cfg["groups"])
    times = [eg.times_from(eg.starts(c.points), cfg["max_walk_min"] * 60) for c in cands]
    walk = [{j: t[n] + d / p.speed_mps for j, t in enumerate(times) if n in t} for (n, d), _ in eg.homes]
    weights = [w for _, w in eg.homes]
    sel = select(walk, weights, cands, cfg)
    chosen = sel["chosen"]
    local = {j: i for i, j in enumerate(chosen)}
    homes = [[round(w, 1), {str(local[j]): round(s) for j, s in walk[h].items() if j in local}]
             for h, w in enumerate(weights)]
    return {"centroids": [{"key": cands[j].key, "group": cands[j].group} for j in chosen], "coverage": sel["coverage"],
            "homes": homes, "_stations": {cands[j].key: cands[j] for j in chosen}}


def build_centroids(bundle: ConfigBundle, zones: ZoneSet, progress: Callable[[int, int, str], None] | None = None,
                    out_dir: Path | None = None) -> dict[str, Any]:
    tt = load_timetable()
    if tt is None:
        raise RuntimeError("no timetable yet: run `findhome geo fetch timetable`")
    if not bundle.zone.centroids:
        raise RuntimeError("zone.yaml has no centroids block")
    stations: dict[str, Any] = {}
    out: dict[str, Any] = {}
    for n, zid in enumerate(zones.order, 1):
        z = zone_centroids(bundle, zones, zid, tt)
        for key, c in z.pop("_stations").items():
            if key not in stations:
                (lon, lat), = points_wgs84([c.point.x], [c.point.y])
                stations[key] = {"name": c.name, "lat": lat, "lon": lon, "lines_w": c.lines_w}
        out[zid] = z
        if progress:
            progress(n, len(zones.order), zid)
    ver = version(bundle)
    d = centroids_dir(out_dir)
    d.mkdir(parents=True, exist_ok=True)
    doc = {"version": ver, "stations": stations, "zones": out}
    (d / "centroids.json.gz").write_bytes(gzip.compress(json.dumps(doc, ensure_ascii=False, separators=(",", ":")).encode()))
    per_zone = [len(z["centroids"]) for z in out.values()]
    meta = {"version": ver, "built_at": datetime.now(UTC).isoformat(timespec="seconds"), "stations": len(stations),
            "centroids": sum(per_zone), "zones": len(out), "max_per_zone": max(per_zone, default=0),
            "groups": {g: sum(1 for z in out.values() for c in z["centroids"] if c["group"] == g)
                       for g in bundle.zone.centroids["groups"]}}
    (d / "meta.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
    return meta


_cache: dict[str, tuple[float, dict[str, Any]]] = {}


def load_centroids(base: Path | None = None) -> dict[str, Any] | None:
    """The built centroids, or None (`findhome zone centroids`)."""
    p = centroids_dir(base) / "centroids.json.gz"
    if not p.exists():
        return None
    mtime = p.stat().st_mtime
    hit = _cache.get(str(p))
    if hit and hit[0] == mtime:
        return hit[1]
    doc = json.loads(gzip.decompress(p.read_bytes()))
    _cache[str(p)] = (mtime, doc)
    return doc
