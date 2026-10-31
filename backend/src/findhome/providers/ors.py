"""OpenRouteService (HeiGIT): walking and cycling directions and matrices. Free key: directions 2,000/day,
matrix 500/day, 40 requests/min (openrouteservice.org/plans). No public transport."""
from __future__ import annotations

from datetime import datetime

import httpx

from findhome.providers.base import LatLon, Mode, ProviderUnavailable, RateLimiter, TravelResult, WhenIs

PROFILES = {"walk": "foot-walking", "bike": "cycling-regular"}


class OrsProvider:
    name = "ors"
    time_dependent = False

    def __init__(self, cfg: dict, key: str | None, client: httpx.AsyncClient | None = None):
        if not key:
            raise ProviderUnavailable("ors: ORS_API_KEY not set")
        self.base = cfg.get("base_url", "https://api.openrouteservice.org").rstrip("/")
        self.modes = set(cfg.get("modes", ["walk"]))
        self.limiter = RateLimiter(per_minute=cfg.get("max_calls_per_minute", 40))
        self.client = client or httpx.AsyncClient(timeout=30, headers={"Authorization": key})

    def _profile(self, mode: str) -> str:
        if mode not in self.modes or mode not in PROFILES:
            raise ProviderUnavailable(f"ors does not route {mode}")
        return PROFILES[mode]

    async def travel(self, origin: LatLon, dest: LatLon, mode: Mode, when: datetime | None = None,
                     when_is: WhenIs | None = None) -> TravelResult | None:
        route = await self.route(origin, dest, mode)
        return TravelResult(minutes=route["minutes"], raw={"distance_m": route["distance_m"]}) if route else None

    async def route(self, origin: LatLon, dest: LatLon, mode: str = "walk") -> dict | None:
        """Minutes, metres and the path as [[lon, lat], ...]."""
        await self.limiter.wait()
        resp = await self.client.post(f"{self.base}/v2/directions/{self._profile(mode)}/geojson",
                                      json={"coordinates": [[origin.lon, origin.lat], [dest.lon, dest.lat]]})
        resp.raise_for_status()
        feats = resp.json().get("features") or []
        if not feats:
            return None
        summary = feats[0]["properties"].get("summary", {})
        return {"minutes": round(summary.get("duration", 0) / 60, 1), "distance_m": round(summary.get("distance", 0)),
                "path": feats[0]["geometry"]["coordinates"]}

    async def matrix(self, origin: LatLon, dests: list[LatLon], mode: str = "walk") -> list[dict | None]:
        """One request for origin → every destination; None where ORS finds no route."""
        if not dests:
            return []
        await self.limiter.wait()
        locations = [[origin.lon, origin.lat]] + [[d.lon, d.lat] for d in dests]
        resp = await self.client.post(f"{self.base}/v2/matrix/{self._profile(mode)}", json={
            "locations": locations, "sources": [0], "destinations": list(range(1, len(locations))),
            "metrics": ["duration", "distance"]})
        resp.raise_for_status()
        data = resp.json()
        durations = (data.get("durations") or [[]])[0]
        distances = (data.get("distances") or [[]])[0]
        out: list[dict | None] = []
        for i in range(len(dests)):
            sec = durations[i] if i < len(durations) else None
            out.append(None if sec is None else {"minutes": round(sec / 60, 1),
                                                 "distance_m": round(distances[i]) if i < len(distances) and distances[i] is not None else None})
        return out
