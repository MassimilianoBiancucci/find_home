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


def module():
    spec = importlib.util.spec_from_file_location("samtrygg_m", REPO / "sites" / "samtrygg" / "scanner.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_a_start_without_a_year_takes_the_next_occurrence_after_the_day_seen():
    convert = to_listing()
    dec = convert(doc(period="1 dec – Tillsvidare", _seen="2026-11-05"))
    assert str(dec.available_from) == "2026-12-01" and dec.attributes["move_in_raw"] == "1 dec"
    jan = convert(doc(period="15 jan – Tillsvidare", _seen="2026-12-20"))
    assert str(jan.available_from) == "2027-01-15"                       # a January start seen in December: next year
    same_day = convert(doc(period="5 nov – Tillsvidare", _seen="2026-11-05"))
    assert str(same_day.available_from) == "2026-11-05"
    now = convert(doc(period="Nu – 31 jan 2027", _seen="2026-11-05"))
    assert now.available_from is None and now.attributes["move_in_raw"] == "Nu"
    assert str(now.contract_end) == "2027-01-31"


def test_address_parts_never_invent_a_number():
    m = module()
    assert m.address_parts("Exempelvägen 12B", "Exempelby") == {"street": "Exempelvägen", "number": "12B",
                                                                 "locality": "Exempelby"}
    assert m.address_parts("Exempelvägen", "Exempelby") == {"street": "Exempelvägen", "locality": "Exempelby"}
    assert to_listing()(doc()).attributes["address_parts"] == {"street": "Påhittade gatan", "number": "1",
                                                               "locality": "Testholmen"}


def test_object_page_maps_structured_data_and_the_pet_row():
    m = module()
    page = {"listing": True, "start": "2026-08-01", "end": None, "price": 12500, "price_note": "inkl. el",
            "rooms": 2, "size": 55, "geo": {"latitude": 59.27, "longitude": 18.08},
            "address": {"streetAddress": "Exempelvägen 12B", "postalCode": "123 45", "addressLocality": "Exempelby"},
            "photos": ["https://img.invalid/a.jpg", "https://img.invalid/b.jpg"], "description": "Påhittad text.",
            "amenities": ["Balkong"], "facts": {"VÅNING": "3", "MÖBLERING": "Delvis möblerad", "BOENDEFORM": "Hyresrätt",
                                                 "FRÅN": "18 nov. 2026"},
            "pets": "ask", "pets_evidence": "Husdjur tillåtet — saknas"}
    out = m.detail_to_listing(page)
    assert out["available_from"] == "2026-08-01" and "contract_end" not in out    # JSON-LD, not today's FRÅN
    assert (out["floor"], out["rent_sek"], out["lat"]) == (3, 12500, 59.27) and "furnished" not in out
    a = out["attributes"]
    assert a["open_ended"] and a["furnishing_raw"] == "Delvis möblerad" and a["housing_type"] == "Hyresrätt"
    assert a["address_parts"] == {"street": "Exempelvägen", "number": "12B", "locality": "Exempelby", "postcode": "123 45"}
    assert a["pets_flag"] == {"value": "ask", "evidence": "Husdjur tillåtet — saknas"} and a["photo_count"] == 2
    both = m.detail_to_listing({**page, "utilities": ["El — ingår"], "area": "Exempelby"})["attributes"]
    assert both["utilities"] == ["El — ingår"] and both["district_label"] == "Exempelby"
    card = to_listing()(doc(furnished=None, furnishing="Delvis möblerad"))
    assert card.furnished is None and card.attributes["furnishing_raw"] == "Delvis möblerad"
    yes = m.detail_to_listing({**page, "pets": "yes", "pets_evidence": "Husdjur tillåtet"})
    assert yes["attributes"]["pets_flag"]["value"] is True


def test_inbox_files_give_parsers_the_day_they_were_read():
    from findhome.inbox import seen_date

    assert seen_date("samtrygg-20261105T204500-p1.json") == "2026-11-05"
    assert len(seen_date("no-stamp.json")) == 10
