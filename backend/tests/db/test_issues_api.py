"""Listing issues in the API (sub-plan #7): codes on list rows, full issues on the listing (fictional data)."""
from __future__ import annotations


def test_list_rows_carry_codes_and_the_listing_full_issues(client):
    card = {"source": {"site_slug": "samtrygg", "external_id": "fict-i1", "url": "https://example.invalid/s/i1",
                       "method": "agent_browser"},
            "title": "Påhittad", "address_raw": "Exempelgatan, Exempelby", "area": "Exempelby", "rent_sek": 9000,
            "rooms_rok": 2, "size_m2": 50, "lat": 59.3, "lon": 18.0}
    sid = client.post("/api/ingest/listings", json={"listings": [card]}).json()["items"][0]["short_id"]
    row = next(r for r in client.get("/api/listings").json()["items"] if r["short_id"] == sid)
    assert {"move_in_missing", "photos_missing", "address_partial", "coords_approximate"} <= set(row["issue_codes"])
    issues = {i["code"]: i for i in client.get(f"/api/listings/{sid}").json()["issues"]}
    assert issues["photos_missing"]["cls"] == "check_extraction" and issues["photos_missing"]["hint"]
    assert "pets" not in " ".join(issues)
