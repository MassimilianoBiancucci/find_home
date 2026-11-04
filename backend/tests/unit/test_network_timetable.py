"""Walking / cycling network build and load, and the timetable (GTFS and OSM) build, on fictional fixtures."""
from __future__ import annotations

import csv
import gzip
import io
import json
import zipfile
from datetime import date

from shapely.geometry import Point

from findhome.geo import build_timetable as bt
from findhome.geo import store
from findhome.geo.build_network import access, edges_from_ways
from findhome.geo.crs import point_metric
from findhome.zone.network import load_network

RULES = {"walk": ["footway", "residential", "steps", "path"], "bike": ["residential", "path", "cycleway"],
         "bike_if_allowed": ["footway"]}


def test_access_rules():
    assert access({"highway": "footway"}, RULES) == (True, False)
    assert access({"highway": "footway", "bicycle": "designated"}, RULES) == (True, True)
    assert access({"highway": "residential", "foot": "no"}, RULES) == (False, True)
    assert access({"highway": "residential", "access": "private"}, RULES) == (False, False)
    assert access({"highway": "residential", "access": "private", "foot": "yes"}, RULES) == (True, False)
    assert access({"highway": "motorway"}, RULES) == (False, False)
    assert access({"highway": "cycleway"}, RULES) == (False, True)


def _way(wid, nodes, coords, **tags):
    return {"type": "way", "id": wid, "nodes": nodes, "tags": tags,
            "geometry": [{"lat": lat, "lon": lon} for lat, lon in coords]}


# A T junction: way 1 runs 1-2-3, way 2 leaves node 2 north to node 4; way 3 is a motorway (dropped).
WAYS = [
    _way(1, [1, 2, 3], [(59.300, 18.000), (59.300, 18.002), (59.300, 18.004)], highway="residential"),
    _way(2, [2, 4], [(59.300, 18.002), (59.302, 18.002)], highway="footway"),
    _way(3, [3, 5], [(59.300, 18.004), (59.300, 18.010)], highway="motorway"),
]


def test_ways_split_at_shared_nodes():
    nodes, edges = edges_from_ways(WAYS, RULES)
    pairs = sorted((e[0], e[1]) for e in edges)
    assert pairs == [(1, 2), (2, 3), (2, 4)] and set(nodes) == {1, 2, 3, 4}
    e12 = next(e for e in edges if (e[0], e[1]) == (1, 2))
    x1, _ = point_metric(18.000, 59.300)
    x2, _ = point_metric(18.002, 59.300)
    assert abs(e12[2] - abs(x2 - x1)) < 1.0 and e12[3] == "residential" and e12[4] and e12[5]
    e24 = next(e for e in edges if (e[0], e[1]) == (2, 4))
    assert e24[4] and not e24[5] and len(e24[6]) == 2


def test_network_loads_merges_and_snaps(tmp_path):
    d = tmp_path / "geo" / "network"
    d.mkdir(parents=True)
    nodes, edges = edges_from_ways(WAYS, RULES)
    for code, part in (("0001", edges[:2]), ("0002", edges[1:])):          # edge 2 sits in both files (border)
        doc = {"kommun": code, "nodes": {str(k): v for k, v in nodes.items()}, "edges": part}
        (d / f"{code}.json.gz").write_bytes(gzip.compress(json.dumps(doc).encode()))
    net = load_network(["0002", "0001"], tmp_path)
    assert len(net.edges) == 3 and load_network(("0001", "0002"), tmp_path) is net          # merged, cached
    walk, bike = net.graph("walk"), net.graph("bike")
    assert walk.number_of_edges() == 3 and bike.number_of_edges() == 2                     # footway: walk only
    x, y = point_metric(18.0021, 59.3019)
    node, dist = net.nearest_node(x, y, "walk")
    assert node == 4 and dist < 20
    assert net.nearest_node(x, y, "bike")[0] == 2                                           # 4 is walk-only
    assert load_network(["9999"], tmp_path) is None


def _csv(rows: list[list[str]]) -> str:
    buf = io.StringIO()
    csv.writer(buf).writerows(rows)
    return buf.getvalue()


def _gtfs(path):
    """Two lines (metro 13, bus 4), three stops; S1 is a platform of station P1. 2026-11-10 is a Tuesday."""
    files = {
        "routes.txt": [["route_id", "route_short_name", "route_long_name", "route_type"],
                       ["R13", "13", "Röda linjen", "401"], ["R4", "4", "", "700"]],
        "stops.txt": [["stop_id", "stop_name", "stop_lat", "stop_lon", "location_type", "parent_station"],
                      ["P1", "Exempelplan", "59.30", "18.00", "1", ""],
                      ["S1", "Exempelplan", "59.30", "18.00", "0", "P1"],
                      ["S2", "Testgatan", "59.31", "18.01", "0", ""], ["S3", "Unused", "59.32", "18.02", "0", ""]],
        "calendar.txt": [["service_id", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
                          "start_date", "end_date"],
                         ["WD", "1", "1", "1", "1", "1", "0", "0", "20261101", "20261130"],
                         ["WE", "0", "0", "0", "0", "0", "1", "1", "20261101", "20261130"]],
        "calendar_dates.txt": [["service_id", "date", "exception_type"], ["WD", "20261103", "2"]],   # no service Tue 3rd
        "trips.txt": [["route_id", "service_id", "trip_id"], ["R13", "WD", "t1"], ["R13", "WD", "t2"],
                      ["R4", "WE", "t3"], ["R4", "WD", "t4"]],
        "stop_times.txt": [["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"],
                           ["t1", "08:00:00", "08:01:00", "S1", "1"], ["t2", "08:30:00", "08:31:00", "S1", "1"],
                           ["t2", "08:40:00", "08:41:00", "S2", "2"], ["t3", "25:10:00", "25:10:00", "S2", "1"],
                           ["t4", "17:00:00", "17:00:00", "S2", "1"]],
    }
    with zipfile.ZipFile(path, "w") as z:
        for name, rows in files.items():
            z.writestr(name, _csv(rows))
    return path


def test_gtfs_lines_per_stop_and_departures(tmp_path):
    stops, dep = bt.from_gtfs(_gtfs(tmp_path / "sl.zip"), ["weekday", "saturday", "sunday"], date(2026, 11, 2))
    assert stops["ref_dates"] == {"weekday": "2026-11-10", "saturday": "2026-11-07", "sunday": "2026-11-08"}
    assert set(stops["stops"]) == {"S1", "S2"} and stops["stops"]["S1"]["parent"] == "P1"
    assert stops["stops"]["S2"]["lines"] == ["R13", "R4"]
    assert stops["lines"]["R13"]["mode"] == "metro" and stops["lines"]["R4"]["mode"] == "bus"
    assert dep["weekday"]["S1"][8] == 2 and dep["weekday"]["S2"][8] == 1 and dep["weekday"]["S2"][17] == 1
    assert dep["saturday"]["S2"][1] == 1 and sum(dep["saturday"]["S2"]) == 1                # 25:10 → 01


def test_osm_fallback_lines_per_stop(tmp_path):
    raw = tmp_path / "raw"
    raw.mkdir()
    rel = {"type": "relation", "id": 7, "tags": {"route": "bus", "ref": "4", "name": "Buss 4"},
           "members": [{"type": "node", "ref": 11, "role": "stop", "lat": 59.30, "lon": 18.00},
                       {"type": "node", "ref": 12, "role": "platform", "lat": 59.31, "lon": 18.01},
                       {"type": "way", "ref": 99, "role": ""}]}
    (raw / "osm_transit_bus.json").write_text(json.dumps({"elements": [rel]}))
    doc = bt.from_osm(raw)
    assert doc["source"] == "osm" and set(doc["stops"]) == {"osm:11", "osm:12"}
    assert doc["lines"]["osm:7"]["mode"] == "bus" and doc["stops"]["osm:11"]["lines"] == ["osm:7"]


def test_timetable_index(tmp_path, monkeypatch):
    stops, dep = bt.from_gtfs(_gtfs(tmp_path / "sl.zip"), ["weekday"], date(2026, 11, 2))
    d = tmp_path / "timetable"
    d.mkdir()
    (d / "stops.json").write_text(json.dumps(stops))
    (d / "departures.json").write_text(json.dumps(dep))
    (d / "meta.json").write_text("{}")
    monkeypatch.setattr(bt, "timetable_dir", lambda base=None: d)
    store._timetable_cache.clear()
    idx = store.load_timetable()
    near = idx.stops_near(Point(point_metric(18.0, 59.3)), 200)
    assert [s for _, s in near] == ["S1"]
    assert [ln["ref"] for ln in idx.lines_at("S2")] == ["13", "4"]
    assert idx.departures_at("S1", "weekday")[8] == 2 and idx.departures_at("S3", "weekday") == [0] * 24
