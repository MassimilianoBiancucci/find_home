"""OpenStreetMap services: OSRM routing (walk/bike/drive) and Nominatim geocoding.

The public OSRM demo server reliably serves only the car profile; foot/bike profiles need a
self-hosted OSRM or OpenRouteService (see guide/documentation/providers.md). No public transport here.
"""
from __future__ import annotations

from datetime import datetime

import httpx

from findhome.providers.base import LatLon, Mode, ProviderUnavailable, RateLimiter, TravelResult, WhenIs

USER_AGENT = "findhome/0.1 (personal home search; contact via NOMINATIM_EMAIL)"
_PROFILES = {"drive": "driving", "walk": "foot", "bike": "bike"}


class OsrmProvider:
    name = "osm"
    time_dependent = False

    def __init__(self, cfg: dict, client: httpx.AsyncClient | None = None):
        self.base = cfg.get("osrm_url", "https://router.project-osrm.org").rstrip("/")
        self.modes = set(cfg.get("modes", ["drive"]))
        self.limiter = RateLimiter(per_second=cfg.get("max_requests_per_s", 1))
        self.client = client or httpx.AsyncClient(timeout=20, headers={"User-Agent": USER_AGENT})

    async def travel(self, origin: LatLon, dest: LatLon, mode: Mode, when: datetime,
                     when_is: WhenIs) -> TravelResult | None:
        if mode not in self.modes:
            raise ProviderUnavailable(f"osm does not route {mode}")
        await self.limiter.wait()
        url = (f"{self.base}/route/v1/{_PROFILES[mode]}/"
               f"{origin.lon},{origin.lat};{dest.lon},{dest.lat}?overview=false")
        resp = await self.client.get(url)
        resp.raise_for_status()
        data = resp.json()
        if data.get("code") != "Ok" or not data.get("routes"):
            return None
        return TravelResult(minutes=round(data["routes"][0]["duration"] / 60, 1),
                            raw={"distance_m": data["routes"][0].get("distance")})


class NominatimGeocoder:
    name = "nominatim"

    def __init__(self, cfg: dict, email: str | None, client: httpx.AsyncClient | None = None):
        self.base = cfg.get("base_url", "https://nominatim.openstreetmap.org").rstrip("/")
        self.countrycodes = cfg.get("countrycodes", "se")
        self.email = email
        self.limiter = RateLimiter(per_second=cfg.get("max_requests_per_s", 1))
        self.client = client or httpx.AsyncClient(timeout=20, headers={"User-Agent": USER_AGENT})

    async def geocode(self, query: str) -> tuple[float, float, str] | None:
        await self.limiter.wait()
        params = {"q": query, "format": "jsonv2", "limit": 1, "countrycodes": self.countrycodes}
        if self.email:
            params["email"] = self.email
        resp = await self.client.get(f"{self.base}/search", params=params)
        resp.raise_for_status()
        rows = resp.json()
        if not rows:
            return None
        return float(rows[0]["lat"]), float(rows[0]["lon"]), rows[0].get("display_name", "")
