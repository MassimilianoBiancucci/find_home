"""House analysis: one home measured from its exact address, with the zone engines and the zone index formulas.

From the address, on the street network (no API calls):
- per target set (grocery, pharmacy, gym, park, vet, rail, bus): the walk to the nearest target, its path, and how
  many targets are within the choice window;
- the house's transport, services and combined indices, from `indices()` fed with these values (coverage, a share
  of a zone's homes, has no meaning for one point and is left out);
- the walk to each of the zone's connectivity stations, for the station estimate of the trips to your points.

`estimates()` and `insights()` are pure helpers the API uses with stored rows. No database here.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from itertools import pairwise
from typing import Any

import networkx as nx
from shapely.geometry import Point

from findhome.config.loader import ConfigBundle
from findhome.geo.crs import point_metric, points_wgs84
from findhome.geo.store import ZoneSet, load_timetable
from findhome.zone.extent import Extent, neighbours
from findhome.zone.heatmap import SOURCE, ExtentGraph, HeatmapParams
from findhome.zone.network import EDGE_GEOM, EDGE_U, load_network

DEFAULT_SETS = ["grocery", "pharmacy", "gym", "park", "vet", "rail", "bus"]
PAYLOAD_VERSION = 2               # bump when the payload shape changes, so cached rows are recomputed


class OutsideZones(Exception):
    """The address is outside every zone (no network, no zone to compare with)."""


@dataclass
class Walk:
    set_id: str
    minutes: float | None                      # None: nothing within the cut-off
    metres: float | None
    target_name: str | None
    target_lonlat: tuple[float, float] | None
    path: list[list[float]]                    # WGS84 [lon, lat], house → target, for the map
    count_within: int                          # targets within choice.within_min

    def as_dict(self) -> dict[str, Any]:
        return {"set": self.set_id, "minutes": self.minutes, "metres": self.metres, "target": self.target_name,
                "target_lonlat": self.target_lonlat, "path": self.path, "count_within": self.count_within}


def house_cfg(bundle: ConfigBundle) -> dict[str, Any]:
    h = dict(bundle.zone.house or {})
    h.setdefault("cutoff_min", 30)
    h.setdefault("sets", DEFAULT_SETS)
    return h


def house_extent(zones: ZoneSet, x: float, y: float, reach_m: float) -> Extent:
    """The house's zone, and a circle of the walking reach around the address (the network and targets to load)."""
    z = zones.containing(Point(x, y))
    if z is None:
        raise OutsideZones("the address is outside every zone")
    here = Point(x, y)
    search = here.buffer(reach_m)
    kommuner = sorted({zones.zones[zones.order[int(i)]].kommun_code for i in zones.tree.query(search, predicate="intersects")})
    return Extent(z.id, (z.id,), here.buffer(1.0), search, tuple(kommuner))


def _edge_coords(eg: ExtentGraph, u: int, v: int) -> list[list[float]]:
    """The street geometry from node u to node v (EPSG:3006), reversed when the edge is stored v → u."""
    e = eg.net.edges[eg.g[u][v]["idx"]]
    coords = [list(c) for c in e[EDGE_GEOM]]
    return coords if e[EDGE_U] == u else coords[::-1]


def walk_paths(eg: ExtentGraph, origin: Point, targets: dict[str, list[tuple[Point, str]]], cutoff_s: float,
               within_s: float) -> dict[str, Walk]:
    """One Dijkstra from the address (snap walk included): the nearest target of each set with its path, and the
    number of targets within `within_s`."""
    snap = eg.snap(origin)
    if snap is None:
        return {sid: Walk(sid, None, None, None, None, [], 0) for sid in targets}
    t0 = snap[1] / eg.p.speed_mps
    eg.g.add_edge(SOURCE, snap[0], t=t0)
    try:
        dist, paths = nx.single_source_dijkstra(eg.g, SOURCE, cutoff=cutoff_s, weight="t")
    finally:
        eg.g.remove_node(SOURCE)
    out: dict[str, Walk] = {}
    for sid, pts in targets.items():
        best: tuple[float, Point, str, int] | None = None
        count = 0
        for pt, name in pts:
            s = eg.snap(pt)
            if s is None or s[0] not in dist:
                continue
            t = dist[s[0]] + s[1] / eg.p.speed_mps
            if t <= within_s:
                count += 1
            if t <= cutoff_s and (best is None or t < best[0]):
                best = (t, pt, name, s[0])
        if best is None:
            out[sid] = Walk(sid, None, None, None, None, [], count)
            continue
        t, pt, name, node = best
        nodes = paths[node][1:]                                   # drop the virtual source
        coords = [[origin.x, origin.y]] + [list(eg.net.nodes[nodes[0]])]
        for u, v in pairwise(nodes):
            coords += _edge_coords(eg, u, v)[1:]
        coords.append([pt.x, pt.y])
        metres = sum(((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5 for a, b in pairwise(coords))
        wgs = points_wgs84([c[0] for c in coords], [c[1] for c in coords])
        (lon, lat), = points_wgs84([pt.x], [pt.y])
        out[sid] = Walk(sid, round(t / 60, 1), round(metres), name, (round(lon, 6), round(lat, 6)),
                        [[round(a, 6), round(b, 6)] for a, b in wgs], count)
    return out


def station_walks(eg: ExtentGraph, origin: Point, stations: dict[str, dict[str, Any]], cutoff_s: float) -> dict[str, float]:
    """Walk minutes from the address to each station centre within the cut-off."""
    snap = eg.snap(origin)
    if snap is None or not stations:
        return {}
    times = eg.times_from({snap[0]: snap[1] / eg.p.speed_mps}, cutoff_s)
    out = {}
    for key, st in stations.items():
        x, y = point_metric(st["lon"], st["lat"])
        s = eg.snap(Point(x, y))
        if s and s[0] in times:
            out[key] = round((times[s[0]] + s[1] / eg.p.speed_mps) / 60, 1)
    return out


def version(bundle: ConfigBundle, lat: float, lon: float) -> str:
    """Changes with the zone inputs (datasets, zone.yaml, poi.yaml), the centroids and the address."""
    from findhome.zone.analysis import version as zone_version
    from findhome.zone.centroid_build import load_centroids

    doc = load_centroids()
    blob = json.dumps([PAYLOAD_VERSION, zone_version(bundle, house_cfg(bundle)["sets"]), doc and doc.get("version"),
                       round(lat, 5), round(lon, 5)])
    return hashlib.sha256(blob.encode()).hexdigest()[:16]


def house_analysis(bundle: ConfigBundle, zones: ZoneSet, lat: float, lon: float) -> dict[str, Any]:
    """Everything measured from the address. Raises OutsideZones, or analysis.MissingData for a missing dataset."""
    from findhome.zone.analysis import MissingData, set_weights, targets_for
    from findhome.zone.centroid_build import load_centroids
    from findhome.zone.indices import (
        COMPONENT_LABELS,
        Components,
        ServiceInput,
        choice_cfg,
        indices,
        service_set_score,
    )
    from findhome.zone.measure import reachable_stops, window_counts
    from findhome.zone.targets import stop_modes

    z = bundle.zone
    hc = house_cfg(bundle)
    cutoff_s = float(hc["cutoff_min"]) * 60
    p = HeatmapParams("walk", z.speeds_mps["walk"], cutoff_s, z.snap_max_m, dict(z.factors))
    x, y = point_metric(lon, lat)
    origin = Point(x, y)
    ext = house_extent(zones, x, y, p.speed_mps * cutoff_s)
    net = load_network(ext.kommuner)
    if net is None:
        raise MissingData("no walking network yet: run `findhome geo fetch network`")
    sets = [s for s in hc["sets"] if s in z.target_sets]
    found = targets_for(bundle, ext, sets)
    eg = ExtentGraph(net, ext, p, [])
    icfg = z.indices
    within = choice_cfg(icfg)["within_min"] * 60
    walks = walk_paths(eg, origin, found, cutoff_s, within)

    # transport from the address: walks to rail and bus, lines and departures at the stops within access_min
    tt = load_timetable()
    snap = eg.snap(origin)
    comps = Components(rail_access_min=walks["rail"].minutes if "rail" in walks else None,
                       bus_access_min=walks["bus"].minutes if "bus" in walks else None, coverage=None)
    stops_detail: dict[str, Any] = {"reachable_stops": None, "modes": []}
    if tt is not None and snap is not None:
        stops = [s for s, _ in reachable_stops(eg, tt, icfg["access_min"], starts={snap[0]: snap[1] / p.speed_mps})]
        for w, spec in icfg["windows"].items():
            comps.lines[w], comps.frequency[w] = window_counts(tt, stops, tuple(spec["hours"]))
        stops_detail = {"reachable_stops": len(stops), "modes": sorted({m for s in stops for m in stop_modes(tt, s)}),
                        "lines": comps.lines, "frequency": comps.frequency}
    service_sets = [s for s in icfg["services"]["sets"] if s in walks]
    for sid in service_sets:
        comps.services_min[sid] = walks[sid].minutes
        comps.services_choice[sid] = float(walks[sid].count_within)
    weights = set_weights(bundle)
    ix = indices(comps, icfg, weights, (z.combined or {}).get("parts"))
    t_rows = [r for r in ix["derivation"]["transport"]["rows"] if r["name"] != COMPONENT_LABELS["coverage"]]
    ix["derivation"]["transport"] = {**ix["derivation"]["transport"], "rows": t_rows,
                                     "note": "Measured from the address; coverage (a share of a zone's homes) is left out."}
    services_detail = {sid: {"label": z.target_sets[sid].label, "walk_min": walks[sid].minutes,
                             "choice": float(walks[sid].count_within), "weight": weights.get(sid, 1.0),
                             "score": service_set_score(ServiceInput(walks[sid].minutes, float(walks[sid].count_within)), icfg)}
                       for sid in service_sets}

    doc = load_centroids()
    zone_stations = {}
    if doc and ext.zone_id in doc["zones"]:
        zone_stations = {c["key"]: doc["stations"][c["key"]] for c in doc["zones"][ext.zone_id]["centroids"]
                         if c["key"] in doc["stations"]}
    zz = zones.zones[ext.zone_id]
    return {
        "lat": lat, "lon": lon,
        "zone": {"id": zz.id, "name": zz.name, "district": zz.district, "kommun": zz.kommun,
                 "neighbours": neighbours(zones, zz.id)},
        "snapped": snap is not None, "snap_m": None if snap is None else round(snap[1]),
        "sets": list(walks),                                  # display order (jsonb objects do not keep it)
        "walks": {sid: w.as_dict() for sid, w in walks.items()},
        "set_labels": {sid: z.target_sets[sid].label for sid in walks},
        "transport": ix["transport"], "services": ix["services"], "combined": ix["combined"],
        "windows": ix["windows"], "derivation": ix["derivation"], "services_detail": services_detail,
        "stops": stops_detail, "choice_within_min": within / 60, "cutoff_min": cutoff_s / 60,
        "walk_colours": dict(z.walk_colours or {"green": 5, "yellow": 10}),
        "station_walks": station_walks(eg, origin, zone_stations, cutoff_s),
        "stations": {k: {"name": v.get("name"), "group": v.get("group"), "lat": v["lat"], "lon": v["lon"]}
                     for k, v in zone_stations.items()},
    }


def estimates(station_walks: dict[str, float], rows: list[dict], zone_rows: list[dict],
              labels: dict[str, str]) -> list[dict[str, Any]]:
    """Per point: walk to the best station + stored station → point minutes, window-weighted.

    rows: centroid_commute rows of the zone's stations (station_key, point_id, direction, day_type, window_label,
    window_weight, minutes). For each trip window the cheapest station (walk + transit) wins. A point without
    station rows falls back to the zone's own row (zone_rows: zone_commute rows of the zone), then to None."""
    best: dict[tuple, tuple[float, float, str, float]] = {}       # trip window → (total, weight, station, walk)
    for r in rows:
        walk = station_walks.get(r["station_key"])
        if walk is None or r["minutes"] is None:
            continue
        key = (r["point_id"], r["direction"], r["day_type"], r["window_label"])
        total = walk + float(r["minutes"])
        if key not in best or total < best[key][0]:
            best[key] = (total, float(r["window_weight"]), r["station_key"], walk)
    out: dict[str, dict[str, Any]] = {}
    per: dict[str, list[tuple[float, float, str, float]]] = {}
    for (pid, *_), v in best.items():
        per.setdefault(pid, []).append(v)
    for pid, vs in per.items():
        tw = sum(w for _, w, _, _ in vs) or 1.0
        top = min(vs, key=lambda v: v[0])
        out[pid] = {"point_id": pid, "label": labels.get(pid, pid), "minutes": round(sum(t * w for t, w, _, _ in vs) / tw, 1),
                    "source": "stations", "station": top[2], "walk_min": top[3], "windows": len(vs)}
    zp: dict[str, list[tuple[float, float]]] = {}
    for r in zone_rows:
        if r["minutes"] is not None:
            zp.setdefault(r["point_id"], []).append((float(r["minutes"]), float(r["window_weight"])))
    for pid, label in labels.items():
        if pid in out:
            continue
        if pid in zp:
            vs = zp[pid]
            out[pid] = {"point_id": pid, "label": label, "source": "zone",
                        "minutes": round(sum(m * w for m, w in vs) / (sum(w for _, w in vs) or 1), 1)}
        else:
            out[pid] = {"point_id": pid, "label": label, "source": None, "minutes": None}
    return [out[p] for p in labels if p in out]


def _tone(minutes: float | None, colours: dict[str, float]) -> str:
    if minutes is None:
        return "bad"
    return "good" if minutes <= colours.get("green", 5) else "neutral" if minutes <= colours.get("yellow", 10) else "bad"


def better_than(minutes: float, others: list[float]) -> float | None:
    """Share (0-100) of the values that take longer than `minutes`; ties count half."""
    if not others:
        return None
    longer = sum(1 for v in others if v > minutes) + 0.5 * sum(1 for v in others if v == minutes)
    return round(100 * longer / len(others), 1)


def insights(house: dict[str, Any], zone_detail: dict[str, Any] | None, estimates_: list[dict[str, Any]],
             zone_minutes: dict[str, float | None], all_zones: dict[str, list[float]],
             listing_commute: dict[str, float]) -> dict[str, list[dict[str, Any]]]:
    """Short lines comparing the house with its zone and with every zone: per service set and per point.

    zone_minutes: per point, the house's zone's window-weighted minutes. all_zones: per point, every zone's minutes
    (for "better than N % of zones"). listing_commute: per point, the listing's own computed minutes
    (window-weighted), preferred over the station estimate when present."""
    colours = house.get("walk_colours") or {}
    sets = []
    for sid in house.get("sets") or house["walks"]:
        w = house["walks"][sid]
        zd = (zone_detail or {}).get(sid) or {}
        label = house["set_labels"].get(sid, sid)
        mine = "none within reach" if w["minutes"] is None else f"{w['minutes']:g} min"
        zone = zd.get("walk_min")
        comp = "" if zone is None else f" (zone median {zone:g} min)"
        sets.append({"set": sid, "text": f"{label}: {mine}{comp}", "tone": _tone(w["minutes"], colours)})
    points = []
    for e in estimates_:
        pid = e["point_id"]
        own = listing_commute.get(pid)
        m = own if own is not None else e["minutes"]
        if m is None:
            points.append({"point_id": pid, "text": f"{e['label']}: not computed yet", "compare": "", "tone": "neutral"})
            continue
        kind = "" if own is not None else " estimate"
        parts = [f"{e['label']}: {m:g} min{kind}"]
        zm, pct = zone_minutes.get(pid), better_than(m, all_zones.get(pid) or [])
        if zm is not None:
            parts.append(f"zone {zm:g} min")
        if pct is not None:
            parts.append(f"better than {round(pct)}% of zones")
        tone = "good" if pct is not None and pct >= 66 else "bad" if pct is not None and pct < 33 else "neutral"
        points.append({"point_id": pid, "text": parts[0] + (f" ({', '.join(parts[1:])})" if len(parts) > 1 else ""),
                       "compare": ", ".join(parts[1:]), "tone": tone})
    return {"sets": sets, "points": points}
