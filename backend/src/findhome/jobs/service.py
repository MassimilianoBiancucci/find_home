"""Job runs: freeze the subset into items, run in-app types, serve agent types (next / submit), undo."""
from __future__ import annotations

from types import SimpleNamespace
from typing import Any

from psycopg.types.json import Jsonb

from findhome.db import repo
from findhome.jobs import registry
from findhome.jobs.subset import subset_sql
from findhome.pets import ingest_candidate

LEASE = "10 minutes"


class JobError(Exception):
    pass


async def _one(conn, sql: str, params: tuple | list = ()) -> dict | None:
    return await (await conn.execute(sql, params)).fetchone()


async def _all(conn, sql: str, params: tuple | list = ()) -> list[dict]:
    return await (await conn.execute(sql, params)).fetchall()


def _dur(r: dict) -> float | None:
    return round((r["finished_at"] - r["started_at"]).total_seconds(), 1) if r.get("finished_at") else None


# ── definitions ─────────────────────────────────────────────
async def list_jobs(conn) -> list[dict]:
    await finalize_agent_runs(conn)
    rows = await _all(conn, """
        SELECT j.*, (SELECT count(*) FROM job_runs r WHERE r.job_key = j.key) AS runs,
               (SELECT count(*) FROM (SELECT status FROM job_runs r WHERE r.job_key = j.key
                                      ORDER BY started_at DESC LIMIT 10) x WHERE x.status = 'error') AS recent_errors,
               (SELECT row_to_json(r) FROM (SELECT id, status, counts, started_at, finished_at, agent_run_id
                                            FROM job_runs r WHERE r.job_key = j.key
                                            ORDER BY started_at DESC LIMIT 1) r) AS last_run,
               (SELECT count(*) FROM job_runs r WHERE r.job_key = j.key AND r.status = 'running') AS running
        FROM jobs j ORDER BY j.created_at, j.key""")
    for r in rows:
        t = registry.TYPES.get(r["type"])
        r.update(kind=t.kind if t else None, description=t.description if t else "", max_n=t.max_n if t else None)
    return rows


async def get_job(conn, key: str) -> dict:
    row = await _one(conn, "SELECT * FROM jobs WHERE key = %s", (key,))
    if not row:
        raise JobError(f"unknown job '{key}'")
    t = registry.get(row["type"])
    return {**row, "kind": t.kind, "description": t.description, "max_n": t.max_n, "profile": t.profile}


async def update_settings(conn, key: str, settings: dict) -> dict:
    job = await get_job(conn, key)
    merged = {**job["settings"], **settings}
    _validate(merged, job)
    await conn.execute("UPDATE jobs SET settings = %s WHERE key = %s", (Jsonb(merged), key))
    return await get_job(conn, key)


def _validate(settings: dict, job: dict) -> None:
    subset_sql(settings.get("subset") or {}, "x", 1)                 # raises on unknown keys
    n = int(settings.get("n") or 1)
    if not 1 <= n <= job["max_n"]:
        raise JobError(f"n must be between 1 and {job['max_n']}")
    if settings.get("launcher") not in (None, "cli", "vscode"):
        raise JobError("launcher must be cli or vscode")


async def preview(conn, key: str, config_hash: str, settings: dict | None = None) -> dict:
    job = await get_job(conn, key)
    s = {**job["settings"], **(settings or {})}
    _validate(s, job)
    sql, params = subset_sql(s.get("subset") or {}, config_hash, 100000)
    rows = await _all(conn, sql, params)
    return {"count": len(rows), "n": int(s.get("n") or 1), "items": rows[:20]}


# ── runs ────────────────────────────────────────────────────
async def create_run(conn, key: str, config_hash: str, settings: dict | None = None) -> dict:
    job = await get_job(conn, key)
    if not job["enabled"]:
        raise JobError(f"job '{key}' is disabled")
    if await _one(conn, "SELECT 1 FROM job_runs WHERE job_key = %s AND status = 'running'", (key,)):
        raise JobError(f"job '{key}' is already running")
    s = {**job["settings"], **(settings or {})}
    _validate(s, job)
    sql, params = subset_sql(s.get("subset") or {}, config_hash, int(s.get("n") or 1))
    picked = await _all(conn, sql, params)
    run = await _one(conn, "INSERT INTO job_runs (job_key, settings, counts) VALUES (%s,%s,%s) RETURNING *",
                     (key, Jsonb(s), Jsonb({"queued": len(picked)})))
    for i, r in enumerate(picked):
        await conn.execute("INSERT INTO job_items (job_run_id, listing_id, position) VALUES (%s,%s,%s)",
                           (run["id"], r["id"], i))
    return {**run, "kind": job["kind"], "profile": job["profile"]}


async def run_keywords(conn, run_id) -> dict:
    """pet_keywords: the strict rules on each item, through the pet precedence (never above agent/site/user)."""
    items = await _all(conn, """SELECT i.id, i.listing_id, l.title, l.description_excerpt, l.attributes, l.pet_status,
                                       l.pet_source, l.pet_evidence
                                FROM job_items i JOIN listings l ON l.id = i.listing_id
                                WHERE i.job_run_id = %s ORDER BY i.position""", (run_id,))
    for it in items:
        fake = SimpleNamespace(title=it["title"], description_excerpt=it["description_excerpt"],
                               attributes=it["attributes"] or {}, pet_status=None, pet_evidence=None,
                               source=SimpleNamespace(method="script"))
        status, evidence, source = ingest_candidate(fake)
        res = await repo.set_pet(conn, it["listing_id"], status, evidence, source)
        after = res["after"] if res else None
        outcome = ("conflict" if after["pet_status"] == "conflict" else "changed") if after else "unchanged"
        note = None if after or status == "unknown" else f"kept the {it['pet_source'] or 'existing'} value"
        await conn.execute("""UPDATE job_items SET state = 'done', before = %s, after = %s, evidence = %s, outcome = %s,
                                     note = %s, at = clock_timestamp() WHERE id = %s""",
                           (Jsonb(res["before"]) if res else None, Jsonb(after) if after else None, evidence, outcome,
                            note, it["id"]))
    return await _close_run(conn, run_id, "ok")


async def _counts(conn, run_id) -> dict:
    rows = await _all(conn, "SELECT coalesce(outcome, state) AS k, count(*) AS n FROM job_items "
                            "WHERE job_run_id = %s GROUP BY 1", (run_id,))
    total = await _one(conn, "SELECT count(*) AS n FROM job_items WHERE job_run_id = %s", (run_id,))
    return {**{r["k"]: r["n"] for r in rows}, "total": total["n"]}


async def _close_run(conn, run_id, status: str, error: str | None = None) -> dict:
    counts = await _counts(conn, run_id)
    return await _one(conn, """UPDATE job_runs SET status = %s, counts = %s, error = %s,
                                      finished_at = clock_timestamp() WHERE id = %s RETURNING *""",
                      (status, Jsonb(counts), error, run_id))


async def link_agent_run(conn, run_id, agent_run_id: str) -> None:
    await conn.execute("UPDATE job_runs SET agent_run_id = %s WHERE id = %s", (agent_run_id, run_id))


async def finalize_agent_runs(conn) -> None:
    """Close running agent job runs whose agent session has ended (it may stop before the queue is empty)."""
    rows = await _all(conn, """SELECT r.id, a.status AS agent_status FROM job_runs r JOIN agent_runs a ON a.id = r.agent_run_id
                               WHERE r.status = 'running' AND a.status NOT IN ('running', 'waiting')""")
    for r in rows:
        left = await _one(conn, "SELECT count(*) AS n FROM job_items WHERE job_run_id = %s AND state IN ('queued','leased')",
                          (r["id"],))
        ok = r["agent_status"] == "ok"
        await _close_run(conn, r["id"], "ok" if ok and not left["n"] else "partial" if ok else "error",
                         None if ok else f"agent run ended: {r['agent_status']}")


async def list_runs(conn, key: str, limit: int = 50) -> list[dict]:
    await finalize_agent_runs(conn)
    rows = await _all(conn, """SELECT r.*, a.status AS agent_status, a.launcher, a.cost_usd, a.num_turns
                               FROM job_runs r LEFT JOIN agent_runs a ON a.id = r.agent_run_id
                               WHERE r.job_key = %s ORDER BY r.started_at DESC LIMIT %s""", (key, limit))
    for r in rows:
        r["duration_s"] = _dur(r)
        if r["status"] == "running":
            r["counts"] = await _counts(conn, r["id"])
    return rows


async def run_detail(conn, run_id: str, outcome: str | None = None) -> dict:
    run = await _one(conn, """SELECT r.*, a.status AS agent_status, a.launcher, a.cost_usd, a.num_turns, a.summary
                              FROM job_runs r LEFT JOIN agent_runs a ON a.id = r.agent_run_id WHERE r.id = %s""",
                     (run_id,))
    if not run:
        raise JobError("no such job run")
    run["duration_s"] = _dur(run)
    run["counts"] = await _counts(conn, run_id)
    where, params = "i.job_run_id = %s", [run_id]
    if outcome:
        where += " AND coalesce(i.outcome, i.state) = %s"
        params.append(outcome)
    run["items"] = await _all(conn, f"""SELECT i.*, l.short_id, l.title, l.area, l.origin_site, l.pet_status AS current_pet,
                                              l.pet_source AS current_source
                                       FROM job_items i JOIN listings l ON l.id = i.listing_id
                                       WHERE {where} ORDER BY i.position""", params)
    return run


async def cancel_run(conn, run_id: str) -> dict:
    await conn.execute("UPDATE job_items SET state = 'skipped', outcome = 'skipped' WHERE job_run_id = %s "
                       "AND state IN ('queued','leased')", (run_id,))
    return await _close_run(conn, run_id, "cancelled")


# ── agent protocol ──────────────────────────────────────────
async def next_item(conn, run_id: str) -> dict | None:
    run = await _one(conn, "SELECT status FROM job_runs WHERE id = %s", (run_id,))
    if not run:
        raise JobError("no such job run")
    if run["status"] != "running":
        return None
    item = await _one(conn, f"""UPDATE job_items SET state = 'leased', leased_until = clock_timestamp() + interval '{LEASE}'
                               WHERE id = (SELECT id FROM job_items WHERE job_run_id = %s
                                           AND (state = 'queued' OR (state = 'leased' AND leased_until < clock_timestamp()))
                                           ORDER BY position LIMIT 1 FOR UPDATE SKIP LOCKED)
                               RETURNING id, listing_id, position""", (run_id,))
    if not item:
        await _close_run(conn, run_id, "ok")
        return None
    L = await _one(conn, """SELECT short_id, title, area, address_raw, origin_site, pet_status, pet_evidence, pet_source
                            FROM listings WHERE id = %s""", (item["listing_id"],))
    sources = await _all(conn, "SELECT site_slug, url FROM listing_sources WHERE listing_id = %s AND url IS NOT NULL "
                               "ORDER BY first_seen_at", (item["listing_id"],))
    left = await _one(conn, "SELECT count(*) AS n FROM job_items WHERE job_run_id = %s AND state = 'queued'", (run_id,))
    return {"short_id": L["short_id"], "title": L["title"], "area": L["area"], "address": L["address_raw"],
            "urls": [s["url"] for s in sources], "sites": [s["site_slug"] for s in sources],
            "current": {"pet_status": L["pet_status"], "pet_source": L["pet_source"], "pet_evidence": L["pet_evidence"]},
            "why": f"pet status {L['pet_status']}" + (f" (set by {L['pet_source']})" if L["pet_source"] else ""),
            "left_after_this": left["n"]}


async def submit(conn, run_id: str, short_id: str, pet: str, evidence: str | None, page_url: str | None) -> dict:
    if pet not in ("yes", "no", "ask", "unknown"):
        raise JobError("pet must be yes, no, ask or unknown")
    if pet != "unknown" and not (evidence and evidence.strip()):
        raise JobError("evidence (the quoted pet sentence) is required for yes, no and ask")
    if evidence and len(evidence) > 300:
        raise JobError("evidence must be a short quote (300 characters at most)")
    item = await _one(conn, """SELECT i.id, i.listing_id, i.state FROM job_items i JOIN listings l ON l.id = i.listing_id
                               WHERE i.job_run_id = %s AND l.short_id = %s""", (run_id, short_id.upper()))
    if not item:
        raise JobError(f"{short_id} is not part of this job run")
    if item["state"] not in ("queued", "leased"):
        raise JobError(f"{short_id} was already submitted ({item['state']})")
    res = await repo.set_pet(conn, item["listing_id"], pet, (evidence or "").strip() or "no pet wording on the page",
                             "agent")
    after = res["after"] if res else None
    outcome = ("conflict" if after["pet_status"] == "conflict" else "changed") if after else "unchanged"
    note = None if after or pet == "unknown" else f"kept the {res['before']['pet_source']} value (higher precedence)"
    await conn.execute("""UPDATE job_items SET state = 'done', before = %s, after = %s, evidence = %s, page_url = %s,
                                 outcome = %s, note = %s, at = clock_timestamp(), leased_until = NULL WHERE id = %s""",
                       (Jsonb(res["before"]), Jsonb(after) if after else None, evidence, page_url, outcome, note,
                        item["id"]))
    await conn.execute("UPDATE job_runs SET counts = %s WHERE id = %s", (Jsonb(await _counts(conn, run_id)), run_id))
    return {"short_id": short_id.upper(), "outcome": outcome, "after": after, "note": note}


async def undo(conn, item_id: int) -> dict:
    """Put back the pet status the item replaced, if nobody changed the listing since."""
    it = await _one(conn, "SELECT * FROM job_items WHERE id = %s", (item_id,))
    if not it or it["state"] != "done" or not it["after"]:
        raise JobError("nothing to undo for this item")
    cur = await _one(conn, "SELECT pet_status, pet_source FROM listings WHERE id = %s", (it["listing_id"],))
    if (cur["pet_status"], cur["pet_source"]) != (it["after"]["pet_status"], it["after"]["pet_source"]):
        raise JobError("the listing's pet status changed after this job: undo it on the listing instead")
    b = it["before"] or {}
    await conn.execute("UPDATE listings SET pet_status = %s, pet_evidence = %s, pet_source = %s, last_changed_at = now() "
                       "WHERE id = %s", (b.get("pet_status") or "unknown", b.get("pet_evidence"), b.get("pet_source"),
                                         it["listing_id"]))
    await conn.execute("UPDATE job_items SET state = 'undone' WHERE id = %s", (item_id,))
    return {"undone": item_id, "restored": b}


def agent_params(run: dict) -> dict[str, Any]:
    return {"job_run": str(run["id"]), "n": int(run["settings"].get("n") or 1)}
