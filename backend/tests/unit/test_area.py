"""Search area function: inside, buffer falloff, overlaps, erasers, zones, scoring integration."""
from __future__ import annotations

import json

import pytest
from shapely.geometry import box, mapping

from findhome.config.loader import load_all
from findhome.domain.scoring import score_listing
from findhome.geo.area import area_eval, compile_area
from findhome.geo.crs import to_wgs84
from findhome.geo.store import load_zones

# A 1 km square in SWEREF 99 TM near Södermalm, and its WGS84 GeoJSON.
X0, Y0 = 674000.0, 6578000.0
SQ = box(X0, Y0, X0 + 1000, Y0 + 1000)


def gj(geom) -> dict:
    return json.loads(json.dumps(mapping(to_wgs84(geom))))


def ll(x: float, y: float) -> tuple[float, float]:
    p = to_wgs84(box(x, y, x + 0.01, y + 0.01).centroid)
    return p.y, p.x


def area(pieces, buffer_m=1000):
    return compile_area({"buffer_m": buffer_m, "pieces": pieces}, None)


def test_inside_scores_weight_and_reports_depth():
    a = area([{"id": "core", "kind": "shape", "weight": 0.8, "geometry": gj(SQ)}])
    r = area_eval(a, *ll(X0 + 500, Y0 + 500))
    assert r.inside and r.distance_m == 0 and r.score == pytest.approx(0.8)
    assert r.depth_m == pytest.approx(500, abs=2)


def test_outside_falls_off_linearly_to_zero_at_buffer():
    a = area([{"id": "core", "kind": "shape", "weight": 1.0, "geometry": gj(SQ)}], buffer_m=1000)
    half = area_eval(a, *ll(X0 + 1500, Y0 + 500))
    assert not half.inside and half.distance_m == pytest.approx(500, abs=2) and half.score == pytest.approx(0.5, abs=0.01)
    assert area_eval(a, *ll(X0 + 2500, Y0 + 500)).score == 0


def test_overlap_takes_best_piece_and_eraser_cuts():
    big = box(X0 - 2000, Y0 - 2000, X0 + 3000, Y0 + 3000)
    hole = box(X0 + 400, Y0 + 400, X0 + 600, Y0 + 600)
    a = area([
        {"id": "maybe", "kind": "shape", "weight": 0.4, "geometry": gj(big)},
        {"id": "core", "kind": "shape", "weight": 1.0, "geometry": gj(SQ)},
        {"id": "no", "kind": "eraser", "geometry": gj(hole)},
    ], buffer_m=1000)
    r = area_eval(a, *ll(X0 + 100, Y0 + 100))
    assert r.best_piece == "core" and r.score == pytest.approx(1.0)
    cut = area_eval(a, *ll(X0 + 500, Y0 + 500))
    assert not cut.inside and cut.distance_m == pytest.approx(100, abs=2)
    assert cut.best_piece == "core" and cut.score == pytest.approx(0.9, abs=0.01)


def test_zone_pieces_use_the_zones_file():
    zones = load_zones()
    if zones is None:
        pytest.skip("data/geo/zones.geojson not built (findhome geo fetch zones)")
    zid = next(z for z in zones.zones.values() if z.kommun_code == "0184").id
    a = compile_area({"buffer_m": 500, "pieces": [{"id": "z", "kind": "zones", "zones": [zid, "0000R999"]}]}, zones)
    assert a.missing_zones == ["0000R999"]
    c = to_wgs84(zones.zones[zid].geom.representative_point())
    r = area_eval(a, c.y, c.x)
    assert r.inside and r.zone["id"] == zid


@pytest.fixture
def area_repo(tmp_repo):
    (tmp_repo / "config" / "search_area.yaml").write_text(json.dumps(
        {"buffer_m": 1000, "pieces": [{"id": "core", "kind": "shape", "weight": 1.0, "geometry": gj(SQ)}]}))
    return tmp_repo


def test_scoring_rejects_beyond_buffer_and_scores_inside(area_repo):
    b = load_all(area_repo / "config", area_repo / "sites")
    base = {"listing_kind": "rent", "pet_status": "yes", "area": "Somewhere else"}
    lat, lon = ll(X0 + 500, Y0 + 500)
    inside = score_listing(b, {**base, "lat": lat, "lon": lon}, [])
    assert inside["rejected_by"] == [] and inside["breakdown"]["area"]["score"] == 1.0
    lat, lon = ll(X0 + 5000, Y0 + 500)
    far = score_listing(b, {**base, "lat": lat, "lon": lon}, [])
    assert "outside_search_area" in far["rejected_by"] and far["total"] is None


def test_no_coordinates_is_area_unknown_not_rejected(area_repo):
    b = load_all(area_repo / "config", area_repo / "sites")
    res = score_listing(b, {"listing_kind": "rent", "pet_status": "yes"}, [])
    assert res["rejected_by"] == []
    assert res["breakdown"]["area"]["score"] is None and "area_unknown" in res["breakdown"]["area"]["why"]


def test_text_area_filters_apply_only_without_a_search_area(tmp_repo):
    b = load_all(tmp_repo / "config", tmp_repo / "sites")
    b.profile.kinds["rent"].hard_filters["areas_include"] = ["Södermalm"]
    res = score_listing(b, {"listing_kind": "rent", "pet_status": "yes", "area": "Bromma"}, [])
    assert "areas_include" in res["rejected_by"]
