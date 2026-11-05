"""Mobility index maths, window counts and percentiles on fictional numbers."""
from __future__ import annotations

from shapely import STRtree
from shapely.geometry import Point

from findhome.geo.store import TimetableIndex
from findhome.zone.analysis import percentiles
from findhome.zone.indices import Components, ServiceInput, combined, indices, score, service_set_score, services_score
from findhome.zone.measure import window_counts

CFG = {
    "access_min": 10,
    "windows": {"morning": {"hours": [7, 9], "weight": 1.0}, "evening": {"hours": [19, 24], "weight": 0.0}},
    "components": {"rail_access": {"zero": 20, "full": 5, "weight": 1.0}, "bus_access": {"zero": 10, "full": 3, "weight": 0.0},
                   "coverage": {"zero": 0, "full": 1, "weight": 1.0}, "lines": {"zero": 0, "full": 10, "weight": 1.0},
                   "frequency": {"zero": 0, "full": 60, "weight": 1.0}},
    "services": {"sets": ["grocery", "park"], "zero": 20, "full": 5, "choice": {"within_min": 10, "full": 4, "weight": 0.5}},
}


def test_score_both_directions_and_clipping():
    assert score(5, 20, 5) == 1.0 and score(20, 20, 5) == 0.0 and score(12.5, 20, 5) == 0.5
    assert score(30, 0, 15) == 1.0 and score(None, 0, 15) is None and score(3, 4, 4) is None


def test_indices_weights_windows_and_renormalise():
    c = Components(rail_access_min=12.5, bus_access_min=3, coverage=0.5,
                   lines={"morning": 5, "evening": 0}, frequency={"morning": 30, "evening": None},
                   services_min={"grocery": 5}, services_choice={"grocery": 4})
    r = indices(c, CFG, set_weights={"grocery": 1.0}, combined_parts={"transport": 0.5, "services": 0.5})
    assert r["windows"]["morning"]["transport"] == 50.0                 # 0.5, 0.5, 0.5, 0.5 (bus weight 0)
    assert r["windows"]["evening"]["transport"] == 33.3                 # frequency missing: 3 components left
    assert r["transport"] == 50.0                                       # evening weight 0
    assert r["services"] == 100.0 and r["combined"] == 75.0             # 50 × 0.5 + 100 × 0.5
    assert "transport_services" not in r and r["windows"]["morning"]["combined"] == 75.0
    d = r["derivation"]
    assert d["services"]["rows"][0]["name"] == "grocery" and d["services"]["total"] == 100.0
    assert [x["name"] for x in d["combined"]["rows"]] == ["transport", "services"] and d["combined"]["total"] == 75.0
    assert {x["name"] for x in d["transport"]["rows"]} >= {"Walk to rail", "Lines"}
    none = indices(Components(None, None, None), CFG)
    assert none["transport"] is None and none["services"] is None and none["combined"] is None


def test_service_set_score_proximity_choice_and_missing():
    assert service_set_score(ServiceInput(5, 4), CFG) == 1.0                    # both full
    assert service_set_score(ServiceInput(12.5, 2), CFG) == 0.5                 # 0.5 and 0.5
    assert service_set_score(ServiceInput(12.5, None), CFG) == 0.5              # choice unmeasured: proximity only
    assert service_set_score(ServiceInput(None, 0), CFG) == 0.0                 # nothing within reach: a real zero
    assert service_set_score(ServiceInput(None, None), CFG) is None             # not measured at all
    no_choice = {**CFG, "services": {k: v for k, v in CFG["services"].items() if k != "choice"}}
    assert service_set_score(ServiceInput(12.5, 0), no_choice) == 0.3           # default choice weight 0.4: 0.5×0.6 + 0


def test_services_weighted_by_set_and_combined_renormalises():
    value, rows = services_score({"grocery": ServiceInput(5, 4), "park": ServiceInput(None, 0)},
                                 {"grocery": 1.0, "park": 0.25}, CFG)
    assert value == 80.0                                                          # (1 × 1 + 0 × 0.25) / 1.25
    assert rows[1]["input"].startswith("none within reach") and rows[1]["score"] == 0.0
    assert combined({"transport": 60, "services": None}, {"transport": 0.5, "services": 0.5}) == 60.0
    assert combined({"transport": None, "services": None}, {"transport": 1}) is None
    assert combined({"transport": 40, "services": 80}, {"transport": 1, "services": 3}) == 70.0


def test_set_weights_take_the_highest_category_weight():
    from types import SimpleNamespace as NS

    from findhome.zone.analysis import set_weights

    bundle = NS(poi=NS(categories={"gym": NS(weight=0.3), "sats": NS(weight=1.0), "park": NS(weight=0.6)}),
                zone=NS(target_sets={"gym": NS(poi=["gym", "sats"]), "park": NS(poi=["park"]), "rail": NS(poi=[])}))
    assert set_weights(bundle) == {"gym": 1.0, "park": 0.6, "rail": 1.0}


def _tt(source="gtfs"):
    lines = {"M": {"mode": "metro", "ref": "13"}, "B": {"mode": "bus", "ref": "4"}, "N": {"mode": "bus", "ref": "94"}}
    stops = {"s1": {"lines": ["M", "B"]}, "s2": {"lines": ["N"]}}
    dep = {"weekday": {"s1": {"M": [0] * 7 + [10, 10] + [0] * 15, "B": [0] * 7 + [4, 0] + [0] * 15},
                       "s2": {"N": [0] * 23 + [2]}}} if source == "gtfs" else {}
    pts = [Point(0, 0), Point(1, 1)]
    return TimetableIndex(source, {}, lines, stops, dep, ["s1", "s2"], pts, STRtree(pts), 0.0)


def test_window_counts_lines_and_frequency():
    tt = _tt()
    assert window_counts(tt, ["s1", "s2"], (7, 9)) == (4.0, 12.0)        # metro ×3 + bus 4; (20 + 4) / 2 h at s1
    assert window_counts(tt, ["s1", "s2"], (19, 24)) == (1.0, 0.4)       # only the night bus: 2 / 5 h
    assert window_counts(_tt("osm"), ["s1", "s2"], (7, 9)) == (5.0, None)  # no timetable: every line, no frequency


def test_percentiles():
    p = percentiles({"a": 10, "b": 20, "c": 20, "d": None})
    assert p == {"a": 16.7, "b": 66.7, "c": 66.7, "d": None}
    assert percentiles({"x": None}) == {"x": None}
