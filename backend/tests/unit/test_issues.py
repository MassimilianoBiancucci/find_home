"""Listing issues (sub-plan #7): one fictional listing per code and class; pets and contract never an issue."""
from __future__ import annotations

from findhome.domain.issues import issue_codes, listing_issues

FULL = {"available_from": "2027-01-01", "photo_urls": ["https://img.invalid/a.jpg"],
        "floorplan_urls": ["https://img.invalid/p.png"], "description_excerpt": "Påhittad.",
        "address_raw": "Exempelgatan 12, Exempelby", "lat": 59.3, "lon": 18.0, "rent_sek": 9000, "size_m2": 50,
        "rooms_rok": 2, "attributes": {"details_checked_at": "2026-11-19T10:00:00+00:00"},
        "pet_status": "unknown", "contract_type": None}


def by_code(L):
    return {i.code: i for i in listing_issues(L)}


def test_a_complete_listing_has_none_whatever_its_pets_or_contract():
    assert issue_codes(FULL) == []
    assert issue_codes({**FULL, "pet_status": "conflict", "contract_type": "second_hand"}) == []


def test_missing_values_are_not_in_source_once_the_page_was_read():
    L = {**FULL, "available_from": None, "photo_urls": [], "floorplan_urls": [], "description_excerpt": None}
    read = by_code(L)
    assert {c: i.cls for c, i in read.items()} == {
        "move_in_missing": "not_in_source", "photos_missing": "not_in_source", "floorplan_missing": "not_in_source",
        "description_missing": "not_in_source"}
    unread = by_code({**L, "attributes": {}})
    assert all(i.cls == "check_extraction" for i in unread.values()) and "Complete details" in unread["photos_missing"].hint


def test_move_in_words_address_coordinates_core_fields_and_translation():
    words = by_code({**FULL, "available_from": None, "attributes": {"move_in_raw": "Nu"}})["move_in_missing"]
    assert words.cls == "not_in_source" and "Nu" in words.label
    partial = by_code({**FULL, "address_raw": "Exempelgatan, Exempelby"})
    assert partial["address_partial"].cls == "not_in_source" and "coords_approximate" in partial
    assert by_code({**FULL, "lat": None})["coords_missing"].cls == "check_extraction"
    parts = by_code({**FULL, "attributes": {**FULL["attributes"], "address_parts": {"street": "Exempelgatan"}}})
    assert "address_partial" in parts
    core = by_code({**FULL, "rent_sek": None, "size_m2": None, "rooms_rok": None})
    assert {"rent_missing", "size_missing", "rooms_missing"} <= set(core)
    assert by_code({**FULL, "last_read_translated": True})["page_translated"].cls == "check_extraction"
    assert issue_codes({**FULL, "attributes": {**FULL["attributes"], "floorplans": [{"url": "x", "kind": "pdf"}]},
                        "floorplan_urls": []}) == []
