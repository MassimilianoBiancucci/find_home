"""POI fetch helpers, ORS walking matrix, ResRobot itinerary parsing and the probe's walking cache (no network, no DB)."""
from __future__ import annotations

import httpx
import pytest

from findhome.domain import probe as pr
from findhome.geo.build_poi import region_query, to_features
from findhome.providers.base import LatLon
from findhome.providers.haversine import HaversineProvider
from findhome.providers.ors import OrsProvider
from findhome.providers.poi import tag_filters
from findhome.providers.resrobot import parse_itinerary


def test_tag_filters_grammar():
    assert tag_filters("shop=supermarket|convenience") == '["shop"~"^(supermarket|convenience)$"]'
    assert tag_filters("leisure=fitness_centre&name~^SATS") == '["leisure"="fitness_centre"]["name"~"^SATS"]'
    assert tag_filters("railway=station|halt&station!=subway") == '["railway"~"^(station|halt)$"]["station"!="subway"]'


def test_region_query_uses_kommun_codes():
    q = region_query(["amenity=veterinary"], ["0180", "0184"])
    assert '"ref:scb"~"^(0180|0184)$"' in q and 'nwr(area.k)["amenity"="veterinary"];' in q and "out center tags" in q


def test_to_features_takes_way_centres_and_dedupes():
    els = [{"type": "node", "id": 1, "lat": 59.3, "lon": 18.0, "tags": {"name": "SATS Hornstull", "brand": "SATS"}},
           {"type": "way", "id": 2, "center": {"lat": 59.31, "lon": 18.01}, "tags": {"brand": "SATS"}},
           {"type": "node", "id": 1, "lat": 59.3, "lon": 18.0, "tags": {}},
           {"type": "relation", "id": 3, "tags": {}}]
    feats = to_features(els, "sats")
    assert [f["properties"]["id"] for f in feats] == ["n1", "w2"]
    assert feats[1]["properties"]["name"] == "SATS"           # falls back to brand
    assert feats[1]["geometry"]["coordinates"] == [18.01, 59.31]


async def test_ors_matrix_parses_minutes_and_gaps():
    def handler(request: httpx.Request) -> httpx.Response:
        body = request.read().decode()
        assert '"sources":[0]' in body.replace(" ", "") and request.url.path.endswith("/v2/matrix/foot-walking")
        return httpx.Response(200, json={"durations": [[120.0, None]], "distances": [[150.0, None]]})

    ors = OrsProvider({"modes": ["walk"]}, "k", client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    out = await ors.matrix(LatLon(59.3, 18.0), [LatLon(59.301, 18.0), LatLon(59.4, 18.2)])
    assert out == [{"minutes": 2.0, "distance_m": 150}, None]


def test_parse_itinerary_legs_modes_and_paths():
    data = {"Trip": [{"duration": "PT24M", "LegList": {"Leg": [
        {"type": "WALK", "duration": "PT4M", "dist": 300, "Origin": {"name": "Start", "lat": 59.31, "lon": 18.03, "time": "07:58:00"},
         "Destination": {"name": "Hornstull", "lat": 59.316, "lon": 18.034, "time": "08:02:00"}},
        {"type": "JNY", "duration": "PT20M", "direction": "Mörby centrum", "Product": [{"name": "Länstrafik - Tunnelbana 14", "num": "14", "catCode": "5"}],
         "Origin": {"name": "Hornstull", "lat": 59.316, "lon": 18.034, "time": "08:03:00"},
         "Destination": {"name": "Tekniska högskolan", "lat": 59.345, "lon": 18.071, "time": "08:22:00"},
         "Stops": {"Stop": [{"name": "Hornstull", "lat": 59.316, "lon": 18.034}, {"name": "Liljeholmen", "lat": 59.31, "lon": 18.02},
                            {"name": "Tekniska högskolan", "lat": 59.345, "lon": 18.071}]}},
    ]}}]}
    it = parse_itinerary(data, "depart_at")
    assert it["minutes"] == 24.0 and it["transfers"] == 0 and it["depart"] == "07:58"
    walk, metro = it["legs"]
    assert walk["mode"] == "walk" and walk["path"] == [[18.03, 59.31], [18.034, 59.316]]
    assert metro["mode"] == "metro" and metro["line"] == "14" and len(metro["path"]) == 3


def test_parse_itinerary_mode_from_text_when_no_catcode():
    data = {"Trip": [{"duration": "PT10M", "LegList": {"Leg": {"type": "JNY", "Product": {"catOut": "Buss", "num": "4"},
            "Origin": {"name": "A", "lat": 1, "lon": 2, "time": "08:00"}, "Destination": {"name": "B", "lat": 1, "lon": 3, "time": "08:10"}}}}]}
    assert parse_itinerary(data, "depart_at")["legs"][0]["mode"] == "bus"


class _Rows:
    def __init__(self, rows):
        self.rows = rows

    async def fetchall(self):
        return self.rows


class FakeConn:
    def __init__(self):
        self.cache: dict[str, dict] = {}

    async def execute(self, sql: str, params=()):
        if sql.lstrip().startswith("SELECT"):
            return _Rows([{"key": k, "response": self.cache[k]} for k in params[0] if k in self.cache])
        self.cache[params[0]] = params[3].obj      # INSERT ... Jsonb(response)
        return _Rows([])


class FakeOrs:
    def __init__(self):
        self.calls = 0

    async def matrix(self, origin, dests, mode="walk"):
        self.calls += 1
        return [{"minutes": 5.0, "distance_m": 400} for _ in dests]


class FakeRegistry:
    def __init__(self, ors):
        self.ors = ors
        self.haversine = HaversineProvider({"walk": 4.8}, 1.3)


@pytest.mark.parametrize("with_ors", [True, False])
async def test_walk_minutes_caches_and_falls_back(with_ors):
    conn, ors = FakeConn(), FakeOrs()
    reg = FakeRegistry(ors if with_ors else None)
    o, dests = LatLon(59.3, 18.0), [LatLon(59.301, 18.0), LatLon(59.302, 18.0)]
    out, err = await pr.walk_minutes(conn, reg, o, dests, ttl_days=30)
    if with_ors:
        assert err is None and [x["minutes"] for x in out] == [5.0, 5.0] and not any(x["est"] for x in out)
        again, _ = await pr.walk_minutes(conn, reg, o, dests, ttl_days=30)
        assert ors.calls == 1 and [x["minutes"] for x in again] == [5.0, 5.0]      # second call from the cache
    else:
        assert "ORS_API_KEY" in err and all(x["est"] for x in out) and out[0]["minutes"] > 0
