"""Run lifecycle: the watchdog ends runs whose session is gone, Cancel stops only its own run's process, and nothing
a cancelled run writes later is imported."""
from __future__ import annotations

import json
import subprocess
import sys
import uuid

import psycopg
from psycopg.rows import dict_row

from findhome.agentrun import sessions


def _run_row(db_url, **cols) -> str:
    rid = str(uuid.uuid4())
    base = {"id": rid, "profile": "browser_scan", "command": "claude", "run_dir": "runs/fictional", "started_by": "app",
            "launcher": "cli", "kind": "scan", "status": "running", "session_id": str(uuid.uuid4())}
    base.update(cols)
    with psycopg.connect(db_url, autocommit=True) as c:
        c.execute(f"INSERT INTO agent_runs ({', '.join(base)}) VALUES ({', '.join(['%s'] * len(base))})", tuple(base.values()))
    return rid


def _row(db_url, rid: str) -> dict:
    with psycopg.connect(db_url, row_factory=dict_row) as c:
        return c.execute("SELECT * FROM agent_runs WHERE id = %s", (rid,)).fetchone()


def _sessions(monkeypatch, live: dict, ok: bool = True):
    async def fake():
        return sessions.Sessions(ok, {k: sessions.Session(k, v.get("pid"), v.get("name"), v.get("status"))
                                      for k, v in live.items()})
    monkeypatch.setattr(sessions, "live_sessions", fake)


def test_watchdog_ends_a_gone_run_and_keeps_a_live_one(client, db_url, monkeypatch):
    gone = _run_row(db_url, pid=999999)                                   # no such process, not in the session list
    alive = _run_row(db_url, launcher="vscode", session_id="chat-session-1")
    _sessions(monkeypatch, {"chat-session-1": {"pid": None, "status": "busy"}})
    assert client.post(f"/api/agent-runs/{gone}/reconcile").json()["status"] == "ended_no_handover"
    assert _row(db_url, gone)["result"]["end_reason"] == "session ended without run close"
    res = client.post(f"/api/agent-runs/{alive}/reconcile").json()
    assert (res["status"], res["liveness"]) == ("running", "alive_busy")


def test_an_unreadable_session_list_keeps_a_vscode_run(client, db_url, monkeypatch):
    rid = _run_row(db_url, launcher="vscode", session_id="chat-session-2")
    _sessions(monkeypatch, {}, ok=False)
    res = client.post(f"/api/agent-runs/{rid}/reconcile").json()
    assert (res["status"], res["liveness"]) == ("running", "unknown")


def test_cancel_stops_only_the_runs_own_process(client, db_url, monkeypatch):
    sid = str(uuid.uuid4())
    ours = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)", "--session-id", sid])
    other = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
    try:
        rid = _run_row(db_url, pid=ours.pid, session_id=sid)
        _sessions(monkeypatch, {})
        res = client.post(f"/api/agent-runs/{rid}/cancel").json()
        assert res["status"] == "stopped" and res["killed"] == 1
        assert ours.wait(timeout=10) is not None and other.poll() is None    # the other process lives on
        r = _row(db_url, rid)
        assert r["status"] == "cancelled", (r["status"], r["result"], r["liveness"])
        # a run whose pid is not its own (reused pid): never signalled, just marked
        rid2 = _run_row(db_url, pid=other.pid)
        res2 = client.post(f"/api/agent-runs/{rid2}/cancel").json()
        assert res2["status"] == "not_running" and other.poll() is None
        assert client.post(f"/api/agent-runs/{rid}/cancel").json()["status"] == "already_finished"
    finally:
        for p in (ours, other):
            if p.poll() is None:
                p.kill()


def test_nothing_from_a_cancelled_run_is_imported(client, db_url, monkeypatch, tmp_path):
    from findhome import inbox

    rid = _run_row(db_url, status="cancelled")
    monkeypatch.setattr(inbox, "inbox_dir", lambda: tmp_path / "inbox")
    monkeypatch.setattr(inbox, "state_dir", lambda: tmp_path / "state")
    (tmp_path / "inbox").mkdir()
    doc = {"site": "qasa", "parser": "qasa", "source": "agent_browser", "run": rid,
           "docs": [{"id": 1, "monthlyCost": 9000, "location": {"locality": "Exempelby"}}]}
    (tmp_path / "inbox" / "qasa-20261118T120000-p1.json").write_text(json.dumps(doc))
    client.post("/api/inbox/import")
    assert (tmp_path / "inbox" / "cancelled" / rid / "qasa-20261118T120000-p1.json").exists()
    assert _row(db_url, rid)["late_files"] == 1
    assert client.get("/api/listings/exists", params={"site": "qasa", "ref": "1"}).json()["exists"] is False
    # and its CLI writes are refused
    item = {"source": {"site_slug": "qasa", "external_id": "2"}, "rent_sek": 9000}
    assert client.post("/api/ingest/listings", json={"listings": [item], "run": rid}).status_code == 409


def test_a_lone_write_rule_is_a_config_error(test_repo):
    import pytest

    from findhome.config.loader import ConfigError
    from findhome.config.writer import apply_ops

    with pytest.raises(ConfigError, match=r"Write\(\./notes/\*\*\) needs Edit"):    # refused before it is written
        apply_ops("agent", [{"op": "add", "path": "/profiles/browser_scan/allowed_tools/-", "value": "Write(./notes/**)"}],
                  test_repo / "config", test_repo / "sites")
