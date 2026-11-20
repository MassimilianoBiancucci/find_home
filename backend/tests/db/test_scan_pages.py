"""Browser scan result pages posted by extract.js (kind page) and the scan report with coverage (sub-plan #9,
fictional cards)."""
from __future__ import annotations

import uuid

import psycopg
from psycopg.rows import dict_row


def _sql(db_url, sql, params=()):
    with psycopg.connect(db_url, row_factory=dict_row, autocommit=True) as c:
        cur = c.execute(sql, params)
        return cur.fetchall() if cur.description else None


def _card(n):
    return {"id": f"fict{n:04d}", "url": f"https://www.samtrygg.se/object/fict{n:04d}/stockholm/exempelby/exempelvagen-{n}/2-rok",
            "address": f"Exempelvägen {n}", "area": "Exempelby", "rent_sek": 9000 + n, "size_m2": 50, "rooms": 2,
            "period": "1 jan 2027 - Tillsvidare", "tags": [], "badges": [], "images": []}


def test_pages_post_import_and_report_coverage(client, db_url, tmp_path, monkeypatch):
    from findhome import inbox

    monkeypatch.setattr(inbox, "inbox_dir", lambda: tmp_path)
    run = str(uuid.uuid4())
    _sql(db_url, """INSERT INTO agent_runs (id, profile, command, run_dir, started_by, launcher, kind, status, site_slug)
                    VALUES (%s, 'browser_scan', 'claude', 'runs/fictional', 'app', 'cli', 'scan', 'running', 'samtrygg')""",
         (run,))
    page1 = {"page": 1, "on_page": 3, "total_shown": 5, "last_page": False, "docs": [_card(n) for n in (1, 2, 3)]}
    page2 = {"page": 2, "on_page": 2, "total_shown": 5, "last_page": True, "docs": [_card(3), _card(4)]}
    a = client.post("/api/inbox/raw", json={"kind": "page", "site": "samtrygg", "run": run, "doc": page1}).json()
    assert (a["page"], a["cards"], a["new"], a["total"], a["last_page"]) == (1, 3, 3, 5, False)
    b = client.post("/api/inbox/raw", json={"kind": "page", "site": "samtrygg", "run": run, "doc": page2}).json()
    assert b["new"] == 1 and b["last_page"] is True
    assert len(list((tmp_path / "processed").glob("samtrygg-*-p*.json"))) == 2          # the record a file would leave
    status = _sql(db_url, "SELECT ad_status FROM listing_sources WHERE external_id = 'fict0004'")[0]["ad_status"]
    assert status == "open"
    scored = _sql(db_url, """SELECT count(*) AS n FROM scores s JOIN listing_sources ls ON ls.listing_id = s.listing_id
                             WHERE ls.external_id LIKE 'fict000%%'""")[0]["n"]
    assert scored == 4                                   # scored at import, so the details chain sees real passes
    report = client.get(f"/api/agent-runs/{run}").json()["scan_report"]["sites"][0]
    assert [p["page"] for p in report["pages"]] == [1, 2] and report["cards"] == 5 and report["total"] == 5
    assert report["coverage"] == 1.0 and report["warning"] is None and report["line"] == "5 of 5 cards (100%)"
    # a translated page is not imported; a closed run refuses posts
    tr = client.post("/api/inbox/raw", json={"kind": "page", "site": "samtrygg", "run": run, "doc": {"translated": True}})
    assert tr.json()["translated"] is True
    _sql(db_url, "UPDATE agent_runs SET status = 'ok' WHERE id = %s", (run,))
    assert client.post("/api/inbox/raw", json={"kind": "page", "site": "samtrygg", "run": run, "doc": page1}).status_code == 409


def test_a_short_scan_warns_under_95_percent(client, db_url):
    run = str(uuid.uuid4())
    _sql(db_url, """INSERT INTO agent_runs (id, profile, command, run_dir, started_by, launcher, kind, status, site_slug)
                    VALUES (%s, 'browser_scan', 'claude', 'runs/fictional', 'app', 'cli', 'scan', 'ok', 'qasa')""", (run,))
    _sql(db_url, """INSERT INTO scan_runs (site_slug, method, agent_run_id, status, counts) VALUES
                    ('qasa', 'agent_browser', %s, 'ok', '{"pages": {"1": {"cards": 59, "total": 200}, "2": {"cards": 59, "total": 200}}}')""",
         (run,))
    report = client.get(f"/api/agent-runs/{run}").json()["scan_report"]["sites"][0]
    assert report["coverage"] == 0.59 and "under 95%" in report["warning"]


def test_a_scripted_scans_page_count_does_not_break_the_state_file(client, db_url, tmp_path, monkeypatch):
    import asyncio

    from findhome import inbox
    from findhome.config.store import get_store

    monkeypatch.setattr(inbox, "state_dir", lambda: tmp_path)          # never the real runs/state

    _sql(db_url, """INSERT INTO scan_runs (site_slug, method, status, counts)
                    VALUES ('bostadsformedlingen', 'api', 'ok', '{"pages": 1}')""")

    async def go():
        async with await psycopg.AsyncConnection.connect(db_url, row_factory=dict_row) as conn:
            await inbox.write_state(conn, get_store().bundle)
    asyncio.run(go())
    assert (tmp_path / "samtrygg.json").exists()
