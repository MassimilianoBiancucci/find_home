"""Build data/geo/transit/: one GeoJSON of lines per mode, stations with the lines they serve, and meta.json.

Source order from geo.yaml `datasets.transit.order`: SL GTFS Regional (Trafiklab, CC0, needs TRAFIKLAB_GTFS_KEY)
or OpenStreetMap route relations (Overpass, no key). Both end in the same files, so the API and the map do not
care which one ran. Stations are matched to lines by distance (`station_snap_m`), not by timetables.
"""
from __future__ import annotations

import csv
import io
import json
import logging
import re
import time
import zipfile
from collections import Counter, defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
from shapely import STRtree
from shapely.geometry import LineString, MultiLineString, Point, mapping
from shapely.ops import linemerge, unary_union

from findhome.config.models import GeoConfig, TransitColours
from findhome.core.paths import data_dir
from findhome.core.settings import secret
from findhome.geo.crs import point_metric, to_metric, to_wgs84
from findhome.providers.osm import USER_AGENT

log = logging.getLogger(__name__)
OVERPASS = "https://overpass-api.de/api/interpreter"
MODES = ("metro", "commuter_rail", "local_rail", "tram", "train", "bus", "ferry")
RAILISH = {"metro", "commuter_rail", "local_rail", "tram", "train"}
GLYPH = {"metro": "metro", "commuter_rail": "train", "local_rail": "train", "train": "train", "tram": "tram",
         "bus": "bus", "ferry": "ferry"}
LOCAL_RAIL_LINES = {"25", "26", "27", "28", "29"}           # Saltsjöbanan, Roslagsbanan
COMMUTER_LINES = {"40", "41", "42", "43", "44", "48"}
TRAM_LINES = {"7", "12", "21", "30", "31"}                    # Spårväg City, Nockeby-, Lidingö-, Tvärbanan


def transit_dir(base: Path | None = None) -> Path:
    return (base or data_dir()) / "geo" / "transit"


def norm_ref(ref: str | None) -> str | None:
    """'T14' → '14', 'J 40' → '40', 'Tvärbanan' → None."""
    if not ref:
        return None
    m = re.match(r"^[A-Za-z]*\s*(\d+[A-Za-z]?)$", ref.strip())
    return m.group(1) if m else None


def classify(kind: str, ref: str | None, text: str = "") -> str | None:
    """Map mode from a source kind (OSM route=*, or GTFS route_type mapped to a word) plus line rules."""
    t = text.lower()
    if kind in ("bus", "trolleybus"):
        return "bus"
    if kind in ("ferry", "water"):
        return "ferry"
    if ref in LOCAL_RAIL_LINES or "roslagsbanan" in t or "saltsjöbanan" in t:
        return "local_rail"
    if kind in ("subway", "metro"):
        return "metro"
    if kind in ("tram", "light_rail") or ref in TRAM_LINES:
        return "tram"
    if kind in ("train", "rail"):
        return "commuter_rail" if ref in COMMUTER_LINES or "pendeltåg" in t else "train"
    return None


def gtfs_kind(route_type: str) -> str:
    rt = int(route_type or -1)
    if rt in (1,) or 400 <= rt < 500:
        return "metro"
    if rt in (0,) or 900 <= rt < 1000:
        return "tram"
    if rt in (2,) or 100 <= rt < 200:
        return "rail"
    if rt in (3, 11) or 700 <= rt < 800:
        return "bus"
    if rt in (4,) or rt in (1000, 1200):
        return "ferry"
    return "other"


# ── output ──────────────────────────────────────────────────
def _finish(lines: list[dict], stations: list[dict], colours: TransitColours, geo: GeoConfig, source: str,
            out_dir: Path | None) -> dict[str, Any]:
    """Merge directions per (mode, line), simplify, colour, snap stations, write files; returns counts."""
    cfg = geo.datasets.get("transit", {})
    simp = cfg.get("simplify_m", {"rail": 5, "bus": 10})
    snap = float(cfg.get("station_snap_m", 80))
    merged: dict[tuple[str, str], dict] = {}
    for ln in lines:
        key = (ln["mode"], ln["ref"] or ln["name"] or ln["id"])
        cur = merged.setdefault(key, {**ln, "parts": []})
        cur["parts"].append(ln["geom"])
    target = transit_dir(out_dir)
    target.mkdir(parents=True, exist_ok=True)
    by_mode: dict[str, list[dict]] = defaultdict(list)
    index_geoms, index_meta = [], []
    for (mode, _), ln in merged.items():
        geom = unary_union(ln["parts"])
        if geom.geom_type == "MultiLineString":
            geom = linemerge(geom)
        if geom.is_empty:
            continue
        geom = geom.simplify(simp.get("bus" if mode == "bus" else "rail", 5))
        configured = colours.modes.get(mode)
        if configured and ln["ref"] in configured.lines:
            colour = configured.lines[ln["ref"]]
        else:
            colour = ln.get("osm_colour") or colours.colour(mode, ln["ref"])
        props = {"id": f"{mode}:{ln['ref'] or ln['id']}", "mode": mode, "ref": ln["ref"], "name": ln["name"],
                 "from": ln.get("from"), "to": ln.get("to"), "colour": colour}
        by_mode[mode].append({"type": "Feature", "properties": props, "geometry": mapping(to_wgs84(geom))})
        index_geoms.append(geom)
        index_meta.append(props)
    tree = STRtree(index_geoms) if index_geoms else None
    merged_st: dict[tuple[str, str], dict] = {}
    for st in stations:
        pt = Point(point_metric(st["lon"], st["lat"]))
        served: dict[str, set[str]] = defaultdict(set)
        if tree is not None:
            for i in tree.query(pt.buffer(snap)):
                meta = index_meta[int(i)]
                if meta["mode"] in st["accepts"] and index_geoms[int(i)].distance(pt) <= snap:
                    served[meta["mode"]].add(meta["ref"] or "")
        if not served:
            continue
        mode = next(m for m in MODES if m in served)
        cur = merged_st.get((st["name"], mode))
        if cur is not None and Point(point_metric(*cur["geometry"]["coordinates"])).distance(pt) < 400:
            for m, refs in served.items():
                cur["properties"]["lines"][m] = sorted(set(cur["properties"]["lines"].get(m, [])) | {r for r in refs if r})
            continue
        merged_st[(st["name"], mode)] = {
            "type": "Feature", "geometry": {"type": "Point", "coordinates": [round(st["lon"], 6), round(st["lat"], 6)]},
            "properties": {"id": st["id"], "name": st["name"], "mode": mode, "icon": GLYPH[mode],
                           "color": colours.colour(mode, None),
                           "lines": {m: sorted(r for r in refs if r) for m, refs in served.items()}}}
    feats_st = list(merged_st.values())
    counts = {}
    for mode in MODES:
        fc = {"type": "FeatureCollection", "features": by_mode.get(mode, [])}
        (target / f"lines_{mode}.geojson").write_text(json.dumps(fc, ensure_ascii=False), encoding="utf-8")
        counts[mode] = len(fc["features"])
    (target / "stations.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats_st},
                                                        ensure_ascii=False), encoding="utf-8")
    counts["stations"] = len(feats_st)
    meta = {"source": source, "built_at": datetime.now(UTC).isoformat(timespec="seconds"), "counts": counts}
    (target / "meta.json").write_text(json.dumps(meta), encoding="utf-8")
    return meta


# ── OSM ─────────────────────────────────────────────────────
_NAMED_COLOURS = {"blue": "#0089ca", "red": "#d71d24", "green": "#148541", "pink": "#ec619f", "purple": "#a05fa5",
                  "orange": "#f39200", "grey": "#878787", "gray": "#878787", "turquoise": "#00a5ac"}


def _osm_colour(tag: str | None) -> str | None:
    if not tag:
        return None
    tag = tag.strip().lower()
    return tag if re.fullmatch(r"#[0-9a-f]{6}", tag) else _NAMED_COLOURS.get(tag)


def _overpass(client: httpx.Client, query: str, waits: tuple[int, ...] = (30, 60)) -> dict:
    resp = client.post(OVERPASS, data={"data": query})
    for wait in waits:
        if resp.status_code not in (429, 502, 503, 504):
            break
        log.warning("overpass %s, retrying in %s s", resp.status_code, wait)
        time.sleep(wait)
        resp = client.post(OVERPASS, data={"data": query})
    resp.raise_for_status()
    return resp.json()


def _area(codes: list[str]) -> str:
    return f'area["boundary"="administrative"]["admin_level"="7"]["ref:scb"~"^({"|".join(codes)})$"]->.k;'


def osm_lines(elements: list[dict], today: str | None = None) -> list[dict]:
    """Route relations as lines. SL lines in service always carry a number, so metro, pendeltåg, local rail and
    tram routes without `ref` (planned lines such as the yellow metro line) and routes starting later are skipped."""
    today = today or datetime.now(UTC).date().isoformat()
    out = []
    for el in elements:
        if el.get("type") != "relation":
            continue
        t = el.get("tags") or {}
        ref = norm_ref(t.get("ref"))
        mode = classify(t.get("route", ""), ref, f"{t.get('name', '')} {t.get('network', '')}")
        if mode is None or (mode in RAILISH - {"train"} and ref is None) or (t.get("start_date") or "") > today:
            continue
        parts = [LineString([(p["lon"], p["lat"]) for p in mem["geometry"]])
                 for mem in el.get("members", [])
                 if mem.get("type") == "way" and mem.get("role", "") in ("", "forward", "backward")
                 and len(mem.get("geometry") or []) > 1]
        if not parts:
            continue
        out.append({"id": f"r{el['id']}", "mode": mode, "ref": ref, "name": t.get("name"), "from": t.get("from"),
                    "to": t.get("to"), "osm_colour": _osm_colour(t.get("colour")),
                    "geom": to_metric(MultiLineString(parts))})
    return out


def osm_stations(elements: list[dict]) -> list[dict]:
    out, seen = [], set()
    for el in elements:
        t = el.get("tags") or {}
        lat = el.get("lat") or (el.get("center") or {}).get("lat")
        lon = el.get("lon") or (el.get("center") or {}).get("lon")
        name = t.get("name")
        if lat is None or not name:
            continue
        if t.get("station") == "subway" or t.get("subway") == "yes":
            accepts = {"metro"}
        elif t.get("railway") == "tram_stop" or t.get("station") == "light_rail" or t.get("tram") == "yes" or t.get("light_rail") == "yes":
            accepts = {"tram", "local_rail"}
        elif t.get("amenity") == "ferry_terminal" or t.get("ferry") == "yes":
            accepts = {"ferry"}
        elif t.get("railway") in ("station", "halt"):
            accepts = {"commuter_rail", "local_rail", "train"}
        else:
            continue
        key = (name, tuple(sorted(accepts)), round(lat, 3), round(lon, 3))
        if key in seen:
            continue
        seen.add(key)
        out.append({"id": f"{el['type'][0]}{el['id']}", "name": name, "lat": lat, "lon": lon, "accepts": accepts})
    return out


def build_from_osm(geo: GeoConfig, colours: TransitColours, out_dir: Path | None = None,
                   client: httpx.Client | None = None, with_bus: bool = True, refresh: bool = False) -> dict[str, Any]:
    codes = sorted(geo.region["kommuner"])
    max_age = float(geo.datasets.get("transit", {}).get("refresh_days", 7)) * 86400
    raw_dir = (out_dir or data_dir()) / "geo" / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    own = client is None
    client = client or httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=400)

    def fetch(name: str, query: str) -> dict:
        """Raw Overpass answers are kept for refresh_days, so rebuilding does not query Overpass again."""
        path = raw_dir / f"osm_transit_{name}.json"
        if not refresh and path.exists() and time.time() - path.stat().st_mtime < max_age:
            return json.loads(path.read_text(encoding="utf-8"))
        data = _overpass(client, query)
        path.write_text(json.dumps(data), encoding="utf-8")
        time.sleep(2)
        return data

    try:
        rail = fetch("rail", f'[out:json][timeout:300];{_area(codes)}'
                             'relation(area.k)["type"="route"]["route"~"^(subway|train|tram|light_rail|ferry)$"];out geom;')
        lines = osm_lines(rail.get("elements", []))
        if with_bus:
            try:
                bus = fetch("bus", f'[out:json][timeout:400];{_area(codes)}'
                                   'relation(area.k)["type"="route"]["route"="bus"];out geom;')
                lines += osm_lines(bus.get("elements", []))
            except httpx.HTTPError as exc:
                log.warning("bus routes skipped: %s", exc)
        st = fetch("stations", f'[out:json][timeout:180];{_area(codes)}'
                               '(nwr(area.k)["railway"~"^(station|halt|tram_stop)$"];'
                               'nwr(area.k)["public_transport"="station"];nwr(area.k)["amenity"="ferry_terminal"];);out center tags;')
        stations = osm_stations(st.get("elements", []))
    finally:
        if own:
            client.close()
    return _finish(lines, stations, colours, geo, "osm", out_dir)


# ── GTFS ────────────────────────────────────────────────────
def _rows(z: zipfile.ZipFile, name: str):
    with z.open(name) as fh:
        yield from csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8-sig"))


def gtfs_lines_and_stations(zip_path: Path) -> tuple[list[dict], list[dict]]:
    with zipfile.ZipFile(zip_path) as z:
        routes = {r["route_id"]: r for r in _rows(z, "routes.txt")}
        shape_use: dict[tuple[str, str], Counter] = defaultdict(Counter)
        for t in _rows(z, "trips.txt"):
            if t.get("shape_id"):
                shape_use[(t["route_id"], t.get("direction_id") or "0")][t["shape_id"]] += 1
        wanted = {c.most_common(1)[0][0]: rid for (rid, _), c in shape_use.items()}
        pts: dict[str, list[tuple[int, float, float]]] = defaultdict(list)
        for s in _rows(z, "shapes.txt"):
            if s["shape_id"] in wanted:
                pts[s["shape_id"]].append((int(s["shape_pt_sequence"]), float(s["shape_pt_lon"]), float(s["shape_pt_lat"])))
        lines = []
        for shape_id, seq in pts.items():
            r = routes[wanted[shape_id]]
            ref = norm_ref(r.get("route_short_name"))
            mode = classify(gtfs_kind(r.get("route_type", "")), ref, f"{r.get('route_long_name', '')} {r.get('route_desc', '')}")
            if mode is None or len(seq) < 2:
                continue
            seq.sort()
            lines.append({"id": r["route_id"], "mode": mode, "ref": ref, "name": r.get("route_long_name") or r.get("route_short_name"),
                          "geom": to_metric(LineString([(lon, lat) for _, lon, lat in seq]))})
        stations = [{"id": s["stop_id"], "name": s["stop_name"], "lat": float(s["stop_lat"]), "lon": float(s["stop_lon"]),
                     "accepts": set(MODES) - {"bus"}}
                    for s in _rows(z, "stops.txt") if s.get("location_type") == "1"]
    return lines, stations


def download_gtfs(geo: GeoConfig, raw_dir: Path | None = None) -> Path | None:
    """data/geo/raw/sl.zip, refreshed when older than refresh_days; None without a key."""
    cfg = geo.datasets.get("transit", {})
    key = secret(cfg.get("key_env", "TRAFIKLAB_GTFS_KEY"))
    if not key:
        return None
    target = (raw_dir or data_dir() / "geo" / "raw") / "sl.zip"
    target.parent.mkdir(parents=True, exist_ok=True)
    max_age = float(cfg.get("refresh_days", 7)) * 86400
    if target.exists() and time.time() - target.stat().st_mtime < max_age:
        return target
    with httpx.stream("GET", cfg.get("gtfs_url", "https://opendata.samtrafiken.se/gtfs/sl/sl.zip"), params={"key": key},
                      headers={"Accept-Encoding": "gzip", "User-Agent": USER_AGENT}, timeout=300, follow_redirects=True) as r:
        r.raise_for_status()
        with target.open("wb") as fh:
            for chunk in r.iter_bytes():
                fh.write(chunk)
    return target


def build_transit(geo: GeoConfig, colours: TransitColours, out_dir: Path | None = None) -> dict[str, Any]:
    for source in geo.datasets.get("transit", {}).get("order", ["gtfs", "osm"]):
        if source == "gtfs":
            zip_path = download_gtfs(geo)
            if zip_path is None:
                log.info("no TRAFIKLAB_GTFS_KEY: skipping GTFS")
                continue
            lines, stations = gtfs_lines_and_stations(zip_path)
            return _finish(lines, stations, colours, geo, "gtfs", out_dir)
        if source == "osm":
            return build_from_osm(geo, colours, out_dir)
    raise RuntimeError("no transit source available (datasets.transit.order)")
