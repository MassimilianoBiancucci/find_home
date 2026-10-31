"""Geocode cache rules and address suggestions (no network, no database)."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

import httpx
import pytest

from findhome.providers import geocode as gc
from findhome.providers.suggest import AddressSuggester


class _Cursor:
    def __init__(self, row):
        self.row = row

    async def fetchone(self):
        return self.row


class FakeConn:
    def __init__(self):
        self.rows: dict[str, dict] = {}

    async def execute(self, sql: str, params=()):
        if sql.lstrip().startswith("SELECT"):
            row = self.rows.get(params[0])
            return _Cursor(row if row and row["expires_at"] > datetime.now(UTC) else None)
        if sql.lstrip().startswith("INSERT"):
            key, _prov, lat, lon, _disp, expires = params
            self.rows[key] = {"lat": lat, "lon": lon, "expires_at": expires}
        if sql.lstrip().startswith("DELETE"):
            self.rows.pop(params[0], None)
        return _Cursor(None)


class FakeGeocoder:
    name = "fake"

    def __init__(self, answer):
        self.answer, self.queries = answer, []

    async def geocode(self, query):
        self.queries.append(query)
        return self.answer


class FakeRegistry:
    def __init__(self, answer):
        self.geocoder = FakeGeocoder(answer)


@pytest.mark.parametrize(("address", "sent"), [
    ("Råsta strandväg 7, 169 79 Solna, Sweden", "Råsta strandväg 7, 169 79 Solna, Sweden"),
    ("Råsundavägen 37, Solna, Sverige", "Råsundavägen 37, Solna, Sverige"),
    ("Skanstull, Stockholm", "Skanstull, Stockholm, Sverige"),
    ("Råsundavägen 37, 169 67 Solna", "Råsundavägen 37, 169 67 Solna, Sverige"),
])
def test_country_suffix_only_when_missing(address, sent):
    assert gc.provider_query(address) == sent


async def test_hit_is_cached_for_ttl_and_not_requested_again():
    conn, reg = FakeConn(), FakeRegistry((59.37, 18.0, "Råsta"))
    assert (await gc.geocode(conn, reg, "Råsta strandväg 7, Solna", ttl_days=365)).lat == 59.37
    assert (await gc.geocode(conn, reg, "råsta  strandväg 7, solna")).lat == 59.37
    assert len(reg.geocoder.queries) == 1
    row = conn.rows["råsta strandväg 7, solna"]
    assert row["expires_at"] > datetime.now(UTC) + timedelta(days=300)


async def test_miss_is_cached_for_one_day_only():
    conn, reg = FakeConn(), FakeRegistry(None)
    assert await gc.geocode(conn, reg, "Nowhere 1", ttl_days=365) is None
    assert await gc.geocode(conn, reg, "Nowhere 1") is None
    assert len(reg.geocoder.queries) == 1
    assert conn.rows["nowhere 1"]["expires_at"] < datetime.now(UTC) + gc.MISS_TTL + timedelta(minutes=1)


async def test_forget_drops_the_cached_answer():
    conn, reg = FakeConn(), FakeRegistry(None)
    await gc.geocode(conn, reg, "Nowhere 1")
    await gc.forget(conn, "Nowhere 1")
    await gc.geocode(conn, reg, "Nowhere 1")
    assert len(reg.geocoder.queries) == 2


def _client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


async def test_suggester_uses_photon_without_ors_key(monkeypatch):
    monkeypatch.delenv("ORS_API_KEY", raising=False)

    def handler(req: httpx.Request):
        assert req.url.host == "photon.komoot.io"
        return httpx.Response(200, json={"features": [
            {"geometry": {"coordinates": [18.0058, 59.3701]},
             "properties": {"street": "Råsta strandväg", "housenumber": "7", "postcode": "169 79", "city": "Solna",
                            "countrycode": "SE"}},
            {"geometry": {"coordinates": [10.0, 60.0]}, "properties": {"name": "Oslo", "countrycode": "NO"}},
        ]})

    sug = AddressSuggester({"order": ["ors", "photon"], "photon": {}}, client=_client(handler))
    items = await sug.suggest("Råsta strand", (59.33, 18.07))
    assert [(i.label, i.source) for i in items] == [("Råsta strandväg 7, 169 79 Solna", "photon")]


async def test_suggester_falls_back_when_ors_fails(monkeypatch):
    monkeypatch.setenv("ORS_API_KEY", "k")

    def handler(req: httpx.Request):
        if req.url.host == "api.openrouteservice.org":
            return httpx.Response(429)
        return httpx.Response(200, json={"features": []})

    sug = AddressSuggester({"order": ["ors", "photon"]}, client=_client(handler))
    assert [p.name for p in sug.providers] == ["ors", "photon"]
    assert await sug.suggest("Råsta strand", (59.33, 18.07)) == []
