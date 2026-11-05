"""Jobs: subset preview, the in-app keyword job, the agent protocol (next / submit), precedence and undo."""
from __future__ import annotations

import pytest


def _listing(ext: str, description: str | None = None, flag: bool | None = None) -> dict:
    item = {"source": {"site_slug": "samtrygg", "external_id": ext, "method": "script",
                       "url": f"https://listing.invalid/{ext}"},
            "title": f"Fictional flat {ext}", "rent_sek": 9000 + int(ext), "attributes": {}}
    if description:
        item["description_excerpt"] = description
    if flag is not None:
        item["attributes"]["pets_flag"] = {"value": flag, "evidence": "badge"}
    return item


@pytest.fixture
def listings(client):
    res = client.post("/api/ingest/listings", json={"listings": [
        _listing("1", "Inga husdjur.", flag=True),      # conflict (site yes, text no)
        _listing("2", "Fin utsikt."),                   # unknown
        _listing("3", "Katter är välkomna."),           # yes (keywords)
        _listing("4", "Ljus trea."),                    # unknown
    ]}).json()
    return [i["short_id"] for i in res["items"]]


def _pet(client, sid):
    L = client.get(f"/api/listings/{sid}").json()["listing"]
    return L["pet_status"], L["pet_source"]


def test_jobs_listed_and_preview(client, listings):
    jobs = {j["key"]: j for j in client.get("/api/jobs").json()["items"]}
    assert set(jobs) >= {"pet_keywords", "pet_agent_check"}
    assert jobs["pet_agent_check"]["kind"] == "agent" and jobs["pet_agent_check"]["settings"]["n"] == 10
    prev = client.post("/api/jobs/pet_agent_check/preview", json={"settings": {}}).json()
    assert prev["count"] == 3                                   # 1 conflict + 2 unknown
    bad = client.post("/api/jobs/pet_agent_check/preview", json={"settings": {"subset": {"nope": 1}}})
    assert bad.status_code == 422
    assert client.patch("/api/jobs/pet_agent_check", json={"settings": {"n": 99}}).status_code == 422
    assert client.patch("/api/jobs/pet_agent_check", json={"settings": {"n": 2}}).json()["settings"]["n"] == 2


def test_keyword_job_respects_precedence(client, listings):
    client.post(f"/api/listings/{listings[2]}/pet", json={"status": "no", "note": "asked the landlord"})
    run = client.post("/api/jobs/pet_keywords/run", json={"settings": {"subset": {"short_ids": listings}}}).json()["run"]
    assert run["status"] == "ok" and run["counts"]["total"] == 4
    detail = client.get(f"/api/job-runs/{run['id']}").json()
    by = {i["short_id"]: i for i in detail["items"]}
    assert by[listings[2]]["outcome"] == "unchanged" and "user" in by[listings[2]]["note"]     # your answer kept
    assert by[listings[0]]["outcome"] == "unchanged"                                          # conflict untouched
    assert _pet(client, listings[2]) == ("no", "user")


def test_agent_protocol_next_submit_undo(client, listings):
    # the VS Code launcher registers a waiting agent run; the test plays the agent through the protocol
    res = client.post("/api/jobs/pet_agent_check/run", json={"settings": {"n": 2}, "launcher": "vscode"})
    assert res.status_code == 200, res.text
    body = res.json()
    run_id = body["run"]["id"]
    assert body["agent"]["status"] == "waiting" and f"job_run={run_id}" in body["agent"]["prompt"]
    assert client.post("/api/jobs/pet_agent_check/run", json={}).status_code == 409        # one at a time

    first = client.post(f"/api/job-runs/{run_id}/next").json()["item"]
    assert first["urls"][0].startswith("https://listing.invalid/")
    bad = client.post(f"/api/job-runs/{run_id}/submit", json={"short_id": first["short_id"], "pet": "no"})
    assert bad.status_code == 422 and "evidence" in bad.json()["detail"]
    ok = client.post(f"/api/job-runs/{run_id}/submit", json={
        "short_id": first["short_id"], "pet": "ask", "evidence": "Husdjur efter överenskommelse.",
        "url": first["urls"][0]}).json()
    assert ok["outcome"] == "changed" and _pet(client, first["short_id"]) == ("ask", "agent")
    second = client.post(f"/api/job-runs/{run_id}/next").json()["item"]
    client.post(f"/api/job-runs/{run_id}/submit", json={"short_id": second["short_id"], "pet": "unknown"})
    assert client.post(f"/api/job-runs/{run_id}/next").json()["item"] is None               # n = 2 → done
    detail = client.get(f"/api/job-runs/{run_id}").json()
    assert detail["status"] == "ok" and detail["counts"]["changed"] == 1 and detail["counts"]["unchanged"] == 1
    item = next(i for i in detail["items"] if i["outcome"] == "changed")
    before = item["before"]["pet_status"]
    assert client.post(f"/api/job-items/{item['id']}/undo").status_code == 200
    assert _pet(client, first["short_id"])[0] == before
    assert client.post(f"/api/job-items/{item['id']}/undo").status_code == 409

    import shutil

    from findhome.core.paths import repo_root
    run_dir = client.get(f"/api/agent-runs/{body['agent']['id']}").json()["run_dir"]
    shutil.rmtree(repo_root() / run_dir, ignore_errors=True)
