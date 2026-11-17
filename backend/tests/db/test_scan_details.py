"""A Bostadsförmedlingen scan reads the pages of listings that pass the hard filters, stores the page data even when
the feed entry is unchanged, scores what it touched, and does not read a page again within refresh_days."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import httpx
import pytest

REPO = Path(__file__).resolve().parents[3]
FIX = REPO / "backend" / "tests" / "fixtures" / "bostadsformedlingen"
PAGES = {"/bostad/700001/": "page_ordinary.html", "/bostad/700003/": "page_korttid.html"}


def _module():
    spec = importlib.util.spec_from_file_location("bf_scan_db_t", REPO / "sites" / "bostadsformedlingen" / "scanner.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


@pytest.fixture
def mocked_scan(client, test_repo, monkeypatch):
    mod, calls = _module(), []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append((request.method, request.url.path))
        if request.url.path == "/AllaAnnonser/":
            return httpx.Response(200, text=(FIX / "feed.json").read_text())
        if request.url.path in PAGES:
            return httpx.Response(200, text=(FIX / PAGES[request.url.path]).read_text())
        if request.url.host.endswith("bim.cloud"):
            return httpx.Response(200, headers={"content-type": "text/html"})
        return httpx.Response(200, headers={"content-type": "image/png"})

    def make(site):
        return mod.BostadsformedlingenScanner(site, client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))

    async def yes(*_a, **_k):
        return True

    async def no_sleep(_s):
        return None

    monkeypatch.setattr("findhome.scanning.runner.make_scanner", make)
    monkeypatch.setattr("findhome.scanning.runner.robots_allows", yes)
    monkeypatch.setattr("findhome.scanning.runner.asyncio.sleep", no_sleep)
    for target in ("findhome.scanning.generic.data_dir", "findhome.scanning.floorplans.data_dir"):
        monkeypatch.setattr(target, lambda: test_repo / "data")
    return mod, calls


def _listing(client, ext: str) -> dict:
    sid = client.get("/api/listings/exists", params={"site": "bostadsformedlingen", "ref": ext}).json()
    return client.get(f"/api/listings/{sid['short_id']}").json()["listing"]


def test_scan_reads_passing_pages_once_and_stores_them(client, mocked_scan):
    mod, calls = mocked_scan
    # an earlier scan stored 700001 from the feed only (same list view as today)
    feed = json.loads((FIX / "feed.json").read_text())
    client.post("/api/ingest/listings", json={"listings": [mod.to_listing(feed[0]).model_dump(mode="json")]})

    res = client.post("/api/scans", json={"site": "bostadsformedlingen"}).json()["results"][0]
    assert res["details_read"] == 2 and res["details_failed"] == 0 and res["scored"] >= 1
    assert "details 2 read, 0 failed" in res["line"]

    a = _listing(client, "700001")
    assert a["available_from"] == "2027-02-01" and len(a["photo_urls"]) == 2
    kinds = {p["url"]: p["kind"] for p in a["attributes"]["floorplans"]}
    assert kinds == {"https://bostad.stockholm.se/uploads/111ritning.pdf": "image",       # mocked as image/png
                     "https://exempel.bim.cloud/plan/111": "viewer"}
    assert a["attributes"]["details_checked_at"] and a["attributes"]["Kommun"]            # merged with the feed keys
    b = _listing(client, "700003")
    assert b["contract_start"] == "2027-01-18" and b["attributes"]["contract_terms"]["notice_months"] == 1

    reads = sum(1 for _m, p in calls if p.startswith("/bostad/"))
    again = client.post("/api/scans", json={"site": "bostadsformedlingen"}).json()["results"][0]
    assert again["details_read"] == 0 and sum(1 for _m, p in calls if p.startswith("/bostad/")) == reads
    assert _listing(client, "700001")["available_from"] == "2027-02-01"                   # a feed-only scan keeps it
    forced = client.post("/api/scans", json={"site": "bostadsformedlingen", "refresh_details": True}).json()["results"][0]
    assert forced["details_read"] == 2                                                   # after a parser fix
