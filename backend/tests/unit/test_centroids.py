"""Connectivity centroid selection: one greedy cover per group over the homes' walk times. Fictional numbers."""
from __future__ import annotations

from shapely.geometry import Point

from findhome.zone.centroids import Candidate, cover, select

CFG = {"walk_min": 5, "coverage": 0.9, "min_gain": 0.05, "groups": {"rail": [], "bus": []}}


def _c(key, group, lines=1):
    return Candidate(key, key, group, Point(0, 0), [Point(0, 0)], lines)


def test_two_groups_are_covered_separately():
    cands = [_c("metro", "rail", 6), _c("busA", "bus"), _c("busB", "bus")]
    # four homes: all near the metro; homes 0-1 near bus A, homes 2-3 near bus B
    walk = [{0: 100, 1: 60}, {0: 120, 1: 90}, {0: 200, 2: 30}, {0: 250, 2: 80}]
    sel = select(walk, [1, 1, 1, 1], cands, CFG)
    assert sel["chosen"] == [0, 1, 2] and sel["coverage"] == {"rail": 1.0, "bus": 1.0}   # buses kept to compare


def test_cover_stops_below_min_gain_and_prefers_more_lines_on_ties():
    cands = [_c("a", "bus", 1), _c("b", "bus", 4), _c("c", "bus", 1)]
    walk = [{0: 60, 1: 60}] * 19 + [{2: 60}]                    # a and b tie on 19 homes; c adds 1 of 20 = 5 %
    chosen, share = cover(walk, [1.0] * 20, cands, [0, 1, 2], 300, 1.0, 0.06)
    assert chosen == [1] and share == 0.95                       # b wins the tie, c is below min_gain
    assert cover(walk, [1.0] * 20, cands, [0, 1, 2], 300, 1.0, 0.05)[0] == [1, 2]


def test_a_group_with_nothing_near_keeps_a_reference_station():
    cands = [_c("far_metro", "rail", 3), _c("bus", "bus")]
    walk = [{0: 700, 1: 60}, {0: 800, 1: 90}]                      # the metro is 12-13 min away, the bus 1 min
    assert select(walk, [1, 1], cands, CFG)["chosen"] == [0, 1]
    assert select(walk, [1, 1], cands, {**CFG, "reference": False})["chosen"] == [1]


def test_stop_cover_covers_every_stop_with_free_centres():
    import math

    from findhome.zone.centroids import stop_cover

    # two clusters 1 km apart and a lone stop: three circles of 200 m; the pair circle is not centred on a stop
    stops = [(0, 0), (300, 0), (1000, 0), (1100, 50), (1050, 150), (5000, 5000)]
    circles = stop_cover(stops, 200)
    assert len(circles) == 3
    seen = sorted(i for _, _, m in circles for i in m)
    assert seen == list(range(len(stops)))                                  # every stop, exactly once
    for x, y, m in circles:
        assert all(math.dist((x, y), stops[i]) <= 200 + 1e-6 for i in m)
    pair = next(c for c in circles if sorted(c[2]) == [0, 1])
    assert (pair[0], pair[1]) == (150.0, 0.0)                               # between the two stops, not on one
    assert stop_cover([], 200) == []
