"""Provider adapter contracts (routing, geocoding)."""
from __future__ import annotations

import asyncio
import math
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal, Protocol

Mode = Literal["transit", "walk", "bike", "drive"]
WhenIs = Literal["arrive_by", "depart_at"]


@dataclass(frozen=True)
class LatLon:
    lat: float
    lon: float

    def key(self, digits: int = 4) -> str:
        return f"{round(self.lat, digits)},{round(self.lon, digits)}"


@dataclass
class TravelResult:
    minutes: float
    depart: str | None = None      # HH:MM local, when the provider tells us
    arrive: str | None = None
    transfers: int | None = None
    raw: dict[str, Any] = field(default_factory=dict)


class ProviderUnavailable(Exception):
    """Provider disabled, missing key, or not supporting the request."""


class ProviderError(Exception):
    """The provider answered with an error; `code` is its own code (SVC_LOC, API_PARAM) or HTTP_<status>."""

    def __init__(self, code: str, message: str = ""):
        super().__init__(f"{code}: {message}" if message else code)
        self.code = code
        self.message = message


class LocationNotFound(ProviderError):
    """A coordinate the provider cannot route from or to (no stop nearby). Retrying the same coordinate fails again."""


class RoutingProvider(Protocol):
    name: str
    modes: set[str]
    time_dependent: bool

    async def travel(self, origin: LatLon, dest: LatLon, mode: Mode, when: datetime,
                     when_is: WhenIs) -> TravelResult | None: ...


def haversine_km(a: LatLon, b: LatLon) -> float:
    r = 6371.0088
    p1, p2 = math.radians(a.lat), math.radians(b.lat)
    dp, dl = p2 - p1, math.radians(b.lon - a.lon)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


class RateLimiter:
    """Minimum interval between calls, shared by one provider instance."""

    def __init__(self, per_second: float | None = None, per_minute: float | None = None):
        rate = per_second or ((per_minute or 0) / 60) or 0
        self.interval = 1.0 / rate if rate else 0.0
        self._last = 0.0
        self._lock = asyncio.Lock()

    async def wait(self) -> None:
        if not self.interval:
            return
        async with self._lock:
            delay = self._last + self.interval - time.monotonic()
            if delay > 0:
                await asyncio.sleep(delay)
            self._last = time.monotonic()
