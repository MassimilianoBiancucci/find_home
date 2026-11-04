"""Residential buildings as weighted points (data/geo/buildings/, geo/build_buildings.py), cached per process."""
from __future__ import annotations

import gzip
import json
from pathlib import Path

from findhome.geo.build_buildings import buildings_dir

_cache: dict[tuple[str, ...], tuple[tuple[float, ...], list[tuple[float, float, float]]]] = {}


def load_homes(codes: list[str] | tuple[str, ...], base: Path | None = None) -> list[tuple[float, float, float]]:
    """(x, y, weight) of the homes in these municipalities; [] when none is built (`findhome geo fetch buildings`)."""
    key = tuple(sorted(set(codes)))
    files = [buildings_dir(base) / f"{c}.json.gz" for c in key]
    files = [f for f in files if f.exists()]
    mtimes = tuple(f.stat().st_mtime for f in files)
    hit = _cache.get(key)
    if hit and hit[0] == mtimes:
        return hit[1]
    homes: list[tuple[float, float, float]] = []
    for f in files:
        homes += [(h[0], h[1], h[2]) for h in json.loads(gzip.decompress(f.read_bytes()))["homes"]]
    _cache[key] = (mtimes, homes)
    return homes
