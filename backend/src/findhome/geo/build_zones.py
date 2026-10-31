"""Build data/geo/zones.geojson: SCB RegSO 2025 zones of the configured region, grouped by Stockholm's
stadsdelsområden (OSM admin_level 9), simplified, in WGS84. Also seeds config/area_aliases.yaml from OSM
place names when it is empty. One SCB request and two Overpass requests; run by `findhome geo fetch zones`.
"""
from __future__ import annotations

import json
import logging
from collections import defaultdict
from pathlib import Path
from typing import Any

import httpx
from shapely.geometry import LineString, Point, mapping, shape
from shapely.ops import polygonize, unary_union

from findhome.config.models import GeoConfig
from findhome.core.paths import data_dir
from findhome.geo.crs import point_metric, to_metric, to_wgs84
from findhome.geo.store import ZONES_FILE
from findhome.providers.osm import USER_AGENT

log = logging.getLogger(__name__)
OVERPASS = "https://overpass-api.de/api/interpreter"


def _round(geom: dict[str, Any], nd: int = 5) -> dict[str, Any]:
    def r(c):
        return [round(c[0], nd), round(c[1], nd)] if isinstance(c[0], float) else [r(x) for x in c]
    return {"type": geom["type"], "coordinates": r(geom["coordinates"])}


def fetch_regso(client: httpx.Client, cfg: dict[str, Any], codes: list[str]) -> list[dict[str, Any]]:
    flt = "kommunkod IN ({})".format(",".join(f"'{c}'" for c in codes))
    resp = client.get(cfg.get("wfs_url", "https://geodata.scb.se/geoserver/stat/wfs"), params={
        "service": "WFS", "request": "GetFeature", "version": "2.0.0", "typeNames": cfg.get("type_name", "stat:RegSO_2025"),
        "outputFormat": "application/json", "CQL_FILTER": flt}, timeout=180)
    resp.raise_for_status()
    fc = resp.json()
    crs = (fc.get("crs") or {}).get("properties", {}).get("name", "EPSG:3006")
    if "3006" not in crs:
        raise RuntimeError(f"unexpected CRS from SCB WFS: {crs}")
    return fc["features"]


def _overpass(client: httpx.Client, query: str) -> list[dict[str, Any]]:
    resp = client.post(OVERPASS, data={"data": query}, timeout=240)
    resp.raise_for_status()
    return resp.json()["elements"]


def fetch_stockholm_districts(client: httpx.Client) -> dict[str, Any]:
    """Stadsdelsområden (admin_level 9) of Stockholm as {name: polygon in EPSG:3006}."""
    els = _overpass(client, """[out:json][timeout:180];
area["boundary"="administrative"]["admin_level"="7"]["ref:scb"="0180"]->.k;
relation(area.k)["boundary"="administrative"]["admin_level"="9"];
out geom;""")
    out: dict[str, Any] = {}
    for rel in els:
        lines = [LineString([(n["lon"], n["lat"]) for n in m["geometry"]])
                 for m in rel.get("members", []) if m.get("type") == "way" and m.get("role") in ("outer", "") and m.get("geometry")]
        polys = list(polygonize(unary_union(lines))) if lines else []
        if polys:
            out[rel["tags"].get("name", str(rel["id"]))] = to_metric(unary_union(polys))
    return out


def fetch_place_names(client: httpx.Client, codes: list[str]) -> list[tuple[str, float, float]]:
    els = _overpass(client, """[out:json][timeout:180];
area["boundary"="administrative"]["admin_level"="7"]["ref:scb"~"^(CODES)$"]->.k;
node(area.k)["place"~"^(suburb|quarter|neighbourhood)$"]["name"];
out;""".replace("CODES", "|".join(codes)))
    return [(e["tags"]["name"], e["lat"], e["lon"]) for e in els]


def build_zones(geo: GeoConfig, out_dir: Path | None = None, client: httpx.Client | None = None) -> dict[str, Any]:
    kommuner: dict[str, str] = geo.region["kommuner"]
    codes = sorted(kommuner)
    cfg = geo.datasets.get("zones", {})
    simplify_m = float(cfg.get("simplify_m", 8))
    own = client is None
    client = client or httpx.Client(headers={"User-Agent": USER_AGENT})
    try:
        feats = fetch_regso(client, cfg, codes)
        districts = fetch_stockholm_districts(client) if "0180" in codes else {}
        places = fetch_place_names(client, codes)
    finally:
        if own:
            client.close()
    zones = []
    for f in feats:
        p = f["properties"]
        g = shape(f["geometry"])
        rep = g.representative_point()
        code = str(p["kommunkod"])
        district = next((name for name, poly in districts.items() if poly.contains(rep)), kommuner.get(code, code))
        c = to_wgs84(rep)
        zones.append({"type": "Feature", "geometry": _round(mapping(to_wgs84(g.simplify(simplify_m, preserve_topology=True)))),
                      "properties": {"zone_id": p["regsokod"], "name": p["regsonamn"], "kommun_code": code,
                                     "kommun": kommuner.get(code, code), "district": district,
                                     "area_km2": round(g.area / 1e6, 3), "centroid": [round(c.x, 5), round(c.y, 5)],
                                     "source": "SCB RegSO 2025"}})
    zones.sort(key=lambda z: (z["properties"]["kommun"], z["properties"]["district"], z["properties"]["name"]))
    target = (out_dir or data_dir()) / ZONES_FILE
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps({"type": "FeatureCollection", "features": zones}, ensure_ascii=False), encoding="utf-8")
    aliases: dict[str, set[str]] = defaultdict(set)
    metric = [(z["properties"]["zone_id"], to_metric(shape(z["geometry"]))) for z in zones]
    for name, lat, lon in places:
        pt = Point(point_metric(lon, lat))
        for zid, geom in metric:
            if geom.contains(pt):
                aliases[name].add(zid)
                break
    return {"file": str(target), "zones": len(zones), "districts": len(districts),
            "aliases": {k: sorted(v) for k, v in sorted(aliases.items())}}
