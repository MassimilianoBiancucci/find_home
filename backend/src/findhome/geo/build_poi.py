"""Build data/geo/poi/<category>.geojson: every POI of each poi.yaml category in the region, one Overpass
request per category (OSM usage policy: region-wide fetches on a schedule, never per listing)."""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Any

import httpx

from findhome.config.models import GeoConfig, Poi
from findhome.core.paths import data_dir
from findhome.providers.osm import USER_AGENT
from findhome.providers.poi import tag_filters

log = logging.getLogger(__name__)
OVERPASS = "https://overpass-api.de/api/interpreter"
POI_DIR = "geo/poi"


def poi_dir(base: Path | None = None) -> Path:
    return (base or data_dir()) / POI_DIR


def region_query(osm_tags: list[str], codes: list[str]) -> str:
    parts = "".join(f"nwr(area.k){tag_filters(t)};" for t in osm_tags)
    return ("[out:json][timeout:240];\n"
            f'area["boundary"="administrative"]["admin_level"="7"]["ref:scb"~"^({"|".join(codes)})$"]->.k;\n'
            f"({parts});\nout center tags;")


def to_features(elements: list[dict[str, Any]], category: str) -> list[dict[str, Any]]:
    feats, seen = [], set()
    for el in elements:
        lat = el.get("lat") or (el.get("center") or {}).get("lat")
        lon = el.get("lon") or (el.get("center") or {}).get("lon")
        oid = f"{el['type'][0]}{el['id']}"
        if lat is None or oid in seen:
            continue
        seen.add(oid)
        t = el.get("tags") or {}
        feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
                      "properties": {"id": oid, "category": category, "name": t.get("name") or t.get("brand"),
                                     "brand": t.get("brand"), "opening_hours": t.get("opening_hours")}})
    return feats


def _post(client: httpx.Client, query: str, waits: tuple[int, ...] = (30, 60)) -> httpx.Response:
    """Overpass answers 429/502/503/504 when busy: back off and retry a couple of times."""
    resp = client.post(OVERPASS, data={"data": query})
    for wait in waits:
        if resp.status_code not in (429, 502, 503, 504):
            break
        log.warning("overpass %s, retrying in %s s", resp.status_code, wait)
        time.sleep(wait)
        resp = client.post(OVERPASS, data={"data": query})
    resp.raise_for_status()
    return resp


def fetch_poi(geo: GeoConfig, poi: Poi, categories: list[str] | None = None, out_dir: Path | None = None,
              client: httpx.Client | None = None, pause_s: float = 2.0) -> dict[str, int | str]:
    """Counts per category; a category that keeps failing reports its error and keeps its previous file."""
    codes = sorted(geo.region["kommuner"])
    target = poi_dir(out_dir)
    target.mkdir(parents=True, exist_ok=True)
    own = client is None
    client = client or httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=300)
    counts: dict[str, int | str] = {}
    try:
        for i, (name, cat) in enumerate(poi.categories.items()):
            if categories and name not in categories:
                continue
            if i and pause_s:
                time.sleep(pause_s)
            try:
                resp = _post(client, region_query(cat.osm_tags, codes))
            except httpx.HTTPError as exc:
                counts[name] = f"error: {exc.__class__.__name__}"
                continue
            feats = to_features(resp.json().get("elements", []), name)
            (target / f"{name}.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats},
                                                               ensure_ascii=False), encoding="utf-8")
            counts[name] = len(feats)
    finally:
        if own:
            client.close()
    return counts
