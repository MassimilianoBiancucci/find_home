"""Build provider instances from providers.yaml + keys, and pick one per mode."""
from __future__ import annotations

import logging

from findhome.config.models import Providers
from findhome.core.settings import secret
from findhome.providers.base import ProviderUnavailable, RoutingProvider
from findhome.providers.google import GoogleRoutesProvider
from findhome.providers.haversine import HaversineProvider
from findhome.providers.osm import NominatimGeocoder, OsrmProvider
from findhome.providers.resrobot import ResRobotProvider

log = logging.getLogger(__name__)


class ProviderRegistry:
    def __init__(self, cfg: Providers):
        self.cfg = cfg
        r = cfg.routing
        self.haversine = HaversineProvider(r["haversine"].get("speeds_kmh", {}), r["haversine"].get("detour_factor", 1.3))
        self.routing: dict[str, RoutingProvider] = {"haversine": self.haversine}
        self.unavailable: dict[str, str] = {}
        factories = {
            "osm": lambda c: OsrmProvider(c),
            "resrobot": lambda c: ResRobotProvider(c, secret(c.get("key_env"))),
            "google": lambda c: GoogleRoutesProvider(c, secret(c.get("key_env"))),
        }
        for name, factory in factories.items():
            c = r.get(name) or {}
            if not c.get("enabled"):
                self.unavailable[name] = "disabled in providers.yaml"
                continue
            try:
                self.routing[name] = factory(c)
            except ProviderUnavailable as exc:
                self.unavailable[name] = str(exc)
        geo = cfg.geocoding or {}
        self.geocoder = NominatimGeocoder(geo.get("nominatim", {}), secret(geo.get("nominatim", {}).get("email_env")))

    def for_mode(self, mode: str, forced: str | None = None) -> RoutingProvider:
        names = [forced] if forced else self.cfg.mode_priority.get(mode, ["haversine"])
        for name in names:
            prov = self.routing.get(name)
            if prov is not None and mode in prov.modes:
                return prov
        return self.haversine

    def status(self) -> dict[str, str]:
        out = {name: "ready" for name in self.routing}
        out.update(self.unavailable)
        return out
