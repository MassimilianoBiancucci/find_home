"""Overpass API helpers shared by the geodata builders: region area filter and a POST with back-off."""
from __future__ import annotations

import logging
import time

import httpx

log = logging.getLogger(__name__)
OVERPASS = "https://overpass-api.de/api/interpreter"


def overpass(client: httpx.Client, query: str, waits: tuple[int, ...] = (30, 60)) -> dict:
    """Busy instances answer 429/502/503/504: wait and retry a couple of times."""
    resp = client.post(OVERPASS, data={"data": query})
    for wait in waits:
        if resp.status_code not in (429, 502, 503, 504):
            break
        log.warning("overpass %s, retrying in %s s", resp.status_code, wait)
        time.sleep(wait)
        resp = client.post(OVERPASS, data={"data": query})
    resp.raise_for_status()
    return resp.json()


def area(codes: list[str]) -> str:
    """Overpass statement binding `.k` to the municipalities with these SCB codes."""
    return f'area["boundary"="administrative"]["admin_level"="7"]["ref:scb"~"^({"|".join(codes)})$"]->.k;'
