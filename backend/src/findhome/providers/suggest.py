"""Address suggestions while typing. Never Nominatim: its usage policy forbids autocomplete.

OpenRouteService geocode/autocomplete (Pelias, needs ORS_API_KEY) first, Photon (komoot, no key) as fallback.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

import httpx

from findhome.core.settings import secret
from findhome.providers.osm import USER_AGENT

log = logging.getLogger(__name__)


@dataclass
class Suggestion:
    label: str
    lat: float
    lon: float
    source: str


class OrsSuggester:
    name = "ors"

    def __init__(self, cfg: dict, key: str, client: httpx.AsyncClient):
        self.base = cfg.get("base_url", "https://api.openrouteservice.org").rstrip("/")
        self.key, self.client = key, client

    async def suggest(self, text: str, focus: tuple[float, float], size: int) -> list[Suggestion]:
        resp = await self.client.get(f"{self.base}/geocode/autocomplete", params={
            "api_key": self.key, "text": text, "boundary.country": "SE", "size": size,
            "focus.point.lat": focus[0], "focus.point.lon": focus[1]})
        resp.raise_for_status()
        return [Suggestion(f["properties"].get("label", ""), f["geometry"]["coordinates"][1],
                           f["geometry"]["coordinates"][0], self.name) for f in resp.json().get("features", [])]


class PhotonSuggester:
    name = "photon"

    def __init__(self, cfg: dict, client: httpx.AsyncClient):
        self.base = cfg.get("base_url", "https://photon.komoot.io").rstrip("/")
        self.bbox = cfg.get("bbox")
        self.client = client

    async def suggest(self, text: str, focus: tuple[float, float], size: int) -> list[Suggestion]:
        params = {"q": text, "limit": size, "lat": focus[0], "lon": focus[1]}
        if self.bbox:
            params["bbox"] = ",".join(str(v) for v in self.bbox)
        resp = await self.client.get(f"{self.base}/api/", params=params)
        resp.raise_for_status()
        out = []
        for f in resp.json().get("features", []):
            p = f.get("properties", {})
            if p.get("countrycode", "SE").upper() != "SE":
                continue
            street = " ".join(x for x in (p.get("street") or p.get("name"), p.get("housenumber")) if x)
            place = " ".join(x for x in (p.get("postcode"), p.get("city") or p.get("district")) if x)
            label = ", ".join(x for x in (street, place) if x) or p.get("name", "")
            out.append(Suggestion(label, f["geometry"]["coordinates"][1], f["geometry"]["coordinates"][0], self.name))
        return out


class AddressSuggester:
    """Tries the configured providers in order; returns [] only when every provider fails or is missing."""

    def __init__(self, cfg: dict, client: httpx.AsyncClient | None = None):
        self.client = client or httpx.AsyncClient(timeout=8, headers={"User-Agent": USER_AGENT})
        self.providers = []
        for name in cfg.get("order", ["ors", "photon"]):
            c = cfg.get(name) or {}
            if c.get("enabled") is False:
                continue
            if name == "ors":
                key = secret(c.get("key_env", "ORS_API_KEY"))
                if key:
                    self.providers.append(OrsSuggester(c, key, self.client))
            elif name == "photon":
                self.providers.append(PhotonSuggester(c, self.client))

    @property
    def available(self) -> bool:
        return bool(self.providers)

    async def suggest(self, text: str, focus: tuple[float, float], size: int = 5) -> list[Suggestion]:
        for prov in self.providers:
            try:
                return (await prov.suggest(text, focus, size))[:size]
            except httpx.HTTPError as exc:
                log.warning("address suggestions via %s failed: %s", prov.name, exc.__class__.__name__)
        return []
