"""Bostadsförmedlingen listing pages and feed ranges (fictional pages shaped like the real ones)."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
FIX = REPO / "backend" / "tests" / "fixtures" / "bostadsformedlingen"


def mod():
    spec = importlib.util.spec_from_file_location("bf_page_t", REPO / "sites" / "bostadsformedlingen" / "scanner.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def test_ordinary_page():
    p = mod().parse_page((FIX / "page_ordinary.html").read_text())
    assert p["available_from"] == "2027-02-01" and p["apply_by"] == "2026-12-01"
    assert p["photo_urls"] == ["https://bostad.stockholm.se/uploads/111foto1.jpg",
                               "https://bostad.stockholm.se/uploads/111foto2.jpg"]      # no logo, no duplicate, no empty src
    # plans by their own link text, made absolute and deduped; the example image is not a plan
    assert [u for u, _ in p["floorplans"]] == ["https://bostad.stockholm.se/uploads/111ritning.pdf",
                                                "https://exempel.bim.cloud/plan/111"]
    assert p["amenities"] == ["Balkong", "Hiss", "Rökfritt"]
    assert p["requirements"] == {"min_income_sek": 250000, "max_household": 3}
    assert p["contract_terms"] == {}                     # the site menu's "Korttidskontrakt" is not the ad's text
    assert p["description"].startswith("Beskrivning") and p["units"] == []


def test_short_term_page():
    p = mod().parse_page((FIX / "page_korttid.html").read_text())
    assert p["available_from"] is None and p["move_in_raw"] == "Enligt överenskommelse"
    assert p["contract_start"] == "2027-01-18"
    t = p["contract_terms"]
    assert (t["guaranteed_months"], t["notice_months"], t["max_total_months"], t["short_term"]) == (2, 1, 48, True)
    assert t["guaranteed_raw"].startswith("2 mån")


def test_project_ad_units_in_row_order():
    p = mod().parse_page((FIX / "page_project.html").read_text())
    assert [u["label"] for u in p["units"]] == ["1000-1101", "1000-1201", "1000-1301"]
    first, second, third = p["units"]
    assert (first["rent_sek"], first["floor"], first["rooms_rok"], first["size_m2"]) == (10100, 1, 2.0, 49.0)
    assert (second["floor"], second["size_m2"], second["available_from"]) == (0, 49.5, "2027-02-01")
    assert "floorplan_url" not in third
    assert p["floorplans"] == [("https://bostad.stockholm.se/uploads/1101ritning.pdf", "1000-1101"),
                               ("https://bostad.stockholm.se/uploads/1201ritning.pdf", "1000-1201")]
    assert p["available_from"] == "2027-02-01"            # no page-level Inflytt: the earliest unit's


def test_feed_project_ad_takes_the_lowest_values_and_keeps_ranges():
    m = mod()
    doc = {**json.loads((FIX / "feed.json").read_text())[0], "Antal": 3, "Hyra": None, "Yta": None, "AntalRum": None,
           "LagstaHyran": 9900, "HogstaHyran": 10100, "LagstaYtan": 49, "HogstaYtan": 49.5,
           "LagstaAntalRum": 2, "HogstaAntalRum": 2}
    a = m.to_listing(doc)
    assert (a.rent_sek, a.size_m2, a.rooms_rok) == (9900, 49, 2)
    assert a.attributes["ranges"] == {"rent": [9900, 10100], "size_m2": [49, 49.5], "rooms": [2, 2], "units": 3}
