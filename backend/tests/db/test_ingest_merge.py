"""Ingest merges `attributes` key by key: a feed-only update keeps what a page read stored."""
from __future__ import annotations

import psycopg
from psycopg.rows import dict_row


def _item(attrs: dict, rent: int = 9100) -> dict:
    return {"source": {"site_slug": "bostadsformedlingen", "external_id": "900001", "method": "script"},
            "title": "2 rum · Exempelgatan 1", "address_raw": "Exempelgatan 1, Exempelby", "rent_sek": rent,
            "attributes": attrs}


def _attrs(client, short_id: str) -> dict:
    return client.get(f"/api/listings/{short_id}").json()["listing"]["attributes"]


def test_feed_update_keeps_page_keys_and_a_new_read_replaces_them(client):
    terms = {"guaranteed_months": 2, "guaranteed_raw": "Garanterad boendetid: 2 månader"}
    res = client.post("/api/ingest/listings", json={"listings": [
        _item({"Kommun": "Exempelby", "contract_terms": terms, "move_in_raw": "2027-01-01"})]}).json()
    sid = res["items"][0]["short_id"]

    # a feed-only scan (no page keys) with a changed rent: the page keys stay
    client.post("/api/ingest/listings", json={"listings": [_item({"Kommun": "Exempelby", "apply_by": "2026-12-01"},
                                                                 rent=9200)]})
    a = _attrs(client, sid)
    assert a["contract_terms"] == terms and a["move_in_raw"] == "2027-01-01" and a["apply_by"] == "2026-12-01"

    # a second page read replaces a key whole (one level): the old guaranteed months do not mix in
    client.post("/api/ingest/listings", json={"listings": [_item({"contract_terms": {"notice_months": 1}}, rent=9300)]})
    a = _attrs(client, sid)
    assert a["contract_terms"] == {"notice_months": 1} and a["Kommun"] == "Exempelby"


async def test_score_listings_touches_only_the_given_ids(client, db_url):
    from findhome.rescore import score_listings

    res = client.post("/api/ingest/listings", json={"listings": [
        {**_item({}), "source": {"site_slug": "bostadsformedlingen", "external_id": str(900100 + i)},
         "address_raw": f"Exempelgatan {i}, Exempelby", "lat": 59.30 + i / 100, "lon": 18.05} for i in range(3)]}).json()
    with psycopg.connect(db_url, row_factory=dict_row, autocommit=True) as c:
        c.execute("DELETE FROM scores")
        ids = [r["id"] for r in c.execute("SELECT id FROM listings WHERE short_id = ANY(%s) ORDER BY short_id",
                                          ([i["short_id"] for i in res["items"]],)).fetchall()]
    async with await psycopg.AsyncConnection.connect(db_url, row_factory=dict_row) as conn:
        out = await score_listings(conn, [ids[0], ids[2], ids[0]])
        await conn.commit()
    assert out["scored"] == 2
    with psycopg.connect(db_url, row_factory=dict_row) as c:
        scored = {r["listing_id"] for r in c.execute("SELECT listing_id FROM scores").fetchall()}
    assert scored == {ids[0], ids[2]}
