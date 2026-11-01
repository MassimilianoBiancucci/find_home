import asyncio
from datetime import date, datetime

import httpx

from findhome.config.loader import load_all
from findhome.domain.commute import percentile, plan_requests, reference_date, stats
from findhome.providers.base import LatLon
from findhome.providers.resrobot import ResRobotProvider, iso_minutes, parse_trip_response


def test_reference_date_prefers_tuesday():
    d = reference_date(["mon", "tue", "wed", "thu", "fri"], "tue", set(), date(2026, 10, 31))  # a Saturday
    assert d == date(2026, 11, 3) and d.weekday() == 1
    assert reference_date(["sat"], None, {"2026-11-07"}, date(2026, 10, 31)) == date(2026, 11, 14)


def test_plan_expands_points_trips_windows(tmp_repo):
    b = load_all(tmp_repo / "config", tmp_repo / "sites")
    home = LatLon(59.3176, 18.0586)
    coords = {"work-main": LatLon(59.33, 18.06), "stockholm-central": LatLon(59.3303, 18.0586)}
    plan = plan_requests(home, b, coords)
    assert plan.missing_coords == ["partner-1"]
    work = [r for r in plan.requests if r.point_id == "work-main"]
    # to_point: 08:00-09:00 step 15 = 5 slots x 2 modes; from_point: 16:30-18:30 step 30 = 5 x 2
    assert len(work) == 20
    assert {r.direction for r in work} == {"to_point", "from_point"}
    arrive = [r for r in work if r.direction == "to_point"]
    assert all(r.slot.kind == "arrive_by" and r.origin == home for r in arrive)
    central = [r for r in plan.requests if r.point_id == "stockholm-central"]
    # both directions x 3 day types x 27 grid slots x 2 modes
    assert len(central) == 2 * 3 * 27 * 2


def test_prefilter_skips_far_points(tmp_repo):
    b = load_all(tmp_repo / "config", tmp_repo / "sites")
    plan = plan_requests(LatLon(57.7, 11.97), b, {"work-main": LatLon(59.33, 18.06)})  # Gothenburg
    assert plan.prefiltered == ["work-main"] and not plan.requests


def test_stats():
    assert percentile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 90) == 90
    s = stats([30, 32, 31, 45, 33])
    assert s["median_min"] == 32 and s["worst_min"] == 45 and s["spread_min"] == 13


def test_resrobot_parsing_synthetic_fixture():
    # synthetic payload in the documented shape; real shape verified in task routing-providers
    data = {"Trip": [
        {"duration": "PT41M", "LegList": {"Leg": [
            {"type": "WALK", "Origin": {"time": "07:12:00", "date": "2026-11-03"}, "Destination": {"time": "07:18:00", "date": "2026-11-03"}},
            {"type": "JNY", "Origin": {"time": "07:20:00", "date": "2026-11-03"}, "Destination": {"time": "07:40:00", "date": "2026-11-03"}},
            {"type": "JNY", "Origin": {"time": "07:44:00", "date": "2026-11-03"}, "Destination": {"time": "07:53:00", "date": "2026-11-03"}}]}},
    ]}
    res = parse_trip_response(data, "arrive_by")
    assert res.minutes == 41 and res.depart == "07:12" and res.arrive == "07:53" and res.transfers == 1
    assert iso_minutes("PT1H5M") == 65 and iso_minutes("P1DT2H") == 1560


def _resrobot(cfg, handler):
    return ResRobotProvider(cfg, "k", client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))


def test_resrobot_arrive_by_never_sends_zero_counts():
    seen = []

    def handler(req):
        seen.append(dict(req.url.params))
        return httpx.Response(200, json={"Trip": []})

    p = _resrobot({"max_calls_per_minute": 6000}, handler)
    a, b, t = LatLon(59.4, 18.0), LatLon(59.3, 18.0), datetime(2026, 11, 3, 8, 30)
    asyncio.run(p.travel(a, b, "transit", t, "arrive_by"))
    asyncio.run(p.travel(a, b, "transit", t, "depart_at"))
    assert "numF" not in seen[0] and "numB" not in seen[0]
    assert seen[1]["numF"] == "1" and "numB" not in seen[1]


def test_resrobot_plan_sets_rate_and_429_is_retried():
    calls = []

    def handler(req):
        calls.append(1)
        return httpx.Response(429 if len(calls) == 1 else 200, json={"Trip": []}, headers={"Retry-After": "0"})

    p = _resrobot({"plan": "bronze", "max_calls_per_minute": 6000}, handler)
    assert abs(_resrobot({"plan": "bronze"}, handler).limiter.interval - 60 / 45) < 1e-9
    asyncio.run(p.travel(LatLon(59.4, 18.0), LatLon(59.3, 18.0), "transit", datetime(2026, 11, 3, 8, 30), "depart_at"))
    assert len(calls) == 2
