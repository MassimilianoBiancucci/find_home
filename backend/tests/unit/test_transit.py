"""Transit build: mode rules, OSM route filtering, GTFS on a tiny feed, station snapping and leg paths (no network)."""
from __future__ import annotations

import json
import zipfile

import pytest

from findhome.config.models import GeoConfig, TransitColours
from findhome.geo import store
from findhome.geo.build_transit import (
    _finish,
    classify,
    gtfs_lines_and_stations,
    norm_ref,
    osm_lines,
    osm_stations,
)

COLOURS = TransitColours.model_validate({"modes": {
    "metro": {"default": "#0089ca", "lines": {"14": "#d71d24"}}, "commuter_rail": {"default": "#ec619f"},
    "local_rail": {"default": "#a05fa5"}, "tram": {"default": "#878787"}, "train": {"default": "#6b6b7a"},
    "bus": {"default": "#d71d24"}, "ferry": {"default": "#3ab4d8"}}})
GEO = GeoConfig.model_validate({"region": {"kommuner": {"0180": "Stockholm"}},
                                "datasets": {"transit": {"station_snap_m": 80, "simplify_m": {"rail": 1, "bus": 1}}}})


@pytest.mark.parametrize(("ref", "expected"), [("T14", "14"), ("J 40", "40"), ("43X", "43X"), ("Tvärbanan", None), (None, None)])
def test_norm_ref(ref, expected):
    assert norm_ref(ref) == expected


@pytest.mark.parametrize(("kind", "ref", "text", "mode"), [
    ("subway", "14", "", "metro"), ("train", "40", "", "commuter_rail"), ("train", "50", "Tåg 50", "train"),
    ("train", "27", "Roslagsbanan 27", "local_rail"), ("light_rail", "30", "Tvärbanan", "tram"),
    ("bus", "27", "Buss 27", "bus"), ("ferry", "80", "", "ferry"), ("monorail", None, "", None)])
def test_classify(kind, ref, text, mode):
    assert classify(kind, ref, text) == mode


def _rel(rid, tags, coords):
    return {"type": "relation", "id": rid, "tags": tags,
            "members": [{"type": "way", "role": "", "geometry": [{"lat": la, "lon": lo} for lo, la in coords]},
                        {"type": "node", "role": "stop", "lat": 0, "lon": 0}]}


LINE = [(18.000, 59.300), (18.010, 59.300), (18.020, 59.300)]


def test_osm_lines_skips_unnumbered_and_future_lines():
    els = [_rel(1, {"route": "subway", "ref": "T14", "name": "Tunnelbana 14"}, LINE),
           _rel(2, {"route": "subway", "name": "Gul linje", "start_date": "2026"}, LINE),
           _rel(3, {"route": "subway", "ref": "20", "name": "Future", "start_date": "2099-01-01"}, LINE),
           _rel(4, {"route": "train", "name": "Tåg 8XX"}, LINE)]           # regional trains may lack a number
    got = osm_lines(els, today="2026-10-31")
    assert [(x["mode"], x["ref"]) for x in got] == [("metro", "14"), ("train", None)]


def test_finish_merges_directions_colours_and_snaps_stations(tmp_path):
    lines = osm_lines([_rel(1, {"route": "subway", "ref": "14"}, LINE), _rel(2, {"route": "subway", "ref": "14"}, LINE[::-1]),
                       _rel(3, {"route": "bus", "ref": "4", "colour": "blue"}, LINE)], today="2026-10-31")
    stations = osm_stations([
        {"type": "node", "id": 9, "lat": 59.3002, "lon": 18.010, "tags": {"name": "Mid", "station": "subway"}},
        {"type": "node", "id": 10, "lat": 59.3003, "lon": 18.0101, "tags": {"name": "Mid", "railway": "station", "subway": "yes"}},
        {"type": "node", "id": 11, "lat": 59.31, "lon": 18.010, "tags": {"name": "Far", "station": "subway"}}])
    meta = _finish(lines, stations, COLOURS, GEO, "osm", tmp_path)
    assert meta["counts"]["metro"] == 1 and meta["counts"]["bus"] == 1 and meta["counts"]["stations"] == 1
    metro = json.loads((tmp_path / "geo/transit/lines_metro.geojson").read_text())["features"][0]["properties"]
    bus = json.loads((tmp_path / "geo/transit/lines_bus.geojson").read_text())["features"][0]["properties"]
    assert metro["colour"] == "#d71d24" and bus["colour"] == "#0089ca"        # config line colour, then OSM colour tag
    st = json.loads((tmp_path / "geo/transit/stations.geojson").read_text())["features"]
    assert st[0]["properties"]["name"] == "Mid" and st[0]["properties"]["lines"] == {"metro": ["14"]}


def test_gtfs_dominant_shape_and_parent_stations(tmp_path):
    zp = tmp_path / "sl.zip"
    with zipfile.ZipFile(zp, "w") as z:
        z.writestr("routes.txt", "route_id,route_short_name,route_long_name,route_type\nr1,14,Fruängen-Mörby,401\nr2,4,,700\n")
        z.writestr("trips.txt", "route_id,trip_id,direction_id,shape_id\nr1,t1,0,s1\nr1,t2,0,s1\nr1,t3,0,s2\nr2,t4,0,s3\n")
        z.writestr("shapes.txt", "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\n"
                                 "s1,59.300,18.020,3\ns1,59.300,18.000,1\ns1,59.300,18.010,2\n"
                                 "s2,59.400,18.000,1\ns2,59.400,18.010,2\ns3,59.300,18.000,1\ns3,59.300,18.020,2\n")
        z.writestr("stops.txt", "stop_id,stop_name,stop_lat,stop_lon,location_type\np1,Mid,59.3002,18.010,1\nq1,Mid A,59.3002,18.010,0\n")
    lines, stations = gtfs_lines_and_stations(zp)
    assert sorted((x["mode"], x["ref"]) for x in lines) == [("bus", "4"), ("metro", "14")]
    metro = next(x for x in lines if x["mode"] == "metro")
    assert metro["geom"].length > 1000                                          # s1 (ordered by sequence), not s2
    assert [s["id"] for s in stations] == ["p1"]


def test_leg_path_follows_the_line(tmp_path, monkeypatch):
    lines = osm_lines([_rel(1, {"route": "subway", "ref": "14"}, LINE)], today="2026-10-31")
    _finish(lines, [], COLOURS, GEO, "osm", tmp_path)
    monkeypatch.setattr(store, "data_dir", lambda: tmp_path)
    store._transit_cache.clear()
    idx = store.load_transit()
    path = idx.leg_path("metro", "14", (18.0201, 59.3001), (18.0001, 59.3001))
    assert path[0][0] > path[-1][0] and len(path) >= 2                         # direction of travel kept
    assert idx.leg_path("metro", "14", (18.0, 59.40), (18.02, 59.40)) is None  # too far from the track
    assert idx.leg_path("metro", "99", (18.0, 59.30), (18.02, 59.30)) is None
