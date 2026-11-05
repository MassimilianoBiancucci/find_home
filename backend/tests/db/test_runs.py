"""Run records: every scan, however it was started, is a scan run; agent sessions are agent runs."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
FIX = REPO / "backend" / "tests" / "fixtures" / "qasa"


def _qasa_nodes() -> list[dict]:
    spec = importlib.util.spec_from_file_location("qasa_runs_t", REPO / "sites" / "qasa" / "scanner.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    nodes, _ = mod.search_documents((FIX / "search_page.html").read_text())
    return nodes


def _inbox(monkeypatch, tmp_path):
    from findhome import inbox

    monkeypatch.setattr(inbox, "inbox_dir", lambda: tmp_path / "inbox")
    monkeypatch.setattr(inbox, "state_dir", lambda: tmp_path / "state")
    (tmp_path / "inbox").mkdir()
    return tmp_path / "inbox"


def _write(folder: Path, name: str, docs: list, run: str | None = None, page: int = 1) -> None:
    body = {"site": "qasa", "parser": "qasa", "source": "agent_browser", "page": page, "docs": docs}
    if run:
        body["run"] = run
    (folder / name).write_text(json.dumps(body))


def test_inbox_files_of_one_scan_fill_one_scan_run(client, monkeypatch, tmp_path):
    folder = _inbox(monkeypatch, tmp_path)
    nodes = _qasa_nodes()
    _write(folder, "qasa-20261101T100000-p1.json", nodes[:2], run="batch-A", page=1)
    _write(folder, "qasa-20261101T100020-p2.json", nodes[2:], run="batch-A", page=2)
    _write(folder, "qasa-20261101T110000-p1.json", nodes[:1])          # no run id → its own scan run
    client.post("/api/inbox/import")
    runs = client.get("/api/runs").json()["scan_runs"]
    batch = next(r for r in runs if r["batch_id"] == "batch-A")
    assert batch["pages"] == 2 and batch["method"] == "agent_browser" and batch["trigger"] == "inbox"
    assert batch["counts"]["new"] == 3 and batch["counts"]["seen"] == 3 and batch["status"] == "ok"
    assert batch["duration_s"] is not None and batch["duration_s"] >= 0
    single = next(r for r in runs if r["batch_id"] == "qasa-20261101T110000-p1.json")
    assert single["counts"]["unchanged"] == 1
    detail = client.get(f"/api/runs/scan/{batch['id']}").json()
    assert len(detail["listings"]) == 3 and all(x["origin_site"] for x in detail["listings"])
    site = next(s for s in client.get("/api/sites").json()["items"] if s["slug"] == "qasa")
    assert site["last_scan_at"] and site["last_error"] is None


def test_inbox_run_id_links_the_agent_run(client, monkeypatch, tmp_path):
    folder = _inbox(monkeypatch, tmp_path)
    run_id = client.post("/api/agent-runs/register", json={"profile": "browser_scan", "run_dir": "runs/x",
                                                            "kind": "scan", "site": "qasa"}).json()["id"]
    _write(folder, "qasa-20261101T100000-p1.json", _qasa_nodes(), run=run_id)
    client.post("/api/inbox/import")
    agent = client.get("/api/runs").json()["agent_runs"][0]
    assert agent["id"] == run_id and len(agent["scan_runs"]) == 1
    assert agent["scan_runs"][0]["trigger"] == "agent" and agent["scan_runs"][0]["counts"]["new"] == 3
    assert client.get("/api/runs").json()["scan_runs"] == []          # nested, not standalone


def test_api_ingest_with_run_groups_calls(client, sample_listings):
    for chunk in (sample_listings[:2], sample_listings[2:]):
        assert client.post("/api/ingest/listings", json={"listings": chunk, "run": "cli:1"}).status_code == 200
    runs = [r for r in client.get("/api/runs").json()["scan_runs"] if r["batch_id"] == "cli:1"]
    sites = {s["source"]["site_slug"] for s in sample_listings}
    assert len(runs) == len(sites)
    assert sum(r["counts"]["seen"] for r in runs) == len(sample_listings)


def test_attach_close_and_session_end_hook(client):
    run_id = client.post("/api/agent-runs/register", json={"profile": "p", "run_dir": "runs/y"}).json()["id"]
    assert client.post(f"/api/agent-runs/{run_id}/attach", json={"session_id": "sess-1"}).status_code == 200
    # a session that belongs to no run (code work) is ignored
    assert client.post("/api/hooks/session-end", json={"session_id": "other", "reason": "other"}).json() == {"closed": None}
    closed = client.post("/api/hooks/session-end", json={"session_id": "sess-1", "transcript_path": "/t.jsonl",
                                                         "reason": "prompt_input_exit"}).json()
    assert closed["closed"] == run_id
    run = client.get(f"/api/agent-runs/{run_id}").json()
    assert run["status"] == "ended_no_handover" and run["transcript_path"] == "/t.jsonl"
    # a run closed normally is not touched by the hook
    other = client.post("/api/agent-runs/register", json={"profile": "p", "run_dir": "runs/z",
                                                          "session_id": "sess-2"}).json()["id"]
    client.patch(f"/api/agent-runs/{other}", json={"summary": "done"})
    assert client.post("/api/hooks/session-end", json={"session_id": "sess-2"}).json() == {"closed": None}
    assert client.get(f"/api/agent-runs/{other}").json()["status"] == "ok"
    assert client.post(f"/api/agent-runs/{other}/attach", json={}).status_code == 409


def test_backfill_inbox_is_idempotent(client, monkeypatch, tmp_path):
    folder = _inbox(monkeypatch, tmp_path)
    nodes = _qasa_nodes()
    _write(folder, "qasa-20261101T141918-p1.json", nodes[:2])
    _write(folder, "qasa-20261101T141937-p2.json", nodes[2:])
    client.post("/api/inbox/import")
    # simulate imports made before files carried a run: drop the runs the import just recorded
    import psycopg

    from findhome.core.settings import get_settings
    with psycopg.connect(get_settings().database_url, autocommit=True) as conn:
        conn.execute("UPDATE listing_sources SET scan_run_id = NULL, first_scan_run_id = NULL")
        conn.execute("DELETE FROM scan_runs")
    res = client.post("/api/runs/backfill-inbox").json()["results"]
    assert len(res) == 1 and res[0]["files"] == 2 and res[0]["linked"] == 3
    assert client.post("/api/runs/backfill-inbox").json()["results"] == []
    agent = client.get("/api/runs").json()["agent_runs"][0]
    assert agent["launcher"] == "manual" and agent["scan_runs"][0]["trigger"] == "backfill"
    assert agent["scan_runs"][0]["pages"] == 2


def test_vscode_launcher_registers_a_waiting_run(client):
    res = client.post("/api/agent-runs", json={"profile": "browser_scan", "params": {"site": "qasa", "pages": 2},
                                               "launcher": "vscode"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "waiting" and body["open_url"].startswith("vscode://anthropic.claude-code/open?prompt=")
    assert f"run={body['id']}" in body["prompt"] and "pages=2" in body["prompt"]
    run = client.get(f"/api/agent-runs/{body['id']}").json()
    assert run["status"] == "waiting" and run["launcher"] == "vscode" and run["site_slug"] == "qasa"
    assert client.post(f"/api/agent-runs/{body['id']}/attach", json={"session_id": "vs-1"}).json()["status"] == "running"
    bad = client.post("/api/agent-runs", json={"profile": "browser_scan", "params": {"site": "homeq"},
                                               "launcher": "vscode"})
    assert bad.status_code == 409 and "origin-only" in bad.json()["detail"]
    other = client.post("/api/agent-runs", json={"profile": "browser_scan", "params": {"site": "qasa"},
                                                 "launcher": "vscode"}).json()
    assert client.post(f"/api/agent-runs/{other['id']}/cancel").json() == {"cancelled": True}
    import shutil

    from findhome.core.paths import repo_root
    for rid in (body["id"], other["id"]):
        shutil.rmtree(repo_root() / client.get(f"/api/agent-runs/{rid}").json()["run_dir"], ignore_errors=True)
