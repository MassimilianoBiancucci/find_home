"""Trafiklab ResRobot v2.1 route planner (public transport, Sweden-wide).

TO VERIFY in task routing-providers (see guide/issues): parameter names below follow the
HAFAS-style ResRobot API as documented by Trafiklab (originCoordLat/Long, destCoordLat/Long,
date, time, searchForArrival) and the response shape (Trip[].duration ISO-8601,
LegList.Leg[] with Origin/Destination times). Tests use a synthetic fixture of that shape.
"""
from __future__ import annotations

import asyncio
import re
import time
from datetime import datetime

import httpx

from findhome.providers.base import (
    LatLon,
    LocationNotFound,
    Mode,
    ProviderError,
    ProviderUnavailable,
    RateLimiter,
    TravelResult,
    WhenIs,
    haversine_km,
)

# Trafiklab key levels: calls per minute (guide/documentation/providers.md). A new key starts on a "default" level that may be
# lower than bronze; set `plan` or `max_calls_per_minute` in providers.yaml to what your key allows.
PLAN_CALLS_PER_MINUTE = {"bronze": 45, "silver": 60, "gold": 200}
MAX_RETRIES = 3
# Error codes for a coordinate ResRobot cannot snap to a stop (about 500 m); the same coordinate always fails again.
LOCATION_CODES = {"SVC_LOC", "SVC_LOC_ARR", "SVC_LOC_DEP", "H9220"}
# ResRobot does not route a trip whose two ends are a short walk apart: about 100 m answers H9220 ("no stations
# nearby", although there are), about 300 m answers no trip. Such a trip is walked: up to `walk_only_m` it is not
# asked at all; up to `walk_fallback_m` a location error or an empty answer means the walk, not an unroutable point.
WALK_ONLY_M = 400
WALK_FALLBACK_M = 1000

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

    def __init__(self, cfg: dict, key: str | None, client: httpx.AsyncClient | None = None,
                 walk_kmh: float = 4.8, detour: float = 1.3):
        if not key:
            raise ProviderUnavailable("resrobot: TRAFIKLAB_RESROBOT_KEY not set")
        self.base = cfg.get("base_url", "https://api.resrobot.se/v2.1").rstrip("/")
        self.key = key
        plan = str(cfg.get("plan", "bronze")).lower()
        if plan not in PLAN_CALLS_PER_MINUTE:
            raise ProviderUnavailable(f"resrobot: unknown plan {plan!r} (use {', '.join(PLAN_CALLS_PER_MINUTE)})")
        per_minute = cfg.get("max_calls_per_minute") or PLAN_CALLS_PER_MINUTE[plan]
        # ResRobot counts calls per clock minute: stay 10 % under the level, or a burst at a minute edge is refused
        self.limiter = RateLimiter(per_minute=per_minute * float(cfg.get("rate_margin", 0.9)))
        self.retry_delay_s = float(cfg.get("retry_delay_s", 5))
        self.client = client or httpx.AsyncClient(timeout=30)
        self.walk_only_km = float(cfg.get("walk_only_m", WALK_ONLY_M)) / 1000
        self.walk_fallback_km = float(cfg.get("walk_fallback_m", WALK_FALLBACK_M)) / 1000
        self.walk_kmh, self.detour = walk_kmh, detour

    def walk_minutes(self, km: float) -> float:
        return round(km * self.detour / self.walk_kmh * 60, 1)

    def _walk(self, km: float) -> TravelResult:
        return TravelResult(minutes=self.walk_minutes(km), transfers=0,
                            raw={"legs": 1, "first_mode": "walk", "last_mode": "walk", "walk_only": True})

    def _walk_itinerary(self, origin: LatLon, dest: LatLon, km: float) -> dict:
        m = self.walk_minutes(km)
        end = lambda p: {"name": None, "lat": p.lat, "lon": p.lon, "time": None}
        return {"minutes": m, "depart": None, "arrive": None, "transfers": 0, "walk_only": True,
                "legs": [{"mode": "walk", "line": None, "name": None, "direction": None, "from": end(origin),
                          "to": end(dest), "minutes": m, "distance_m": round(km * 1000 * self.detour),
                          "path": [[origin.lon, origin.lat], [dest.lon, dest.lat]]}]}

    async def _short(self, km: float, params: dict) -> httpx.Response | None:
        """The answer, or None when the trip is a walk: too short to ask, or short and refused as unroutable."""
        if km <= self.walk_only_km:
            return None
        try:
            resp = await self._get(params)
        except LocationNotFound:
            if km <= self.walk_fallback_km:
                return None
            raise
        if not (resp.json().get("Trip") or []) and km <= self.walk_fallback_km:
            return None
        return resp

    async def travel(self, origin: LatLon, dest: LatLon, mode: Mode, when: datetime,
                     when_is: WhenIs) -> TravelResult | None:
        if mode != "transit":
            raise ProviderUnavailable("resrobot only routes transit")
        params = {
            "format": "json", "accessId": self.key,
            "originCoordLat": origin.lat, "originCoordLong": origin.lon,
            "destCoordLat": dest.lat, "destCoordLong": dest.lon,
            "date": when.strftime("%Y-%m-%d"), "time": when.strftime("%H:%M"),
            "searchForArrival": 1 if when_is == "arrive_by" else 0,
        }
        if when_is == "depart_at":
            params["numF"] = 1      # ResRobot rejects numF=0 (400); arrive_by uses the default window
        km = haversine_km(origin, dest)
        resp = await self._short(km, params)
        return self._walk(km) if resp is None else parse_trip_response(resp.json(), when_is)

    async def _get(self, params: dict) -> httpx.Response:
        """GET /trip under the rate limit. A 429, or ResRobot's own per-minute API_QUOTA answer, waits (Retry-After,
        else until the next clock minute) and retries; a monthly quota is not retried."""
        for attempt in range(MAX_RETRIES + 1):
            await self.limiter.wait()
            resp = await self.client.get(f"{self.base}/trip", params=params)
            wait = _retry_wait(resp, self.retry_delay_s * (attempt + 1))
            if wait is None or attempt == MAX_RETRIES:
                break
            await asyncio.sleep(wait)
        if resp.is_error:
            raise _error(resp)
        return resp

    async def itinerary(self, origin: LatLon, dest: LatLon, when: datetime, when_is: WhenIs) -> dict | None:
        """One trip with its legs (walk / transit, stops with coordinates) for drawing and the inspector."""
        params = {
            "format": "json", "accessId": self.key, "passlist": 1,
            "originCoordLat": origin.lat, "originCoordLong": origin.lon,
            "destCoordLat": dest.lat, "destCoordLong": dest.lon,
            "date": when.strftime("%Y-%m-%d"), "time": when.strftime("%H:%M"),
            "searchForArrival": 1 if when_is == "arrive_by" else 0,
        }
        km = haversine_km(origin, dest)
        resp = await self._short(km, params)
        return self._walk_itinerary(origin, dest, km) if resp is None else parse_itinerary(resp.json(), when_is)


def _retry_wait(resp: httpx.Response, fallback: float) -> float | None:
    """Seconds to wait before retrying a rate-limited answer, or None when it is not one (or not worth retrying)."""
    if resp.status_code == 429:
        ra = resp.headers.get("Retry-After", "")
        return float(ra) if ra.isdigit() else fallback
    if resp.status_code == 400 and "API_QUOTA" in resp.text:
        if "timeUnit=MINUTE" not in resp.text:
            return None                                    # a monthly quota: waiting a minute will not help
        return max(61 - time.time() % 60, 1.0)             # the per-minute window restarts on the clock minute
    return None


def _error(resp: httpx.Response) -> ProviderError:
    """ResRobot's JSON error body as a typed error: errorCode (SVC_LOC, API_PARAM, ...) or HTTP_<status>."""
    try:
        body = resp.json()
    except ValueError:
        body = {}
    code = str(body.get("errorCode") or f"HTTP_{resp.status_code}")
    message = str(body.get("errorText") or resp.reason_phrase or "")[:200]
    internal = str(body.get("internalErrorCode") or "")
    if code in LOCATION_CODES or internal in LOCATION_CODES:
        return LocationNotFound(code, message)
    return ProviderError(code, message)


# ResRobot catCode → map mode; catOut text as fallback (UNVERIFIED against live answers, see notes/04 §D1)
_CAT_CODE = {"1": "train", "2": "train", "3": "bus", "4": "commuter_rail", "5": "metro", "6": "tram", "7": "bus",
             "8": "ferry"}
_CAT_WORDS = (("tunnelbana", "metro"), ("pendel", "commuter_rail"), ("spårväg", "tram"), ("tvärbana", "tram"),
              ("lokaltåg", "local_rail"), ("buss", "bus"), ("färja", "ferry"), ("båt", "ferry"), ("tåg", "train"))


def _as_list(v) -> list:
    return v if isinstance(v, list) else [v] if v else []


def _leg_mode(leg: dict) -> str:
    if leg.get("type") in ("WALK", "TRSF"):
        return "walk"
    prod = (_as_list(leg.get("Product")) or [{}])[0]
    code = str(prod.get("catCode") or "")
    if code in _CAT_CODE:
        return _CAT_CODE[code]
    text = f"{prod.get('catOut', '')} {prod.get('name', '')} {leg.get('name', '')}".lower()
    return next((mode for word, mode in _CAT_WORDS if word in text), "transit")


def _stop(s: dict) -> dict:
    return {"name": s.get("name"), "lat": s.get("lat"), "lon": s.get("lon"),
            "time": _hhmm(s.get("rtTime") or s.get("time"))}


def parse_itinerary(data: dict, when_is: WhenIs) -> dict | None:
    trips = data.get("Trip") or []
    if not trips:
        return None
    trip = trips[-1] if when_is == "arrive_by" else trips[0]
    out_legs = []
    for leg in _as_list((trip.get("LegList") or {}).get("Leg")):
        prod = (_as_list(leg.get("Product")) or [{}])[0]
        stops = [_stop(s) for s in _as_list((leg.get("Stops") or {}).get("Stop"))]
        a, b = _stop(leg.get("Origin") or {}), _stop(leg.get("Destination") or {})
        out_legs.append({
            "mode": _leg_mode(leg), "line": prod.get("num") or prod.get("line") or prod.get("name"),
            "name": prod.get("name") or leg.get("name"), "direction": leg.get("direction"),
            "from": a, "to": b, "minutes": iso_minutes(leg.get("duration", "")), "distance_m": leg.get("dist"),
            "path": [[s["lon"], s["lat"]] for s in (stops or [a, b]) if s["lat"] is not None],
        })
    total = parse_trip_response({"Trip": [trip]}, "depart_at")
    return {"minutes": total.minutes if total else None, "depart": total.depart if total else None,
            "arrive": total.arrive if total else None, "transfers": total.transfers if total else None,
            "legs": out_legs}


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
        # the first and last rides' modes: a trip from a bus stop may walk on to the metro
        raw={"legs": len(legs), "first_mode": _leg_mode(rides[0]) if rides else "walk",
             "last_mode": _leg_mode(rides[-1]) if rides else "walk"},
    )
