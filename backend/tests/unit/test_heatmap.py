"""Heatmap engine on a hand-made 3×3 street grid (100 m blocks), extents and neighbours. Fictional geometry."""
from __future__ import annotations

from shapely import STRtree
from shapely.geometry import Point, box

from findhome.geo.store import Zone, ZoneSet
from findhome.zone.extent import Extent, extent, neighbours
from findhome.zone.heatmap import HeatmapParams, compute, weighted_quantile
from findhome.zone.network import Network

X0, Y0, STEP = 674000.0, 6580000.0, 100.0


def _grid(steps_edge: tuple[int, int] | None = None) -> Network:
    """Nodes 1..9 row by row:  7 8 9 / 4 5 6 / 1 2 3 (node 1 at the origin)."""
    nodes = {r * 3 + c + 1: (X0 + c * STEP, Y0 + r * STEP) for r in range(3) for c in range(3)}
    edges = []
    for n, (x, y) in nodes.items():
        for m in (n + 1, n + 3):
            if m in nodes and (m != n + 1 or n % 3 != 0):
                hw = "steps" if steps_edge and {n, m} == set(steps_edge) else "footway"
                edges.append([n, m, STEP, hw, True, True, [[x, y], list(nodes[m])]])
    return Network(("0000",), nodes, edges, (0.0,))


AREA = box(X0 - 50, Y0 - 50, X0 + 250, Y0 + 250)
EXT = Extent("Z", ("Z",), AREA, AREA, ("0000",))
P = HeatmapParams("walk", speed_mps=1.0, cutoff_s=1000, snap_max_m=60, factors={"steps": 0.5})


def _times(hm, net, sid):
    """Segment seconds keyed by its end nodes."""
    return {frozenset((net.edges[i][0], net.edges[i][1])): per.get(sid) for i, per in hm.segments}


def test_times_follow_the_network():
    net = _grid()
    hm = compute(net, EXT, {"a": [Point(X0, Y0)]}, P, homes=[])
    t = _times(hm, net, "a")
    assert len(hm.segments) == 12
    assert t[frozenset((1, 2))] == 50.0 and t[frozenset((2, 3))] == 150.0       # mean of the two ends
    assert t[frozenset((8, 9))] == 350.0                                         # far corner: 3 and 4 blocks
    assert hm.summary["a"]["median_s"] == 200 and hm.summary["a"]["share_reached"] == 1.0   # 9 nodes, no buildings


def test_cutoff_snap_walk_steps_and_any():
    net = _grid(steps_edge=(1, 2))
    target_b = Point(X0 + 2 * STEP + 30, Y0 + 2 * STEP)                          # 30 m east of node 9
    p = HeatmapParams("walk", 1.0, cutoff_s=350, snap_max_m=60, factors={"steps": 0.5})
    hm = compute(net, EXT, {"a": [Point(X0, Y0)], "b": [target_b], "far": [Point(X0 + 5000, Y0)]}, p, homes=[])
    a, b = _times(hm, net, "a"), _times(hm, net, "b")
    assert a[frozenset((1, 2))] == 100.0               # steps: 200 s to node 2 (half speed), mean of 0 and 200
    assert a[frozenset((8, 9))] is None                # node 9 at 400 s: beyond the 350 s cutoff
    assert b[frozenset((8, 9))] == 80.0                # 30 s snap walk + half a block
    assert hm.targets == {"a": 1, "b": 1, "far": 0} and hm.summary["far"]["median_s"] is None
    seg = next(per for i, per in hm.segments if {net.edges[i][0], net.edges[i][1]} == {4, 5})
    assert set(seg) == {"a", "b"} and hm.summary["any"]["targets"] == 2


def test_homes_weight_the_summary():
    net = _grid()
    homes = [(X0 + 10, Y0, 1.0), (X0 + 2 * STEP, Y0 + 2 * STEP, 9.0)]           # a house near the stop, a block far
    hm = compute(net, EXT, {"a": [Point(X0, Y0)]}, P, homes=homes)
    s = hm.summary["a"]
    assert hm.homes == 2 and s["median_s"] == 400 and s["share_le_5min"] == 0.1  # the 9-floor home on node 9 wins


def test_weighted_quantile():
    assert weighted_quantile([], 0.5) is None
    assert weighted_quantile([(10, 1), (20, 1), (30, 2)], 0.5) == 20
    assert weighted_quantile([(10, 1), (20, 1), (30, 2)], 0.9) == 30


def test_extent_and_neighbours():
    geoms = {"A": box(0, 0, 1000, 1000), "B": box(1000, 0, 2000, 1000), "C": box(5000, 0, 6000, 1000)}
    zs = {k: Zone(k, k, "0001" if k != "C" else "0002", "K", "D", {}, g) for k, g in geoms.items()}
    order = list(zs)
    zones = ZoneSet(zs, STRtree([zs[z].geom for z in order]), order, 0.0, None)
    assert neighbours(zones, "A") == ["B"]
    e = extent(zones, "A", True, reach_m=500)
    assert e.zone_ids == ("A", "B") and e.kommuner == ("0001",) and e.focus.area == 2_000_000
    assert extent(zones, "B", False, reach_m=3500).kommuner == ("0001", "0002")      # reach crosses into C's kommun


def test_counts_within_and_choice_median():
    from findhome.zone.heatmap import ExtentGraph
    from findhome.zone.measure import choice_median

    net = _grid()
    # homes: one at node 1 (weight 3), one at node 9 (weight 1); targets at nodes 1 and 3 (corners of the bottom row)
    homes = [(X0, Y0, 3.0), (X0 + 2 * STEP, Y0 + 2 * STEP, 1.0)]
    eg = ExtentGraph(net, EXT, P, homes)
    targets = [Point(X0, Y0), Point(X0 + 2 * STEP, Y0)]
    counts = eg.counts_within(targets, 200)               # 200 s = 2 blocks at 1 m/s
    assert counts[1] == 2 and counts[2] == 2 and counts[3] == 2          # bottom row reaches both
    assert counts[5] == 2 and counts[4] == 1 and counts.get(9) == 1      # node 9: only target 3 (2 blocks up)
    assert counts.get(7) == 1                                             # node 7: only target 1
    assert choice_median(eg, targets, 200 / 60) == 2.0                    # weight 3 at node 1 dominates
    assert choice_median(eg, [], 10) == 0.0
