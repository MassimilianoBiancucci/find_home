"""Bostadsförmedlingen scanner: one feed request, local filters, mapping, listing-page reads (fictional data)."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import httpx
import pytest

from findhome.config.loader import load_all
from findhome.pets import ingest_candidate
from findhome.scanning.runner import collect, enrich_details

REPO = Path(__file__).resolve().parents[3]
FIX = REPO / "backend" / "tests" / "fixtures" / "bostadsformedlingen"


def scanner_module():
    spec = importlib.util.spec_from_file_location("bf_scanner_t", REPO / "sites" / "bostadsformedlingen" / "scanner.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_mapping_and_local_filter():
    mod = scanner_module()
    feed = json.loads((FIX / "feed.json").read_text())
    a = mod.to_listing(feed[0])
    assert a.source.external_id == "700001" and a.source.url == "https://bostad.stockholm.se/bostad/700001/"
    assert (a.rent_sek, a.size_m2, a.rooms_rok, a.floor, a.has_elevator) == (9850, 52, 2, 3, True)
    assert a.contract_type == "first_hand" and a.area == "Testholmen" and a.lat == 59.31
    assert a.attributes["queue_hint"] == "8 år" and a.attributes["publishedAt"] == "2026-11-01"
    assert a.pet_status == "unknown"                       # the feed never carries pets
    rules = {"exclude_flags": ["Student", "Ungdom", "Senior"]}
    assert mod.excluded(feed[1], rules) == "type Student"
    assert mod.excluded(feed[2], rules) is None            # Korttid kept
    with pytest.raises(ValueError):
        mod.to_listing(feed[3])
    assert mod.description_text((FIX / "detail.html").read_text()).startswith("Beskrivning av bostaden")


@pytest.mark.asyncio
async def test_scan_is_one_request_and_details_read_passing_pages(tmp_repo, tmp_path, monkeypatch):
    monkeypatch.setattr("findhome.scanning.generic.data_dir", lambda: tmp_path / "data")
    monkeypatch.setattr("findhome.scanning.floorplans.data_dir", lambda: tmp_path / "data")
    mod = scanner_module()
    calls = []

    def handler(request: httpx.Request):
        calls.append((request.method, request.url.path))
        if request.url.path == "/AllaAnnonser/":
            return httpx.Response(200, text=(FIX / "feed.json").read_text())
        if request.url.path.startswith("/uploads/"):
            return httpx.Response(200, headers={"content-type": "image/png"})
        return httpx.Response(200, text=(FIX / "detail.html").read_text())

    b = load_all(tmp_repo / "config", tmp_repo / "sites")
    site = b.sites["bostadsformedlingen"]
    scanner = mod.BostadsformedlingenScanner(site, client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    items, stats, filt = await collect(site, b, max_pages=5, scanner=scanner)
    assert [c[1] for c in calls] == ["/AllaAnnonser/"]     # whole region in one request, whatever max_pages says
    assert [i.source.external_id for i in items] == ["700001", "700003"]
    assert stats.parse_errors == 1 and filt["filtered"]["type Student"] == 1

    async def stored(_conn, _site, ext):                  # 700001 is new; 700003 was read a day ago
        return None if ext == "700001" else {"details_checked_at": "2999-01-01T00:00:00+00:00"}

    async def no_sleep(_s):
        return None

    monkeypatch.setattr("findhome.scanning.runner.repo.source_attributes", stored)
    monkeypatch.setattr("findhome.scanning.runner.asyncio.sleep", no_sleep)
    monkeypatch.setattr("findhome.scanning.runner.passes_hard_filters", lambda _b, _i: True)
    counts = await enrich_details(object(), b, site, scanner, items)
    assert counts == {"details_read": 1, "details_failed": 0, "details_skipped_cap": 0}
    assert calls[-1] == ("GET", "/bostad/700001/")
    read = items[0]
    assert read.attributes["_details"] is True and read.attributes["details_checked_at"]
    assert ingest_candidate(read)[0] == "no" and "Inga husdjur." in ingest_candidate(read)[1]
    assert (tmp_path / "data" / "raw" / "bostadsformedlingen" / scanner.stamp / "pages" / "700001.html").exists()


@pytest.mark.asyncio
async def test_details_respect_the_hard_filters_and_the_cap(tmp_repo, monkeypatch):
    mod = scanner_module()
    b = load_all(tmp_repo / "config", tmp_repo / "sites")
    site = b.sites["bostadsformedlingen"]
    feed = json.loads((FIX / "feed.json").read_text())
    one_room = mod.to_listing({**feed[0], "LagenhetId": 700009, "AntalRum": 1})   # the example profile wants 2 rok
    items = [mod.to_listing(feed[0]), one_room, mod.to_listing(feed[2])]
    read = []

    class Fake:
        async def enrich(self, item, known=None):
            read.append(item.source.external_id)
            return item

    async def new(*_a):
        return None

    async def no_sleep(_s):
        return None

    monkeypatch.setattr("findhome.scanning.runner.repo.source_attributes", new)
    monkeypatch.setattr("findhome.scanning.runner.asyncio.sleep", no_sleep)
    counts = await enrich_details(object(), b, site, Fake(), items, limit=1)
    assert read == ["700001"] and counts["details_skipped_cap"] == 1      # 700009 fails min_rooms_rok; 700003 over the cap
