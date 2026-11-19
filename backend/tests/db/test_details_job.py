"""The details job: a page posts its data to the app, the agent adds quoted free-text values, undo restores, a
browser scan chains the job (fictional listings)."""
from __future__ import annotations

import uuid

import psycopg
from psycopg.rows import dict_row

URL = "https://www.samtrygg.se/object/fict0001/stockholm/exempelby/exempelvagen-12b/2-rok"


def _sql(db_url, sql, params=()):
    with psycopg.connect(db_url, row_factory=dict_row, autocommit=True) as c:
        cur = c.execute(sql, params)
        return cur.fetchall() if cur.description else None


def _setup(client, db_url, status="running"):
    """A stored Samtrygg card listing, an open agent run, and a details job run with that listing queued."""
    card = {"source": {"site_slug": "samtrygg", "external_id": "fict0001", "url": URL, "method": "agent_browser"},
            "title": "Exempelvägen 12B", "address_raw": "Exempelvägen 12B, Exempelby", "area": "Exempelby",
            "rent_sek": 12500, "rooms_rok": 2, "size_m2": 55, "lat": 59.27, "lon": 18.08}
    sid = client.post("/api/ingest/listings", json={"listings": [card]}).json()["items"][0]["short_id"]
    run = str(uuid.uuid4())
    _sql(db_url, """INSERT INTO agent_runs (id, profile, command, run_dir, started_by, launcher, kind, status, site_slug)
                    VALUES (%s, 'listing_details', 'claude', 'runs/fictional', 'app', 'cli', 'job', %s, 'samtrygg')""",
         (run, status))
    jr = _sql(db_url, """INSERT INTO job_runs (job_key, settings, counts, agent_run_id) VALUES
                         ('listing_details', '{}', '{}', %s) RETURNING id""", (run,))[0]["id"]
    lid = _sql(db_url, "SELECT id FROM listings WHERE short_id = %s", (sid,))[0]["id"]
    _sql(db_url, "INSERT INTO job_items (job_run_id, listing_id, position, state) VALUES (%s, %s, 0, 'leased')", (jr, lid))
    return sid, run, str(jr)


DOC = {"listing": True, "start": "2027-01-04", "end": None, "price": 12500, "rooms": 2, "size": 55,
       "address": {"streetAddress": "Exempelvägen 12B", "postalCode": "123 45", "addressLocality": "Exempelby"},
       "photos": ["https://img.invalid/a.jpg", "https://img.invalid/b.jpg"], "description": "Påhittad beskrivning.",
       "amenities": ["Balkong"], "utilities": ["El — ingår"], "facts": {"VÅNING": "3", "MÖBLERING": "Omöblerad"},
       "pets": "ask", "pets_evidence": "Husdjur tillåtet — saknas"}


def test_a_page_post_applies_what_the_page_had(client, db_url):
    sid, run, jr = _setup(client, db_url)
    res = client.post("/api/inbox/raw", json={"kind": "detail", "site": "samtrygg", "run": run, "job_run": jr,
                                              "url": URL, "doc": DOC}).json()
    assert res["short_id"] == sid and res["outcome"] == "changed" and res["missing"] == []
    L = client.get(f"/api/listings/{sid}").json()["listing"]
    assert L["available_from"] == "2027-01-04" and L["floor"] == 3 and L["furnished"] is False
    assert len(L["photo_urls"]) == 2 and L["pet_status"] == "ask" and L["attributes"]["details_checked_at"]
    item = _sql(db_url, "SELECT * FROM job_items WHERE job_run_id = %s", (jr,))[0]
    assert item["state"] == "done" and item["after"]["available_from"] == "2027-01-04"
    assert item["before"]["available_from"] is None
    # a second read of the same page changes nothing
    again = client.post("/api/inbox/raw", json={"kind": "detail", "site": "samtrygg", "run": run, "job_run": jr,
                                                "url": URL, "doc": DOC}).json()
    assert again["outcome"] == "unchanged"


def test_posts_need_an_open_run_and_the_sites_origin(client, db_url):
    _sid, run, jr = _setup(client, db_url, status="ok")
    body = {"kind": "detail", "site": "samtrygg", "run": run, "job_run": jr, "url": URL, "doc": DOC}
    assert client.post("/api/inbox/raw", json=body).status_code == 409             # the run is over
    pre = {"Origin": "https://www.samtrygg.se", "Access-Control-Request-Method": "POST",
           "Access-Control-Request-Private-Network": "true"}
    ok = client.options("/api/inbox/raw", headers=pre)
    assert ok.status_code == 204 and ok.headers["access-control-allow-origin"] == "https://www.samtrygg.se"
    assert ok.headers["access-control-allow-private-network"] == "true"
    assert client.options("/api/inbox/raw", headers={**pre, "Origin": "https://evil.example"}).status_code == 403
    assert "access-control-allow-origin" not in client.options("/api/listings", headers=pre).headers


def test_gone_translated_and_quoted_free_text(client, db_url):
    sid, run, jr = _setup(client, db_url)
    tr = client.post("/api/inbox/raw", json={"kind": "detail", "site": "samtrygg", "run": run, "job_run": jr,
                                             "url": URL, "doc": {"translated": True}}).json()
    assert tr["outcome"] == "translated" and "translation" in tr["stop"]
    # a value from free text needs its quote
    bad = client.post(f"/api/job-runs/{jr}/submit", json={"short_id": sid, "fields": {"available_from": "2027-03-01"},
                                                         "field_evidence": {}})
    assert bad.status_code == 422 and "quote" in bad.json()["detail"]
    ok = client.post(f"/api/job-runs/{jr}/submit", json={
        "short_id": sid, "fields": {"available_from": "2027-03-01", "contract_terms": {"notice_raw": "Uppsägning 3 mån"}},
        "field_evidence": {"available_from": "Tillträde 1 mars 2027.", "contract_terms": "Uppsägningstid 3 månader."}})
    assert ok.status_code == 200 and "available_from" in ok.json()["changed"]
    item = _sql(db_url, "SELECT id, evidence, after FROM job_items WHERE job_run_id = %s", (jr,))[0]
    assert "Tillträde 1 mars 2027." in item["evidence"]
    # undo puts the fields back
    assert client.post(f"/api/job-items/{item['id']}/undo").status_code == 200
    L = client.get(f"/api/listings/{sid}").json()["listing"]
    assert L["available_from"] is None and "contract_terms" not in L["attributes"]
    gone = client.post(f"/api/job-runs/{jr}/submit", json={"short_id": sid, "gone": True}).json()
    assert gone["outcome"] == "gone"


def test_subset_keys_and_the_chain_after_a_browser_scan(client, db_url, monkeypatch):
    import asyncio

    from findhome.agentrun import launcher
    from findhome.jobs import details

    sid, _run, jr = _setup(client, db_url)
    scan_run = str(uuid.uuid4())
    _sql(db_url, """INSERT INTO agent_runs (id, profile, command, run_dir, started_by, launcher, kind, status, site_slug)
                    VALUES (%s, 'browser_scan', 'claude', 'runs/fictional', 'app', 'cli', 'scan', 'ok', 'samtrygg')""",
         (scan_run,))
    sr = _sql(db_url, """INSERT INTO scan_runs (site_slug, method, trigger, agent_run_id) VALUES
                         ('samtrygg', 'agent_browser', 'agent', %s) RETURNING id""", (scan_run,))[0]["id"]
    _sql(db_url, "UPDATE listing_sources SET scan_run_id = %s", (sr,))
    started = []

    async def fake_start(_bundle, profile, params, launcher_kind):
        started.append((profile, params))
        rid = str(uuid.uuid4())
        _sql(db_url, """INSERT INTO agent_runs (id, profile, command, run_dir, started_by, launcher, kind, status)
                        VALUES (%s, %s, 'claude', 'runs/fictional', 'app', 'cli', 'job', 'running')""", (rid, profile))
        return {"id": rid}
    monkeypatch.setattr(launcher, "start", fake_start)

    async def go():
        async with await psycopg.AsyncConnection.connect(db_url, row_factory=dict_row) as conn:
            return await details.chain_after_run(conn, scan_run)
    assert asyncio.run(go()) is None                       # a details run is still open: no second one
    _sql(db_url, "UPDATE job_runs SET status = 'ok' WHERE id = %s", (jr,))
    res = asyncio.run(go())
    assert res and res["items"] == 1 and started[0][0] == "listing_details"
    items = _sql(db_url, """SELECT l.short_id FROM job_items i JOIN listings l ON l.id = i.listing_id
                            WHERE i.job_run_id = %s""", (res["job_run"],))
    assert [r["short_id"] for r in items] == [sid]


def test_urls_redacted_by_the_browser_tool_never_shrink_the_gallery(client, db_url):
    sid, run, jr = _setup(client, db_url)
    body = {"kind": "detail", "site": "samtrygg", "run": run, "job_run": jr, "url": URL, "doc": DOC}
    client.post("/api/inbox/raw", json=body)
    cut = {**DOC, "photos": ["https://img.invalid/a.jpg", "[BLOCKED: Cookie/query string data]"]}
    res = client.post("/api/inbox/raw", json={**body, "doc": cut}).json()
    assert res["outcome"] == "unchanged"
    L = client.get(f"/api/listings/{sid}").json()["listing"]
    assert L["photo_urls"] == DOC["photos"] and L["attributes"]["photo_count"] == 2
    note = _sql(db_url, "SELECT note FROM job_items WHERE job_run_id = %s", (jr,))[0]["note"]
    assert "1 URLs redacted" in note
