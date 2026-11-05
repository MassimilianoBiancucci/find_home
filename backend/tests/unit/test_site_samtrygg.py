"""Samtrygg inbox parser: extract.js docs → ListingIn (fictional cards)."""
from __future__ import annotations

import importlib.util
from pathlib import Path

from findhome.pets import ingest_candidate

REPO = Path(__file__).resolve().parents[3]


def to_listing():
    spec = importlib.util.spec_from_file_location("samtrygg_t", REPO / "sites" / "samtrygg" / "scanner.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.to_listing


def doc(**kw) -> dict:
    return {"id": "abc123", "url": "https://www.samtrygg.se/object/abc123/stockholm/pahittad-gatan-1/2-rok",
            "area": "Testholmen", "address": "Påhittade gatan 1", "rent_sek": 14500, "size_m2": 48, "rooms": 2,
            "furnished": True, "period": "1 JAN 2027 – 1 JAN 2029", "tags": ["Balkong", "Hiss"], "badges": [],
            "pets": None, "images": ["https://img.invalid/1.jpg"], **kw}


def test_mapping_and_period():
    item = to_listing()(doc())
    assert item.source.external_id == "abc123" and item.source.method == "agent_browser"
    assert (item.rent_sek, item.size_m2, item.rooms_rok, item.furnished) == (14500, 48, 2, True)
    assert str(item.contract_start) == "2027-01-01" and str(item.contract_end) == "2029-01-01"
    assert item.has_balcony and item.has_elevator and item.contract_type == "second_hand"
    open_ended = to_listing()(doc(period="NU – TILLSVIDARE"))
    assert open_ended.contract_end is None and open_ended.attributes["open_ended"] is True
    wrap = to_listing()(doc(period="29 NOV – 14 FEB 2027"))
    assert str(wrap.contract_start) == "2026-11-29"


def test_only_an_explicit_husdjur_ok_tag_is_the_sites_flag():
    yes = to_listing()(doc(pets="Husdjur ok"))
    assert yes.attributes["pets_flag"]["value"] is True and ingest_candidate(yes)[0::2] == ("yes", "site")
    other = to_listing()(doc(pets="Inga husdjur"))
    assert "pets_flag" not in other.attributes and ingest_candidate(other)[0::2] == ("no", "keywords")
    none = to_listing()(doc())
    assert ingest_candidate(none)[0] == "unknown"


def test_masked_values_are_recovered_or_dropped():
    item = to_listing()(doc(id="[BLOCKED: looks like a token]", images=["[BLOCKED: x]", "https://img.invalid/2.jpg"]))
    assert item.source.external_id == "abc123"                       # from /object/<id>/ in the URL
    assert item.photo_urls == ["https://img.invalid/2.jpg"]
    import pytest
    with pytest.raises(ValueError):
        to_listing()(doc(id="[BLOCKED: a]", url="[BLOCKED: b]"))
