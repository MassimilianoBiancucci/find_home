"""Straight-line estimate: km × detour factor ÷ mode speed (+ wait for transit). No network."""
from __future__ import annotations

from datetime import datetime

from findhome.providers.base import LatLon, Mode, TravelResult, WhenIs, haversine_km

TRANSIT_WAIT_MIN = 5.0


class HaversineProvider:
    name = "haversine"
    modes = {"transit", "walk", "bike", "drive"}
    time_dependent = False

    def __init__(self, speeds_kmh: dict[str, float], detour_factor: float = 1.3):
        self.speeds = speeds_kmh
        self.detour = detour_factor

    def estimate(self, origin: LatLon, dest: LatLon, mode: str) -> float:
        km = haversine_km(origin, dest) * self.detour
        minutes = km / self.speeds[mode] * 60
        return round(minutes + (TRANSIT_WAIT_MIN if mode == "transit" else 0), 1)

    async def travel(self, origin: LatLon, dest: LatLon, mode: Mode, when: datetime,
                     when_is: WhenIs) -> TravelResult:
        return TravelResult(minutes=self.estimate(origin, dest, mode), raw={"km": round(haversine_km(origin, dest), 2)})
