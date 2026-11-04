"""Build data/geo/timetable/: which lines serve each stop, and departures per hour per stop and day kind.

Sources from geo.yaml `datasets.timetable.order`:
- gtfs: SL GTFS Regional (the same sl.zip as the transit layer, downloaded at most every transit.refresh_days);
  `stop_times` is streamed row by row and only counters are kept.
- osm: route relations already fetched for the transit layer (data/geo/raw/osm_transit_*.json); lines per stop
  only, no departures.

Files:
    stops.json       {"source", "ref_dates": {kind: date}, "lines": {line_id: {mode, ref, name}},
                      "stops": {stop_id: {name, lat, lon, parent, lines: [line_id]}}}
    departures.json  {kind: {stop_id: [24 ints]}}   (gtfs only; hour of departure, 24:xx folded to 0)
"""
from __future__ import annotations

import csv
import io
import json
import logging
import zipfile
from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

from findhome.config.models import GeoConfig
from findhome.core.paths import data_dir
from findhome.geo.build_transit import classify, download_gtfs, gtfs_kind, norm_ref

log = logging.getLogger(__name__)
KIND_WEEKDAYS = {"weekday": (1, 2, 3, 0, 4), "saturday": (5,), "sunday": (6,)}   # Tuesday first: a typical day
WEEKDAY_COLS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
STOP_ROLES = ("stop", "stop_entry_only", "stop_exit_only", "platform", "platform_entry_only", "platform_exit_only")


def timetable_dir(base: Path | None = None) -> Path:
    return (base or data_dir()) / "geo" / "timetable"


def _rows(z: zipfile.ZipFile, name: str):
    if name not in z.namelist():
        return
    with z.open(name) as fh:
        yield from csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8-sig"))


def _d(s: str) -> date:
    return date(int(s[:4]), int(s[4:6]), int(s[6:8]))


def active_services(z: zipfile.ZipFile) -> dict[date, set[str]]:
    """service_ids running on each date, from calendar.txt and its calendar_dates.txt exceptions."""
    on: dict[date, set[str]] = defaultdict(set)
    for c in _rows(z, "calendar.txt"):
        d, end = _d(c["start_date"]), _d(c["end_date"])
        while d <= end:
            if c[WEEKDAY_COLS[d.weekday()]] == "1":
                on[d].add(c["service_id"])
            d += timedelta(days=1)
    for c in _rows(z, "calendar_dates.txt"):
        d = _d(c["date"])
        if c["exception_type"] == "1":
            on[d].add(c["service_id"])
        else:
            on[d].discard(c["service_id"])
    return on


def reference_dates(on: dict[date, set[str]], kinds: list[str], today: date) -> dict[str, date]:
    """Per day kind, the first date from today on that has service, preferring Tuesday for weekdays."""
    out: dict[str, date] = {}
    days = sorted(d for d in on if d >= today and on[d])
    for kind in kinds:
        for wd in KIND_WEEKDAYS[kind]:
            hit = next((d for d in days if d.weekday() == wd), None)
            if hit:
                out[kind] = hit
                break
    return out


def from_gtfs(zip_path: Path, kinds: list[str], today: date) -> tuple[dict[str, Any], dict[str, Any]]:
    with zipfile.ZipFile(zip_path) as z:
        lines = {}
        for r in _rows(z, "routes.txt"):
            ref = norm_ref(r.get("route_short_name")) or r.get("route_short_name") or None
            text = f"{r.get('route_long_name', '')} {r.get('route_desc', '')}"
            lines[r["route_id"]] = {"mode": classify(gtfs_kind(r.get("route_type", "")), norm_ref(ref), text) or "other",
                                    "ref": ref, "name": r.get("route_long_name") or r.get("route_short_name")}
        on = active_services(z)
        refs = reference_dates(on, kinds, today)
        trips = {t["trip_id"]: (t["route_id"], t["service_id"]) for t in _rows(z, "trips.txt")}
        active = {k: on[d] for k, d in refs.items()}
        stop_lines: dict[str, set[str]] = defaultdict(set)
        dep: dict[str, dict[str, list[int]]] = {k: defaultdict(lambda: [0] * 24) for k in refs}
        with z.open("stop_times.txt") as fh:
            reader = csv.reader(io.TextIOWrapper(fh, encoding="utf-8-sig"))
            head = next(reader)
            i_trip, i_dep, i_stop = head.index("trip_id"), head.index("departure_time"), head.index("stop_id")
            for row in reader:
                trip = trips.get(row[i_trip])
                if trip is None:
                    continue
                stop = row[i_stop]
                stop_lines[stop].add(trip[0])
                t = row[i_dep]
                if not t:
                    continue
                hour = int(t.split(":", 1)[0]) % 24
                for kind, services in active.items():
                    if trip[1] in services:
                        dep[kind][stop][hour] += 1
        stops = {}
        for s in _rows(z, "stops.txt"):
            if s["stop_id"] not in stop_lines:
                continue
            stops[s["stop_id"]] = {"name": s["stop_name"], "lat": float(s["stop_lat"]), "lon": float(s["stop_lon"]),
                                   "parent": s.get("parent_station") or None, "lines": sorted(stop_lines[s["stop_id"]])}
    used = {lid for s in stops.values() for lid in s["lines"]}
    stops_doc = {"source": "gtfs", "ref_dates": {k: d.isoformat() for k, d in refs.items()},
                 "lines": {k: v for k, v in lines.items() if k in used}, "stops": stops}
    return stops_doc, {k: dict(v) for k, v in dep.items()}


def from_osm(raw_dir: Path) -> dict[str, Any]:
    """Lines per stop from OSM route relations (stop and platform members); no names, no departures."""
    lines: dict[str, dict[str, Any]] = {}
    stops: dict[str, dict[str, Any]] = {}
    for name in ("rail", "bus"):
        path = raw_dir / f"osm_transit_{name}.json"
        if not path.exists():
            continue
        for el in json.loads(path.read_text(encoding="utf-8")).get("elements", []):
            t = el.get("tags") or {}
            ref = t.get("ref")
            mode = classify(t.get("route", ""), norm_ref(ref), f"{t.get('name', '')} {t.get('network', '')}")
            if el.get("type") != "relation" or mode is None:
                continue
            lid = f"osm:{el['id']}"
            members = [m for m in el.get("members", []) if m.get("type") == "node" and m.get("role") in STOP_ROLES
                       and m.get("lat") is not None]
            if not members:
                continue
            lines[lid] = {"mode": mode, "ref": ref, "name": t.get("name")}
            for m in members:
                s = stops.setdefault(f"osm:{m['ref']}", {"name": None, "lat": m["lat"], "lon": m["lon"], "parent": None,
                                                         "lines": []})
                if lid not in s["lines"]:
                    s["lines"].append(lid)
    return {"source": "osm", "ref_dates": {}, "lines": lines, "stops": stops}


def build_timetable(geo: GeoConfig, out_dir: Path | None = None, today: date | None = None) -> dict[str, Any]:
    cfg = geo.datasets.get("timetable") or {}
    kinds = cfg.get("day_kinds", list(KIND_WEEKDAYS))
    target = timetable_dir(out_dir)
    target.mkdir(parents=True, exist_ok=True)
    today = today or datetime.now(UTC).date()
    stops_doc, departures = None, None
    for source in cfg.get("order", ["gtfs", "osm"]):
        if source == "gtfs":
            zip_path = download_gtfs(geo, out_dir / "geo" / "raw" if out_dir else None)
            if zip_path is None:
                log.info("timetable: no TRAFIKLAB_GTFS_KEY, trying the next source")
                continue
            stops_doc, departures = from_gtfs(zip_path, kinds, today)
            break
        if source == "osm":
            stops_doc = from_osm((out_dir or data_dir()) / "geo" / "raw")
            if stops_doc["stops"]:
                break
    if not stops_doc or not stops_doc["stops"]:
        raise RuntimeError("timetable: no source gave any stop (set TRAFIKLAB_GTFS_KEY or run `findhome geo fetch transit`)")
    (target / "stops.json").write_text(json.dumps(stops_doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    dep_path = target / "departures.json"
    if departures is not None:
        dep_path.write_text(json.dumps(departures, separators=(",", ":")), encoding="utf-8")
    elif dep_path.exists():
        dep_path.unlink()                    # an OSM rebuild must not keep stale GTFS departures
    meta = {"source": stops_doc["source"], "built_at": datetime.now(UTC).isoformat(timespec="seconds"),
            "ref_dates": stops_doc["ref_dates"], "stops": len(stops_doc["stops"]), "lines": len(stops_doc["lines"]),
            "departures": bool(departures)}
    (target / "meta.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
    return meta
