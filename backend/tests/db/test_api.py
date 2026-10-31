import time
from pathlib import Path

from findhome.core.paths import repo_root
from findhome.db.migrate import status

REPO = Path(__file__).resolve().parents[3]


def test_migrations_up_to_date(db_url):
    st = status(db_url)
    assert st.applied and not st.pending and not st.changed


def test_health(client):
    body = client.get("/health").json()
    assert body["status"] == "ok" and body["db"] is True and body["config_hash"]


def test_ingest_idempotent_and_cross_site_dedupe(client, sample_listings):
    first = client.post("/api/ingest/listings", json={"listings": sample_listings}).json()
    assert (first["created"], first["duplicate"]) == (3, 1)
    dup = next(i for i in first["items"] if i["external_id"] == "b-77")
    orig = next(i for i in first["items"] if i["external_id"] == "q-1001")
    assert dup["short_id"] == orig["short_id"]
    again = client.post("/api/ingest/listings", json={"listings": sample_listings}).json()
    assert again["unchanged"] == 4 and again["created"] == again["updated"] == 0
    detail = client.get(f"/api/listings/{orig['short_id']}").json()
    assert {s["site_slug"] for s in detail["sources"]} == {"qasa", "blocket-bostad"}
    assert detail["listing"]["pet_status"] == "ask"        # not downgraded by blocket's "unknown"


def test_change_detected_per_source(client, sample_listings):
    client.post("/api/ingest/listings", json={"listings": sample_listings})
    changed = dict(sample_listings[3], rent_sek=18500)
    res = client.post("/api/ingest/listings", json={"listings": [changed]}).json()
    assert res["updated"] == 1
    sid = res["items"][0]["short_id"]
    assert client.get(f"/api/listings/{sid}").json()["listing"]["rent_sek"] == 18500


def test_status_feedback_and_scores(client, sample_listings):
    items = client.post("/api/ingest/listings", json={"listings": sample_listings}).json()["items"]
    ids = {i["external_id"]: i["short_id"] for i in items}
    assert client.post(f"/api/listings/{ids['q-1002']}/status", json={"status": "shortlisted"}).status_code == 200
    assert client.post(f"/api/listings/{ids['q-1002']}/status", json={"status": "bogus"}).status_code == 422
    ok = client.post(f"/api/listings/{ids['q-1002']}/feedback", json={"polarity": "like", "tags": ["bright", "balcony"]})
    assert ok.status_code == 200
    bad = client.post(f"/api/listings/{ids['q-1002']}/feedback", json={"polarity": "like", "tags": ["nope"]})
    assert bad.status_code == 422
    res = client.post("/api/scores/recompute", json={}).json()
    assert res["scored"] == 3 and res["rejected"] == 1
    rows = client.get("/api/listings").json()["items"]
    rejected = next(r for r in rows if r["short_id"] == ids["s-9"])
    assert rejected["score"] is None and "pet_status_exclude" in rejected["rejected_by"]
    assert rows[0]["score"] is not None


def test_commute_dry_run_and_estimates(client, sample_listings):
    sid = client.post("/api/ingest/listings", json={"listings": sample_listings}).json()["items"][0]["short_id"]
    dry = client.post("/api/commute/compute", json={"short_ids": [sid], "dry_run": True}).json()
    r = dry["results"][sid]
    assert r["calls"] == 0 and "work-main" in r["missing_coords"]        # address is TODO(user)
    real = client.post("/api/commute/compute", json={"short_ids": [sid]}).json()["results"][sid]
    assert real["windows_stored"] > 0 and real["estimated"] > 0
    items = client.get(f"/api/commute/{sid}").json()["items"]
    assert {i["point_id"] for i in items} == {"stockholm-central"}
    assert all(i["provider"] == "haversine" for i in items)
    client.post("/api/scores/recompute", json={"short_ids": [sid]})
    digest = client.get(f"/api/digest/listing/{sid}").text
    assert digest.startswith(sid) and "stockholm-central" in digest and "score" in digest


def test_history_digest_sections(client, sample_listings):
    items = client.post("/api/ingest/listings", json={"listings": sample_listings}).json()["items"]
    sid = items[2]["short_id"]
    client.post(f"/api/listings/{sid}/status", json={"status": "rejected"})
    client.post(f"/api/listings/{sid}/feedback", json={"polarity": "dislike", "tags": ["no_pets", "too_small"]})
    text = client.get("/api/digest/history").text
    for section in ("## Profile", "## Traits from your feedback", "## Pipeline", "## Rejected", "## Seen per site",
                    "## Pet policy to clarify", "## To evaluate"):
        assert section in text
    assert "no_pets×1" in text and sid in text
    assert len(text.encode()) < 8000


def test_sites_and_scan_guards(client):
    sites = {s["slug"]: s for s in client.get("/api/sites").json()["items"]}
    assert set(sites) == {"qasa", "blocket-bostad", "samtrygg", "bostadsformedlingen"}
    assert sites["qasa"]["status"] == "active"
    assert all(s["status"] == "unverified" for k, s in sites.items() if k != "qasa")
    res = client.post("/api/scans", json={"site": "samtrygg"})
    assert res.status_code == 422 and "unverified" in res.json()["detail"]


def test_scan_qasa_with_mocked_http(client, monkeypatch):
    """Full scan path (fetch → parse → enrich new → ingest) with Qasa fixtures instead of the network."""
    import importlib.util

    import httpx

    from findhome.scanning import runner

    fix = REPO / "backend" / "tests" / "fixtures" / "qasa"
    spec = importlib.util.spec_from_file_location("qasa_scanner_db", REPO / "sites" / "qasa" / "scanner.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    def handler(request):
        if "/home/" in request.url.path:
            return httpx.Response(200, text=(fix / "detail_page.html").read_text())
        page = int(request.url.params.get("page", 1))
        return httpx.Response(200, text=(fix / "search_page.html").read_text() if page == 1 else "<html></html>")

    def fake_make(site):
        return mod.QasaScanner(site, client=httpx.AsyncClient(transport=httpx.MockTransport(handler)), save_raw=False)

    monkeypatch.setattr(runner, "make_scanner", fake_make)
    monkeypatch.setattr(runner.asyncio, "sleep", _no_sleep)
    dry = client.post("/api/scans", json={"site": "qasa", "dry_run": True}).json()["results"][0]
    assert dry["parsed"] == 3 and dry["enriched"] == 2 and len(dry["preview"]) == 3
    assert client.get("/api/listings").json()["items"] == []          # dry run stores nothing
    real = client.post("/api/scans", json={"site": "all"}).json()["results"][0]
    assert real["new"] == 3 and real["enriched"] == 3, real
    again = client.post("/api/scans", json={"site": "qasa"}).json()["results"][0]
    assert again["unchanged"] == 3 and again["enriched"] == 0         # known listings are not enriched again
    rows = {r["external_id"] if "external_id" in r else r["short_id"]: r for r in client.get("/api/listings").json()["items"]}
    assert any(r["floor"] == 3 and r["has_balcony"] for r in rows.values())


async def _no_sleep(_s):
    return None


def test_evaluations_and_exists(client, sample_listings):
    items = client.post("/api/ingest/listings", json={"listings": sample_listings}).json()["items"]
    sid = items[0]["short_id"]
    ev = {"short_id": sid, "summary": "Bright two-room flat, pets negotiable.", "pros": ["balcony"],
          "cons": ["second-hand 12 months"], "questions_for_landlord": ["Are two indoor cats OK?"],
          "pet_status": "ask", "pet_evidence": "Husdjur enligt överenskommelse"}
    assert client.post("/api/ingest/evaluations", json={"evaluations": [ev]}).status_code == 200
    full = client.get(f"/api/digest/listing/{sid}", params={"full": "true"}).text
    assert "eval: Bright" in full and "? Are two indoor cats OK?" in full
    assert client.get("/api/listings/exists", params={"site": "qasa", "ref": "q-1001"}).json()["exists"] is True
    assert client.get("/api/listings/exists", params={"site": "qasa", "ref": "zzz"}).json()["exists"] is False


def test_config_patch_via_api_changes_hash(client):
    h1 = client.get("/api/config").json()["config_hash"]
    res = client.patch("/api/config/profile", json={"ops": [
        {"op": "replace", "path": "/kinds/rent/hard_filters/max_rent_sek", "value": 16000}]})
    assert res.status_code == 200 and res.json()["config_hash"] != h1
    assert "max_rent_sek: 16000" in client.get("/api/config/profile").json()["text"]
    bad = client.patch("/api/config/locations", json={"ops": [
        {"op": "replace", "path": "/points/0/category", "value": "nope"}]})
    assert bad.status_code == 422 and bad.json()["errors"]


def test_map_endpoints(client, sample_listings):
    client.post("/api/ingest/listings", json={"listings": sample_listings})
    pts = client.get("/api/map/points").json()
    central = next(f for f in pts["features"] if f["properties"]["id"] == "stockholm-central")
    assert central["geometry"]["coordinates"] == [18.0586, 59.3303]
    assert len(client.get("/api/map/listings").json()["features"]) == 3


def test_agent_run_launch_and_log(client):
    started = client.post("/api/agent-runs", json={"profile": "test_echo"})
    assert started.status_code == 200, started.text
    run = started.json()
    for _ in range(50):
        runs = client.get("/api/runs").json()["agent_runs"]
        if runs and runs[0]["status"] != "running":
            break
        time.sleep(0.1)
    assert runs[0]["status"] == "ok" and runs[0]["exit_code"] == 0
    run_dir = repo_root() / run["run_dir"]
    try:
        log = (run_dir / "log.jsonl").read_text()
        assert "prompt chars" in log
        assert (run_dir / "context" / "history_digest.md").exists()
        assert (run_dir / "scratchpad.md").read_text().startswith("# Scratchpad")
    finally:
        import shutil
        shutil.rmtree(run_dir, ignore_errors=True)
    assert client.post("/api/agent-runs", json={"profile": "missing"}).status_code == 409
