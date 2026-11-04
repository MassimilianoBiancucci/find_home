"""Google Routes API (computeRoutes). OFF by default; see guide/documentation/google-apis.md for costs.

The field mask is pinned to the minimum so calls stay in the cheapest SKU the request type
allows (the SKU is decided by the requested fields). TO VERIFY: transit tier and arrivalTime
pricing before enabling.
"""
from __future__ import annotations

from datetime import datetime

import httpx

from findhome.providers.base import LatLon, Mode, ProviderUnavailable, RateLimiter, TravelResult, WhenIs

FIELD_MASK = "routes.duration,routes.legs.startLocation,routes.legs.endLocation"
_MODES = {"transit": "TRANSIT", "drive": "DRIVE", "walk": "WALK", "bike": "BICYCLE"}


class GoogleRoutesProvider:
    name = "google"
    time_dependent = True

    def __init__(self, cfg: dict, key: str | None, client: httpx.AsyncClient | None = None):
        if not key:
            raise ProviderUnavailable("google: GOOGLE_MAPS_SERVER_KEY not set")
        self.base = cfg.get("base_url", "https://routes.googleapis.com").rstrip("/")
        self.modes = set(cfg.get("modes", ["transit", "drive"]))
        self.key = key
        self.limiter = RateLimiter(per_second=5)
        self.client = client or httpx.AsyncClient(timeout=30)

    async def travel(self, origin: LatLon, dest: LatLon, mode: Mode, when: datetime,
                     when_is: WhenIs) -> TravelResult | None:
        if mode not in self.modes:
            raise ProviderUnavailable(f"google not enabled for {mode}")
        await self.limiter.wait()
        body: dict = {
            "origin": {"location": {"latLng": {"latitude": origin.lat, "longitude": origin.lon}}},
            "destination": {"location": {"latLng": {"latitude": dest.lat, "longitude": dest.lon}}},
            "travelMode": _MODES[mode],
        }
        stamp = when.astimezone().isoformat()
        if when_is == "arrive_by" and mode == "transit":
            body["arrivalTime"] = stamp
        else:
            body["departureTime"] = stamp
        if mode == "drive":
            body["routingPreference"] = "TRAFFIC_AWARE"
        resp = await self.client.post(
            f"{self.base}/directions/v2:computeRoutes", json=body,
            headers={"X-Goog-Api-Key": self.key, "X-Goog-FieldMask": FIELD_MASK})
        resp.raise_for_status()
        routes = resp.json().get("routes") or []
        if not routes:
            return None
        seconds = float(str(routes[0]["duration"]).rstrip("s"))
        return TravelResult(minutes=round(seconds / 60, 1))
