"""Connectivity matrix: request planning, the background job (resume, estimates, budget, failures, pause, stale),
route status and aggregation."""
from __future__ import annotations

import asyncio
import functools
from datetime import UTC, date, datetime, timedelta

import pytest
from shapely.geometry import box

from findhome.config.loader import load_all
from findhome.db.connectivity_repo import CacheHit, RowWrite, StoredRow
from findhome.domain import connectivity as cn
from findhome.domain import connectivity_status as cs
from findhome.geo.store import Zone, ZoneSet
from findhome.providers.base import LatLon, LocationNotFound, ProviderError, TravelResult
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


class MemStore:
    """In-memory ConnectivityStore."""

    def __init__(self):
        self.cache: dict[str, CacheHit] = {}
        self.matrix: dict[tuple, StoredRow] = {}
        self.fails: dict[tuple[str, str], str] = {}

    async def rows(self, h):
        return dict(self.matrix)

    async def failures(self, provider):
        return {c: code for (p, c), code in self.fails.items() if p == provider}

    async def record_failure(self, provider, coord_key, code, message):
        self.fails[(provider, coord_key)] = code

    async def clear_failures(self, provider):
        n = len(self.fails)
        self.fails = {k: v for k, v in self.fails.items() if k[0] != provider}
        return n - len(self.fails)

    async def cache_get(self, key):
        return self.cache.get(key)

    async def cache_put(self, key, provider, minutes, ttl_days):
        now = datetime.now(UTC)
        self.cache[key] = CacheHit(minutes, now)
        return now

    async def write(self, row: RowWrite):
        self.matrix[row.key] = StoredRow(row.status, row.provider, row.minutes, row.error, row.fetched_at)

    def by_status(self) -> dict[str, int]:
        out: dict[str, int] = {}
        for v in self.matrix.values():
            out[v.status] = out.get(v.status, 0) + 1
        return out


class FakeTransit:
    name, modes, time_dependent = "resrobot", {"transit"}, True

    def __init__(self, fail_at: set[str] | None = None, error: Exception | None = None):
        self.calls = 0
        self.fail_at, self.error = fail_at or set(), error

    async def travel(self, origin, dest, mode, when, when_is):
        self.calls += 1
        if self.error:
            raise self.error
        if origin.key() in self.fail_at or dest.key() in self.fail_at:
            raise LocationNotFound("SVC_LOC", "no stops nearby")
        return TravelResult(minutes=21.0)


class FakeRegistry:
    def __init__(self, transit=None):
        self.transit = transit
        self.haversine = HaversineProvider({"transit": 22}, 1.3)

    def for_mode(self, mode):
        return self.transit or self.haversine


TODAY = date(2026, 11, 2)


async def test_job_estimates_then_real_provider_replaces_and_resumes(bundle):
    store, zones, coords = MemStore(), _zones(), _coords(bundle)
    total = len(cn.plan(bundle, zones, coords))
    await cn.run(store, FakeRegistry(), bundle, zones, coords, max_calls=10_000, today=TODAY)
    assert cn.JOB.estimated == total and store.by_status() == {"estimated": total}

    transit = FakeTransit()
    await cn.run(store, FakeRegistry(transit), bundle, zones, coords, max_calls=3, today=TODAY)
    assert cn.JOB.stopped == "budget" and cn.JOB.state == "stopped" and transit.calls == 3     # budget respected
    real_after_budget = store.by_status()["ok"]                                              # 3 calls + cache hits

    await cn.run(store, FakeRegistry(transit), bundle, zones, coords, max_calls=10_000, today=TODAY)
    assert cn.JOB.skipped == real_after_budget and store.by_status() == {"ok": total}        # resumed, estimates replaced
    assert not cn.JOB.running and cn.JOB.stopped is None and cn.JOB.state == "done"


async def test_unroutable_zone_point_costs_one_call_and_is_not_retried(bundle):
    store, zones, coords = MemStore(), _zones(), _coords(bundle)
    per_zone = len(cn.plan(bundle, zones, coords)) // 3
    bad = cn.zone_origin(zones.zones["Z1"]).key()
    transit = FakeTransit(fail_at={bad})
    await cn.run(store, FakeRegistry(transit), bundle, zones, coords, max_calls=10_000, today=TODAY)
    assert transit.calls == 2 * per_zone + 1                     # one call for Z1, the rest marked failed for free
    assert store.by_status() == {"ok": 2 * per_zone, "failed": per_zone}
    assert cn.JOB.failed == per_zone and cn.JOB.errors == 0 and cn.JOB.state == "done"   # never a reason to pause
    assert [c["zone_id"] for c in cn.JOB.failed_coords] == ["Z1"]

    await cn.run(store, FakeRegistry(transit), bundle, zones, coords, max_calls=10_000, today=TODAY)
    assert transit.calls == 2 * per_zone + 1                     # default refresh does not pay for failures again

    transit.fail_at = set()
    await cn.run(store, FakeRegistry(transit), bundle, zones, coords, max_calls=10_000, scope=["failed"], today=TODAY)
    assert store.by_status() == {"ok": 3 * per_zone} and not store.fails


async def test_repeated_provider_errors_pause_until_a_decision(bundle):
    store, zones, coords = MemStore(), _zones(), _coords(bundle)
    total = len(cn.plan(bundle, zones, coords))
    transit = FakeTransit(error=ProviderError("HTTP_500", "down"))
    task = asyncio.create_task(cn.run(store, FakeRegistry(transit), bundle, zones, coords, max_calls=10_000, today=TODAY))
    for _ in range(50):
        await asyncio.sleep(0)
        if cn.JOB.state == "paused":
            break
    assert cn.JOB.state == "paused" and transit.calls == 3 and "HTTP_500" in cn.JOB.pause_reason
    assert cn.JOB.decide("estimate")
    await task
    assert transit.calls == 3 and store.by_status() == {"failed": 3, "estimated": total - 3}
    assert cn.JOB.state == "done" and cn.JOB.estimating


@pytest.mark.parametrize("policy", ["continue", "estimate"])
async def test_policy_answers_without_pausing(bundle, policy):
    store, zones, coords = MemStore(), _zones(), _coords(bundle)
    total = len(cn.plan(bundle, zones, coords))
    transit = FakeTransit(error=ProviderError("HTTP_500", "down"))
    await cn.run(store, FakeRegistry(transit), bundle, zones, coords, max_calls=10_000, policy=policy, today=TODAY)
    assert cn.JOB.state == "done"
    if policy == "continue":
        assert transit.calls == total and store.by_status() == {"failed": total}
    else:
        assert transit.calls == 3 and store.by_status() == {"failed": 3, "estimated": total - 3}


async def test_stale_answers_are_kept_until_asked(bundle):
    store, zones, coords = MemStore(), _zones(), _coords(bundle)
    transit = FakeTransit()
    await cn.run(store, FakeRegistry(transit), bundle, zones, coords, max_calls=10_000, today=TODAY)
    first = transit.calls
    old = datetime.now(UTC) - timedelta(days=90)
    store.matrix = {k: StoredRow(v.status, v.provider, v.minutes, v.error, old) for k, v in store.matrix.items()}
    store.cache = {k: CacheHit(v.minutes, old) for k, v in store.cache.items()}
    rows = await store.rows("h")
    assert {cs.route_status(r, 30, datetime.now(UTC)) for r in rows.values()} == {"stale"}

    await cn.run(store, FakeRegistry(transit), bundle, zones, coords, max_calls=10_000, today=TODAY)
    assert transit.calls == first                                # never re-bought silently
    await cn.run(store, FakeRegistry(transit), bundle, zones, coords, max_calls=10_000, scope=["stale"], today=TODAY)
    assert transit.calls == 2 * first and {cs.route_status(r, 30, datetime.now(UTC)) for r in store.matrix.values()} == {"cached"}


def test_decide_and_status_table():
    now = datetime(2026, 11, 2, tzinfo=UTC)
    fresh, old = now - timedelta(days=1), now - timedelta(days=40)
    ok, est, bad = StoredRow("ok", "resrobot", 20, None, fresh), StoredRow("estimated", "haversine", 25, None, None), \
        StoredRow("failed", "resrobot", None, "SVC_LOC", None)
    d = functools.partial(cn.decide, real=True, ttl_days=30, now=now)
    sc = cn.DEFAULT_SCOPE
    assert d(None, False, None, sc) == "call" and d(None, True, None, sc) == "fail"
    assert d(None, False, CacheHit(20, fresh), sc) == "cache" and d(None, False, CacheHit(20, old), sc) == "cache"
    assert d(None, False, CacheHit(20, old), ("missing", "stale")) == "call"
    assert d(ok, False, None, sc) == "skip" and d(est, False, None, sc) == "call" and d(bad, False, None, sc) == "skip"
    assert d(bad, False, None, ("failed",)) == "call" and d(None, False, None, ("failed",)) == "skip"
    assert cn.decide(None, False, None, sc, real=False, ttl_days=30, now=now) == "estimate"
    assert cn.parse_scope("all") == cn.SCOPES
    with pytest.raises(ValueError):
        cn.parse_scope(["everything"])
    assert [cs.route_status(r, 30, now) for r in (ok, est, bad, None)] == ["cached", "estimated", "failed", "missing"]
    assert cs.route_status(None, 30, now, running=True) == "pending"
    assert cs.route_status(StoredRow("ok", "resrobot", 20, None, old), 30, now) == "stale"


def test_counts_sum_to_the_plan(bundle):
    zones, coords = _zones(), _coords(bundle)
    reqs = cn.plan(bundle, zones, coords)
    rows = {cs.pair_key(*reqs[0]): StoredRow("ok", "resrobot", 20, None, datetime.now(UTC)),
            cs.pair_key(*reqs[1]): StoredRow("failed", "resrobot", None, "SVC_LOC", None)}
    c = cs.counts(reqs, rows, 30, datetime.now(UTC))
    assert c["cached"] == 1 and c["failed"] == 1 and c["evaluated"] == 2 and c["missing"] == len(reqs) - 2
    assert sum(c[s] for s in cs.STATUSES) == c["planned"] == len(reqs)
