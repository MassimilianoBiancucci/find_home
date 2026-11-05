"""House analysis helpers on the hand-made 3×3 street grid of test_heatmap (100 m blocks, 1 m/s). Fictional data."""
from __future__ import annotations

from shapely.geometry import Point

from findhome.zone.heatmap import ExtentGraph
from findhome.zone.house import better_than, estimates, insights, walk_paths
from test_heatmap import EXT, P, STEP, X0, Y0, _grid


def _eg():
    return ExtentGraph(_grid(), EXT, P, [])


def test_walk_paths_nearest_target_path_and_count():
    eg = _eg()
    house = Point(X0 + 10, Y0)                                       # 10 m east of node 1, on the bottom street
    targets = {"a": [(Point(X0 + 2 * STEP, Y0), "Corner shop"), (Point(X0 + 2 * STEP, Y0 + 2 * STEP), "Far shop")]}
    w = walk_paths(eg, house, targets, cutoff_s=1000, within_s=250)["a"]
    assert w.target_name == "Corner shop" and w.minutes == round(210 / 60, 1)     # 10 m snap + 2 blocks
    assert w.count_within == 1                                                    # the far shop is 410 s away
    assert w.path[0] != w.path[-1] and len(w.path) >= 4                           # house, nodes 1-2-3, target
    assert 200 <= w.metres <= 230


def test_walk_paths_nothing_within_cutoff():
    eg = _eg()
    w = walk_paths(eg, Point(X0, Y0), {"a": [(Point(X0 + 2 * STEP, Y0 + 2 * STEP), "Far")]}, cutoff_s=150, within_s=100)["a"]
    assert w.minutes is None and w.path == [] and w.count_within == 0


def test_estimates_cheapest_station_then_zone_then_none():
    rows = [  # station minutes to the point, per window
        {"station_key": "s1", "point_id": "office", "direction": "to_point", "day_type": "weekday", "window_label": "am",
         "window_weight": 1.0, "minutes": 20},
        {"station_key": "s2", "point_id": "office", "direction": "to_point", "day_type": "weekday", "window_label": "am",
         "window_weight": 1.0, "minutes": 15},
        {"station_key": "s2", "point_id": "office", "direction": "from_point", "day_type": "weekday", "window_label": "pm",
         "window_weight": 0.5, "minutes": 30},
    ]
    zone_rows = [{"point_id": "hub", "window_weight": 1.0, "minutes": 40}]
    out = {e["point_id"]: e for e in estimates({"s1": 3, "s2": 12}, rows, zone_rows,
                                               {"office": "Office", "hub": "Hub", "gym": "Gym"})}
    # am: s1 3 + 20 = 23 beats s2 12 + 15 = 27; pm: only s2, 42; weighted (23 × 1 + 42 × 0.5) / 1.5
    assert out["office"]["source"] == "stations" and out["office"]["minutes"] == round((23 + 21) / 1.5, 1)
    assert out["office"]["station"] == "s1" and out["office"]["walk_min"] == 3
    assert out["hub"] == {"point_id": "hub", "label": "Hub", "source": "zone", "minutes": 40.0}
    assert out["gym"]["minutes"] is None and out["gym"]["source"] is None


def test_better_than_and_insight_lines():
    assert better_than(30, [20, 30, 40, 50]) == 62.5            # two longer, one tie (half)
    assert better_than(30, []) is None
    house = {"walk_colours": {"green": 5, "yellow": 10}, "set_labels": {"grocery": "Groceries", "vet": "Vets"},
             "walks": {"grocery": {"minutes": 3.1}, "vet": {"minutes": None}}}
    est = [{"point_id": "office", "label": "Office", "minutes": 34.0}, {"point_id": "hub", "label": "Hub", "minutes": None}]
    out = insights(house, {"grocery": {"walk_min": 6}}, est, {"office": 31.0}, {"office": [20, 40, 50, 60]}, {})
    assert out["sets"][0] == {"set": "grocery", "text": "Groceries: 3.1 min (zone median 6 min)", "tone": "good"}
    assert out["sets"][1]["tone"] == "bad" and "none within reach" in out["sets"][1]["text"]
    assert out["points"][0]["text"] == "Office: 34 min estimate (zone 31 min, better than 75% of zones)"
    assert out["points"][0]["tone"] == "good" and out["points"][1]["text"] == "Hub: not computed yet"
    own = insights(house, None, est, {}, {}, {"office": 28.0})
    assert own["points"][0]["text"] == "Office: 28 min"         # the listing's own commute wins over the estimate
