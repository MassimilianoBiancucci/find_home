"""Build data/geo/buildings/<kommun>.json.gz: residential buildings as weighted points ("where people live").

One Overpass request per municipality with `out center tags` (no footprints, so it stays light). The weight is the
number of floors (`building:levels`, else zone.yaml `homes.default_levels` per building type, else 1). The zone
analysis uses these points to report what a typical home in a zone sees, instead of an average over street segments.

File: {"kommun": "0183", "homes": [[x, y, weight], ...]} with x, y in EPSG:3006.
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

from findhome.config.models import GeoConfig, ZoneConfig
from findhome.core.paths import data_dir
from findhome.geo.crs import points_metric
from findhome.geo.overpass import area, overpass
from findhome.providers.osm import USER_AGENT

log = logging.getLogger(__name__)


def buildings_dir(base: Path | None = None) -> Path:
    return (base or data_dir()) / "geo" / "buildings"


def _levels(tags: dict[str, str], defaults: dict[str, float]) -> float:
    try:
        n = float(str(tags.get("building:levels", "")).split(";")[0])
        if 0 < n < 100:
            return n
    except ValueError:
        pass
    return float(defaults.get(tags.get("building", ""), 1))


def homes_from_elements(elements: list[dict[str, Any]], defaults: dict[str, float]) -> list[list[float]]:
    """Overpass `out center tags` answer → [[x, y, weight]]. Pure."""
    pts = [(el.get("center") or el, el.get("tags") or {}) for el in elements]
    pts = [(c, t) for c, t in pts if c.get("lat") is not None]
    if not pts:
        return []
    xs, ys = points_metric([c["lon"] for c, _ in pts], [c["lat"] for c, _ in pts])
    return [[round(x, 1), round(y, 1), _levels(t, defaults)] for x, y, (_, t) in zip(xs, ys, pts, strict=True)]


def build_buildings(geo: GeoConfig, zone: ZoneConfig, out_dir: Path | None = None, client: httpx.Client | None = None,
                    only: list[str] | None = None) -> dict[str, Any]:
    types = zone.homes.get("buildings") or ["apartments", "residential", "house"]
    defaults = zone.homes.get("default_levels") or {}
    target = buildings_dir(out_dir)
    target.mkdir(parents=True, exist_ok=True)
    own = client is None
    client = client or httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=400)
    counts: dict[str, int] = {}
    try:
        for code in only or sorted(geo.region["kommuner"]):
            q = (f'[out:json][timeout:300];{area([code])}'
                 f'nwr(area.k)["building"~"^({"|".join(types)})$"];out center tags;')
            homes = homes_from_elements(overpass(client, q).get("elements", []), defaults)
            (target / f"{code}.json.gz").write_bytes(
                gzip.compress(json.dumps({"kommun": code, "homes": homes}, separators=(",", ":")).encode()))
            counts[code] = len(homes)
            log.info("buildings %s: %s", code, len(homes))
            time.sleep(2)
    finally:
        if own:
            client.close()
    meta_path = target / "meta.json"
    meta = json.loads(meta_path.read_text()) if meta_path.exists() else {"kommuner": {}}
    meta["kommuner"].update(counts)
    meta["built_at"] = datetime.now(UTC).isoformat(timespec="seconds")
    meta_path.write_text(json.dumps(meta, indent=1), encoding="utf-8")
    return meta
