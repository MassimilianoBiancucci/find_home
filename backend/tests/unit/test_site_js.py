"""The browser scripts (extract.js, detail_extract.js) on fictional pages in jsdom, through tests/site_js.cjs.
Skipped when node or the frontend's jsdom is not installed."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]
TESTS = REPO / "backend" / "tests"
NODE_MODULES = REPO / "frontend" / "node_modules"

pytestmark = pytest.mark.skipif(not shutil.which("node") or not (NODE_MODULES / "jsdom").exists(),
                                reason="needs node and frontend/node_modules/jsdom")


def run(script: str, page: str, url: str, mode: str = "") -> dict:
    out = subprocess.run(["node", str(TESTS / "site_js.cjs"), str(REPO / "sites" / script), str(TESTS / "fixtures" / page),
                          url, mode], capture_output=True, text=True, check=True, timeout=60,
                         env={**os.environ, "NODE_PATH": str(NODE_MODULES)})
    return json.loads(out.stdout)


def test_samtrygg_search_page_counter_and_paging():
    r = run("samtrygg/extract.js", "samtrygg/search_page.html",
            "https://www.samtrygg.se/RentalObject/NewSearch?place=Stockholm&sort=newest&page=2")
    assert (r["page"], r["total_shown"], r["total_city"], r["last_page"]) == (2, 68, 259, False)
    assert [d["id"] for d in r["docs"]] == ["abc123"] and r["docs"][0]["pets"] == "Husdjur ok"


def test_a_translated_page_is_not_read():
    r = run("samtrygg/extract.js", "samtrygg/search_translated.html", "https://www.samtrygg.se/RentalObject/NewSearch")
    assert r == {"translated": True, "lang": "en"}


def test_samtrygg_object_page_uses_json_ld_and_ignores_similar_listings():
    r = run("samtrygg/detail_extract.js", "samtrygg/object_page.html", "https://www.samtrygg.se/object/abc123/x")
    assert r["start"] == "2026-08-01" and r["price"] == 12500 and r["photo_count"] == 3
    assert r["facts"]["VÅNING"] == "3" and r["facts"]["FRÅN"] == "18 nov. 2026"     # not the similar card's floor 9
    assert (r["pets"], r["pets_evidence"]) == ("ask", "Husdjur tillåtet — saknas")
    assert r["price_note"] == "inkl. serviceavgift & bredband" and r["area"] == "Exempelby"
    assert r["amenities"] == ["Balkong"]                                       # visible rows, not the JSON-LD list
    assert r["utilities"] == ["Värme — ingår", "El — tillgängligt mot kostnad"]
    gone = run("samtrygg/detail_extract.js", "samtrygg/gone_page.html", "https://www.samtrygg.se/object/abc124/x")
    assert gone["listing"] is False


@pytest.mark.parametrize("mode", ["", "hydrated"])
def test_qasa_listing_page_home_object(mode):
    # gate B: after hydration Next.js empties self.__next_f; the state is read from the original <script> tags
    r = run("qasa/detail_extract.js", "qasa/detail_full.html", "https://qasa.com/se/sv/home/1400001", mode)
    assert r["parsed_as_json"] and r["status"] == "normal" and (r["floor"], r["buildYear"]) == (2, 1962)
    assert r["duration"]["endUfn"] is True and [t["type"] for t in r["traits"]] == ["balcony", "pets", "furniture"]
    assert r["furnishing"] == "partially_furnished" and r["monthlyCost"] == 11654
    assert r["photos"] == ["https://img.example/a.jpg", "https://img.example/b.jpg"]   # in upload order
    assert r["description"].startswith('Ljus tvåa med "balkong"')
    missing = run("qasa/detail_extract.js", "qasa/detail_missing.html", "https://qasa.com/se/sv/home/1400002", mode)
    assert missing["listing"] is False and missing["status"] == "not_found"


def test_qasa_unreadable_state_is_unknown_never_not_found():
    r = run("qasa/detail_extract.js", "qasa/detail_nostate.html", "https://qasa.com/se/sv/home/1400003")
    assert r["listing"] is None and r["status"] == "unknown"


def test_qasa_search_page_keeps_whole_nodes():
    r = run("qasa/extract.js", "qasa/search_page.html", "https://qasa.com/se/sv/find-home?page=1")
    d = r["docs"][0]
    assert "__typename" not in json.dumps(d) and "publishedOrBumpedAt" in d and "displayStreetNumber" in d
