"""Bostadsförmedlingen scanner: one feed request, local filters, mapping, listing-page description (fictional data)."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import httpx
import pytest

from findhome.config.loader import load_all
from findhome.pets import ingest_candidate
from findhome.scanning.runner import collect, enrich_new

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
async def test_scan_is_one_request_and_enrich_reads_the_description(tmp_repo, tmp_path, monkeypatch):
    monkeypatch.setattr("findhome.scanning.generic.data_dir", lambda: tmp_path / "data")
    mod = scanner_module()
    calls = []

    def handler(request: httpx.Request):
        calls.append(request.url.path)
        if request.url.path == "/AllaAnnonser/":
            return httpx.Response(200, text=(FIX / "feed.json").read_text())
        return httpx.Response(200, text=(FIX / "detail.html").read_text())

    b = load_all(tmp_repo / "config", tmp_repo / "sites")
    site = b.sites["bostadsformedlingen"]
    scanner = mod.BostadsformedlingenScanner(site, client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    items, stats, filt = await collect(site, b, max_pages=5, scanner=scanner)
    assert calls == ["/AllaAnnonser/"]                    # whole region in one request, whatever max_pages says
    assert [i.source.external_id for i in items] == ["700001", "700003"]
    assert stats.parse_errors == 1 and filt["filtered"]["type Student"] == 1

    class NoConn:
        pass

    async def unknown(*_a, **_k):
        return None

    monkeypatch.setattr("findhome.scanning.runner.repo.source_exists", unknown)
    monkeypatch.setattr("findhome.scanning.runner.asyncio.sleep", lambda _s: unknown())
    assert await enrich_new(NoConn(), site, scanner, items, limit=1) == 1
    assert calls[-1] == "/bostad/700001/"
    assert ingest_candidate(items[0])[0] == "no" and "Inga husdjur." in ingest_candidate(items[0])[1]
