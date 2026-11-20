"""Ad status per source (sub-plan #11): free from scans, the status job's page posts, undo, the closed filter
(fictional listings)."""
from __future__ import annotations

import asyncio
import uuid
from types import SimpleNamespace

import psycopg
from psycopg.rows import dict_row

from findhome.scanning.base import ScanStats

BF = "bostadsformedlingen"
RULES = {"feed_complete_min": 3, "feed_missing_status": "applications_closed"}


def _sql(db_url, sql, params=()):
    with psycopg.connect(db_url, row_factory=dict_row, autocommit=True) as c:
        cur = c.execute(sql, params)
        return cur.fetchall() if cur.description else None


def _card(site, ext, n, **kw):
    return {"source": {"site_slug": site, "external_id": ext, "url": f"https://example.invalid/{site}/{ext}",
                       "method": "script"},
            "title": f"Påhittad {n}", "address_raw": f"Exempelgatan {n}, Exempelby", "area": "Exempelby",
            "rent_sek": 9000 + n, "rooms_rok": 2, "size_m2": 50 + n, "lat": 59.30 + n / 1000, "lon": 18.0, **kw}


def _ingest(client, cards):
    return [i["short_id"] for i in client.post("/api/ingest/listings", json={"listings": cards}).json()["items"]]


def _feed(db_url, ids, errors=(), complete_min=3):
    from findhome.scanning.runner import feed_status

    site = SimpleNamespace(slug=BF, ad_status={**RULES, "feed_complete_min": complete_min},
                           fetch={"api": {"endpoint": "https://example.invalid/feed"}})
    items = [SimpleNamespace(source=SimpleNamespace(external_id=i)) for i in ids]

    async def go():
        async with await psycopg.AsyncConnection.connect(db_url, row_factory=dict_row) as conn:
            out = await feed_status(conn, site, SimpleNamespace(feed_ids=list(ids)), items,
                                    ScanStats(errors=list(errors)))
            await conn.commit()
            return out
    return asyncio.run(go())


def _status(db_url, ext):
    return _sql(db_url, "SELECT ad_status FROM listing_sources WHERE site_slug = %s AND external_id = %s",
                (BF, ext))[0]["ad_status"]


def test_a_complete_feed_closes_only_missing_open_sources_and_reopens(client, db_url):
    sids = _ingest(client, [_card(BF, f"fict-{n}", n) for n in range(4)])
    assert _status(db_url, "fict-0") == "unknown"                           # imported: never checked
    out = _feed(db_url, ["fict-0", "fict-1", "fict-2", "other"])
    assert out["status_closed"] == 1 and _status(db_url, "fict-3") == "applications_closed"
    assert _status(db_url, "fict-0") == "open"
    # a short or broken feed closes nothing
    assert "status_closed" not in _feed(db_url, ["fict-0"], complete_min=3)
    assert "status_closed" not in _feed(db_url, ["fict-0", "fict-1", "x", "y"], errors=["page 1: HTTPError 500"])
    assert _status(db_url, "fict-1") == "open"
    # back in the feed: open again; events only on change
    _feed(db_url, ["fict-0", "fict-1", "fict-2", "fict-3"])
    ev = _sql(db_url, """SELECT e.from_status, e.to_status, e.actor FROM source_status_events e
                         JOIN listing_sources s ON s.id = e.source_id WHERE s.external_id = 'fict-3' ORDER BY e.id""")
    assert [(e["from_status"], e["to_status"]) for e in ev] == [("unknown", "applications_closed"),
                                                               ("applications_closed", "open")]
    assert all(e["actor"] == "scan" for e in ev)
    detail = client.get(f"/api/listings/{sids[3]}").json()
    assert detail["sources"][0]["ad_status"] == "open" and detail["ad_status_events"][0]["to_status"] == "open"


def test_the_closed_filter_hides_a_listing_only_when_no_source_is_open(client, db_url):
    a, b = _ingest(client, [_card(BF, "fict-a", 1), _card(BF, "fict-b", 2)])
    _sql(db_url, "UPDATE listing_sources SET ad_status = 'rented' WHERE external_id = 'fict-b'")
    shown = {r["short_id"] for r in client.get("/api/listings").json()["items"]}
    assert a in shown and b not in shown                                    # default: closed hidden
    both = {r["short_id"]: r for r in client.get("/api/listings?closed=include").json()["items"]}
    assert both[b]["ad_open"] is False and both[b]["ad_sources"][0]["status"] == "rented"
    assert {r["short_id"] for r in client.get("/api/listings?closed=only").json()["items"]} == {b}
    # the same flat still open on a second site stays shown
    lid = _sql(db_url, "SELECT listing_id FROM listing_sources WHERE external_id = 'fict-b'")[0]["listing_id"]
    _sql(db_url, """INSERT INTO listing_sources (listing_id, site_slug, external_id, url, ad_status)
                    VALUES (%s, 'samtrygg', 'fict-b2', 'https://example.invalid/s/b2', 'open')""", (lid,))
    assert b in {r["short_id"] for r in client.get("/api/listings").json()["items"]}


def _status_run(client, db_url, sid, status="running"):
    run = str(uuid.uuid4())
    _sql(db_url, """INSERT INTO agent_runs (id, profile, command, run_dir, started_by, launcher, kind, status, site_slug)
                    VALUES (%s, 'listing_status', 'claude', 'runs/fictional', 'app', 'cli', 'job', %s, 'samtrygg')""",
         (run, status))
    jr = _sql(db_url, """INSERT INTO job_runs (job_key, settings, counts, agent_run_id) VALUES
                         ('listing_status', '{"subset": {"sites": ["samtrygg"]}}', '{}', %s) RETURNING id""", (run,))[0]["id"]
    lid = _sql(db_url, "SELECT id FROM listings WHERE short_id = %s", (sid,))[0]["id"]
    _sql(db_url, "INSERT INTO job_items (job_run_id, listing_id, position, state) VALUES (%s, %s, 0, 'leased')", (jr, lid))
    return run, str(jr)


def test_a_status_post_sets_the_status_rereads_the_price_and_undoes(client, db_url):
    (sid,) = _ingest(client, [_card("samtrygg", "fict0009", 9)])
    run, jr = _status_run(client, db_url, sid)
    url = "https://example.invalid/samtrygg/fict0009"
    body = {"kind": "status", "site": "samtrygg", "run": run, "job_run": jr, "url": url,
            "doc": {"status": "open", "evidence": {"rule": "JSON-LD offers.availability", "value": "InStock"},
                    "price": 9500}}
    res = client.post("/api/inbox/raw", json=body).json()
    assert res["outcome"] == "changed" and set(res["changed"]) == {"ad_status.samtrygg", "rent_sek"}
    assert client.get(f"/api/listings/{sid}").json()["listing"]["rent_sek"] == 9500
    item = _sql(db_url, "SELECT id, note FROM job_items WHERE job_run_id = %s", (jr,))[0]
    assert "JSON-LD" in item["note"]
    # an unknown result never overwrites a known status
    unknown = client.post("/api/inbox/raw", json={**body, "doc": {"status": "unknown", "evidence": {}}}).json()
    assert unknown["outcome"] == "unread"
    assert _sql(db_url, "SELECT ad_status FROM listing_sources WHERE external_id = 'fict0009'")[0]["ad_status"] == "open"
    # undo puts back the status and the price
    assert client.post(f"/api/job-items/{item['id']}/undo").status_code == 200
    src = _sql(db_url, "SELECT ad_status FROM listing_sources WHERE external_id = 'fict0009'")[0]
    assert src["ad_status"] == "unknown"
    assert client.get(f"/api/listings/{sid}").json()["listing"]["rent_sek"] == 9009


def test_status_subset_keys(client, db_url):
    from findhome.jobs.subset import subset_sql

    s1, s2 = _ingest(client, [_card("samtrygg", "fict-s1", 1), _card("samtrygg", "fict-s2", 2)])
    _sql(db_url, "UPDATE listing_sources SET ad_status = 'rented' WHERE external_id = 'fict-s2'")
    _sql(db_url, """INSERT INTO scan_runs (site_slug, method, status, started_at)
                    VALUES ('samtrygg', 'agent_browser', 'ok', now() + interval '1 minute')""")

    def ids(subset):
        sql, params = subset_sql(subset, "x", 100)
        return {r["short_id"] for r in _sql(db_url, sql, params)}
    assert ids({"sites": ["samtrygg"], "ad_status_in": ["open", "unknown"]}) == {s1}
    assert ids({"sites": ["samtrygg"], "not_seen_since_last_scan": True}) == {s1, s2}
    _sql(db_url, "UPDATE listing_sources SET last_seen_at = now() + interval '2 minutes' WHERE external_id = 'fict-s1'")
    assert ids({"sites": ["samtrygg"], "not_seen_since_last_scan": True}) == {s2}


def test_status_due_takes_unlisted_or_stale_sources_and_rows_say_stale(client, db_url):
    from findhome.jobs.subset import subset_sql

    fresh, old, never = _ingest(client, [_card("qasa", f"fict-q{n}", n) for n in (1, 2, 3)])
    _sql(db_url, "UPDATE listing_sources SET ad_status = 'open', status_checked_at = now() WHERE external_id = 'fict-q1'")
    _sql(db_url, """UPDATE listing_sources SET ad_status = 'open', status_checked_at = now() - interval '9 days'
                    WHERE external_id = 'fict-q2'""")

    def ids(subset):
        sql, params = subset_sql(subset, "x", 100, stale=7)
        return {r["short_id"] for r in _sql(db_url, sql, params)}
    assert ids({"sites": ["qasa"], "status_due": True}) == {old, never}
    _sql(db_url, """INSERT INTO scan_runs (site_slug, method, status, started_at)
                    VALUES ('qasa', 'agent_browser', 'ok', now() + interval '1 minute')""")
    assert ids({"sites": ["qasa"], "status_due": True}) == {fresh, old, never}   # the last scan listed none of them
    rows = {r["short_id"]: r for r in client.get("/api/listings").json()["items"]}
    assert rows[fresh]["ad_stale"] is False and rows[old]["ad_stale"] is True and rows[never]["ad_stale"] is True


def test_move_in_misses_come_back_on_request(client, db_url):
    early, late = _ingest(client, [_card(BF, "fict-m1", 1), _card(BF, "fict-m2", 2)])
    client.post("/api/scores/recompute", json={"short_ids": [early, late]})
    _sql(db_url, """UPDATE scores SET total = NULL, rejected_by = ARRAY['move_in_from_slack']
                    WHERE listing_id = (SELECT listing_id FROM listing_sources WHERE external_id = 'fict-m1')""")
    _sql(db_url, """UPDATE scores SET total = NULL, rejected_by = ARRAY['move_in_to', 'max_rent_sek']
                    WHERE listing_id = (SELECT listing_id FROM listing_sources WHERE external_id = 'fict-m2')""")
    rows = lambda q: {r["short_id"] for r in client.get(f"/api/listings?include_rejected=false{q}").json()["items"]}  # noqa: E731
    assert early not in rows("") and late not in rows("")
    assert early in rows("&move_in_misses=true") and late not in rows("&move_in_misses=true")   # rent fails too
