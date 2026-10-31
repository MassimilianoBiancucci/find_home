"""Trafiklab ResRobot v2.1 route planner (public transport, Sweden-wide).

TO VERIFY in task routing-providers (see guide/issues): parameter names below follow the
HAFAS-style ResRobot API as documented by Trafiklab (originCoordLat/Long, destCoordLat/Long,
date, time, searchForArrival) and the response shape (Trip[].duration ISO-8601,
LegList.Leg[] with Origin/Destination times). Tests use a synthetic fixture of that shape.
"""
from __future__ import annotations

import re
from datetime import datetime

import httpx

from findhome.providers.base import LatLon, Mode, ProviderUnavailable, RateLimiter, TravelResult, WhenIs

_ISO_DURATION = re.compile(r"P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?")


def iso_minutes(value: str) -> float | None:
    m = _ISO_DURATION.fullmatch(value or "")
    if not m:
        return None
    d, h, mi = (int(x) if x else 0 for x in m.groups())
    return float(d * 1440 + h * 60 + mi)


def _hhmm(dt_time: str | None) -> str | None:
    return dt_time[:5] if dt_time else None


class ResRobotProvider:
    name = "resrobot"
    modes = {"transit"}
    time_dependent = True

    def __init__(self, cfg: dict, key: str | None, client: httpx.AsyncClient | None = None):
        if not key:
            raise ProviderUnavailable("resrobot: TRAFIKLAB_RESROBOT_KEY not set")
        self.base = cfg.get("base_url", "https://api.resrobot.se/v2.1").rstrip("/")
        self.key = key
        self.limiter = RateLimiter(per_minute=cfg.get("max_calls_per_minute", 45))
        self.client = client or httpx.AsyncClient(timeout=30)

    async def travel(self, origin: LatLon, dest: LatLon, mode: Mode, when: datetime,
                     when_is: WhenIs) -> TravelResult | None:
        if mode != "transit":
            raise ProviderUnavailable("resrobot only routes transit")
        await self.limiter.wait()
        params = {
            "format": "json", "accessId": self.key,
            "originCoordLat": origin.lat, "originCoordLong": origin.lon,
            "destCoordLat": dest.lat, "destCoordLong": dest.lon,
            "date": when.strftime("%Y-%m-%d"), "time": when.strftime("%H:%M"),
            "searchForArrival": 1 if when_is == "arrive_by" else 0,
            "numF": 1 if when_is == "depart_at" else 0, "numB": 1 if when_is == "arrive_by" else 0,
        }
        resp = await self.client.get(f"{self.base}/trip", params=params)
        resp.raise_for_status()
        return parse_trip_response(resp.json(), when_is)


def parse_trip_response(data: dict, when_is: WhenIs) -> TravelResult | None:
    trips = data.get("Trip") or []
    if not trips:
        return None
    # arrive_by: the last trip still arriving in time; depart_at: the first trip leaving after.
    trip = trips[-1] if when_is == "arrive_by" else trips[0]
    legs = (trip.get("LegList") or {}).get("Leg") or []
    if isinstance(legs, dict):
        legs = [legs]
    minutes = iso_minutes(trip.get("duration", ""))
    if minutes is None and legs:
        start, end = legs[0]["Origin"], legs[-1]["Destination"]
        t0 = datetime.fromisoformat(f"{start['date']}T{start['time']}")
        t1 = datetime.fromisoformat(f"{end['date']}T{end['time']}")
        minutes = (t1 - t0).total_seconds() / 60
    if minutes is None:
        return None
    rides = [leg for leg in legs if leg.get("type") == "JNY"]
    return TravelResult(
        minutes=round(minutes, 1),
        depart=_hhmm(legs[0]["Origin"].get("time")) if legs else None,
        arrive=_hhmm(legs[-1]["Destination"].get("time")) if legs else None,
        transfers=max(len(rides) - 1, 0) if rides else None,
        raw={"legs": len(legs)},
    )
