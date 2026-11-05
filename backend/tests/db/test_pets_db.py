"""Pet status through the API: site flag vs text at ingest, then agent and user answers by precedence."""
from __future__ import annotations


def _listing(ext: str, description: str | None = None, flag: bool | None = None, **kw) -> dict:
    item = {"source": {"site_slug": "samtrygg", "external_id": ext, "method": "script"},
            "title": f"Fictional flat {ext}", "rent_sek": 9000 + int(ext), "attributes": {}}
    if description:
        item["description_excerpt"] = description
    if flag is not None:
        item["attributes"]["pets_flag"] = {"value": flag, "evidence": "badge: Husdjur ok"}
    item.update(kw)
    return item


def _get(client, short_id: str) -> dict:
    return client.get(f"/api/listings/{short_id}").json()["listing"]


def _ingest(client, *items) -> list[str]:
    res = client.post("/api/ingest/listings", json={"listings": list(items)}).json()
    return [i["short_id"] for i in res["items"]]


def test_flag_text_conflict_and_precedence(client):
    ids = _ingest(client,
                  _listing("1", "Ljus etta. Inga husdjur.", flag=True),          # site says yes, text says no
                  _listing("2", "Katter är välkomna."),                           # keywords only
                  _listing("3", "Fin utsikt."),                                   # nothing explicit
                  _listing("4", "Allergianpassad lägenhet.", flag=True))          # ambiguous text keeps the flag
    a, b, c, d = (_get(client, i) for i in ids)
    assert (a["pet_status"], a["pet_source"]) == ("conflict", "site") and "Inga husdjur." in a["pet_evidence"]
    assert (b["pet_status"], b["pet_source"]) == ("yes", "keywords")
    assert c["pet_status"] == "unknown"
    assert (d["pet_status"], d["pet_source"]) == ("yes", "site")

    # the agent resolves the conflict; a later scan with the same flag does not undo it
    client.post("/api/ingest/evaluations", json={"evaluations": [
        {"short_id": ids[0], "summary": "read the page", "pet_status": "ask", "pet_evidence": "'husdjur efter samråd'"}]})
    assert (_get(client, ids[0])["pet_status"], _get(client, ids[0])["pet_source"]) == ("ask", "agent")
    _ingest(client, _listing("1", "Ljus etta. Husdjur ok.", flag=True))
    assert _get(client, ids[0])["pet_status"] == "ask"

    # your answer wins over everything; the no_pets feedback tag is your answer too
    client.post(f"/api/listings/{ids[0]}/pet", json={"status": "yes", "note": "landlord confirmed by phone"})
    assert (_get(client, ids[0])["pet_status"], _get(client, ids[0])["pet_source"]) == ("yes", "user")
    client.post("/api/ingest/evaluations", json={"evaluations": [
        {"short_id": ids[0], "summary": "x", "pet_status": "no", "pet_evidence": "'no pets'"}]})
    assert _get(client, ids[0])["pet_status"] == "yes"
    client.post(f"/api/listings/{ids[1]}/feedback", json={"polarity": "dislike", "tags": ["no_pets"]})
    assert (_get(client, ids[1])["pet_status"], _get(client, ids[1])["pet_source"]) == ("no", "user")
