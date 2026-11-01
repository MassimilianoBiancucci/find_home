"""Connectivity matrix: request planning, the background job (resume, estimates, budget) and aggregation."""
from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import date

import pytest
from shapely.geometry import box

from findhome.config.loader import load_all
from findhome.domain import connectivity as cn
from findhome.geo.store import Zone, ZoneSet
from findhome.providers.base import LatLon, TravelResult
from findhome.providers.haversine import HaversineProvider


def _zones() -> ZoneSet:
    from shapely import STRtree

    zs = {}
    for i, x in enumerate((674000, 676000, 678000)):        # three 1 km squares in EPSG:3006 near Stockholm
        zid = f"Z{i}"
        zs[zid] = Zone(zid, f"Zone {i}", "0180", "Stockholm", "D", {}, box(x, 6580000, x + 1000, 6581000))
    order = list(zs)
    return ZoneSet(zs, STRtree([zs[z].geom for z in order]), order, 0.0, None)


@pytest.fixture(scope="module")
def bundle(shared_repo):
    return load_all(shared_repo / "config", shared_repo / "sites")


def _coords(bundle):
    return {p.id: LatLon(59.33, 18.06) for p in bundle.locations.points if p.enabled}


def test_plan_counts_one_slot_per_window_and_direction(bundle):
    reqs = cn.plan(bundle, _zones(), _coords(bundle))
    per_zone = len(reqs) // 3
    expected = 0
    for p in bundle.locations.points:
        if not p.enabled:
            continue
        for t in p.trips:
            if "transit" not in (t.modes or p.modes):
                continue
            n_dir = 2 if t.direction == "both" else 1
            n_win = 1 if (t.use_default_grid or not t.windows) else len(t.windows)
            expected += n_dir * n_win
    assert per_zone == expected and len(reqs) == 3 * expected
    assert {z for z, _ in reqs} == {"Z0", "Z1", "Z2"}


def test_zone_origin_inside_the_zone():
    z = _zones().zones["Z1"]
    o = cn.zone_origin(z)
    assert 59.3 < o.lat < 59.4 and 17.9 < o.lon < 18.2


def test_aggregate_uses_window_and_point_weights(bundle):
    pts = [p for p in bundle.locations.points if p.enabled][:2]
    w = {p.id: bundle.locations.effective_weight(p) for p in pts}
    rows = [{"zone_id": "Z0", "point_id": pts[0].id, "minutes": 10, "window_weight": 1.0, "estimate": False},
            {"zone_id": "Z0", "point_id": pts[0].id, "minutes": 30, "window_weight": 0.5, "estimate": False},
            {"zone_id": "Z0", "point_id": pts[1].id, "minutes": 20, "window_weight": 1.0, "estimate": True},
            {"zone_id": "Z1", "point_id": pts[1].id, "minutes": None, "window_weight": 1.0, "estimate": False}]
    out = cn.aggregate(rows, bundle)
    first = round((10 * 1 + 30 * 0.5) / 1.5, 1)
    assert out["Z0"]["by_point"] == {pts[0].id: first, pts[1].id: 20.0}
    assert out["Z0"]["weighted"] == round((first * w[pts[0].id] + 20 * w[pts[1].id]) / (w[pts[0].id] + w[pts[1].id]), 1)
    assert out["Z0"]["estimate"] is True and "Z1" not in out


class _Rows:
    def __init__(self, rows=None, one=None):
        self.rows, self.one = rows or [], one

    async def fetchall(self):
        return self.rows

    async def fetchone(self):
        return self.one


class FakeDb:
    """Just enough of routing_cache and zone_commute for the job."""

    def __init__(self):
        self.cache: dict[str, float] = {}
        self.matrix: dict[tuple, dict] = {}

    async def execute(self, sql: str, params=()):
        s = " ".join(sql.split())
        if s.startswith("SELECT zone_id, point_id"):
            real_only = "NOT estimate" in s
            return _Rows([dict(zip(("zone_id", "point_id", "direction", "day_type", "window_label"), k, strict=True))
                          for k, v in self.matrix.items() if not (real_only and v["estimate"])])
        if s.startswith("SELECT minutes FROM routing_cache"):
            return _Rows(one={"minutes": self.cache[params[0]]} if params[0] in self.cache else None)
        if s.startswith("INSERT INTO routing_cache"):
            self.cache[params[0]] = params[2]
        elif s.startswith("INSERT INTO zone_commute"):
            self.matrix[params[1:6]] = {"minutes": params[8], "estimate": params[9], "provider": params[7]}
        return _Rows()


class FakePool:
    def __init__(self, db):
        self.db = db

    @asynccontextmanager
    async def connection(self):
        yield self.db


class FakeTransit:
    name, modes, time_dependent = "resrobot", {"transit"}, True

    def __init__(self):
        self.calls = 0

    async def travel(self, origin, dest, mode, when, when_is):
        self.calls += 1
        return TravelResult(minutes=21.0)


class FakeRegistry:
    def __init__(self, transit=None):
        self.transit = transit
        self.haversine = HaversineProvider({"transit": 22}, 1.3)

    def for_mode(self, mode):
        return self.transit or self.haversine


async def test_job_estimates_then_real_provider_replaces_and_resumes(bundle):
    db, zones, coords = FakeDb(), _zones(), _coords(bundle)
    total = len(cn.plan(bundle, zones, coords))
    await cn.run(FakePool(db), FakeRegistry(), bundle, zones, coords, max_calls=10_000, today=date(2026, 11, 2))
    assert cn.JOB.estimated == total and len(db.matrix) == total and all(v["estimate"] for v in db.matrix.values())

    transit = FakeTransit()
    await cn.run(FakePool(db), FakeRegistry(transit), bundle, zones, coords, max_calls=3, today=date(2026, 11, 2))
    assert cn.JOB.stopped == "budget" and transit.calls == 3                  # budget respected
    real_after_budget = sum(not v["estimate"] for v in db.matrix.values())  # 3 calls + cache hits on the same keys

    await cn.run(FakePool(db), FakeRegistry(transit), bundle, zones, coords, max_calls=10_000, today=date(2026, 11, 2))
    assert cn.JOB.skipped == real_after_budget and not any(v["estimate"] for v in db.matrix.values())   # resumed, estimates replaced
    assert not cn.JOB.running and cn.JOB.stopped is None
