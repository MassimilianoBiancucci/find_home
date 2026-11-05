"""Run records: scan runs (one per scan of one site, any method) and agent runs (one per agent session).

Writers: the scripted scanner (scanning/runner.py), the inbox importer (browser scans, grouped by the files' "run"
id), the agent launcher (agentrun/launcher.py) and the CLI (`findhome run new|attach|close`). Reader: the Runs
timeline (GET /api/runs) and the Sites page (last scan per site).
"""
from __future__ import annotations

import uuid
from typing import Any

from psycopg.types.json import Jsonb

from findhome.domain.models import IngestResult

COUNT_KEYS = ("seen", "new", "changed", "unchanged", "dup_cross_site", "parse_errors")
OPEN_AGENT_STATUSES = ("waiting", "running")


async def _one(conn, sql: str, params: tuple = ()) -> dict | None:
    return await (await conn.execute(sql, params)).fetchone()


async def _all(conn, sql: str, params: tuple = ()) -> list[dict]:
    return await (await conn.execute(sql, params)).fetchall()


def _as_uuid(value: str | None) -> str | None:
    try:
        return str(uuid.UUID(str(value))) if value else None
    except ValueError:
        return None


# ── scan runs ───────────────────────────────────────────────
async def create_scan_run(conn, site: str, method: str, trigger: str, dry_run: bool = False, *,
                          agent_run_id: str | None = None, batch_id: str | None = None,
                          params: dict | None = None) -> str:
    row = await _one(conn, """INSERT INTO scan_runs (site_slug, method, trigger, dry_run, agent_run_id, batch_id, params,
                                                     started_at)
                              VALUES (%s,%s,%s,%s,%s,%s,%s,clock_timestamp()) RETURNING id""",
                     (site, method, trigger, dry_run, agent_run_id, batch_id, Jsonb(params or {})))
    return str(row["id"])


async def finish_scan_run(conn, run_id: str, status: str, counts: dict, error: str | None = None,
                          pages: int | None = None) -> None:
    await conn.execute("""UPDATE scan_runs SET finished_at = clock_timestamp(), status = %s, counts = %s, error = %s,
                                 pages = coalesce(%s, pages) WHERE id = %s""",
                       (status, Jsonb(counts), error, pages, run_id))
    await conn.execute("UPDATE sites SET last_scan_at = clock_timestamp(), last_error = %s WHERE slug = "
                       "(SELECT site_slug FROM scan_runs WHERE id = %s)", (error, run_id))


async def batch_scan_run(conn, site: str, method: str, run_ref: str | None, fallback_batch: str,
                         trigger: str = "inbox") -> str:
    """The scan run that collects every inbox file of one browser scan.

    run_ref is the file's "run" value: an agent run id links the scan run to that agent run; any other value is a
    batch id shared by the scan's files; no value makes a run per file (fallback_batch, the file name)."""
    agent_id = _as_uuid(run_ref)
    if agent_id and not await _one(conn, "SELECT 1 FROM agent_runs WHERE id = %s", (agent_id,)):
        agent_id = None
    batch = None if agent_id else (run_ref or fallback_batch)
    row = await _one(conn, """SELECT id FROM scan_runs WHERE site_slug = %s
                                AND coalesce(agent_run_id::text, batch_id) = %s""",
                     (site, agent_id or batch))
    if row:
        return str(row["id"])
    return await create_scan_run(conn, site, method, "agent" if agent_id else trigger,
                                 agent_run_id=agent_id, batch_id=batch)


async def add_to_scan_run(conn, run_id: str, res: IngestResult, seen: int, pages: int = 1) -> None:
    """Add one inbox file's ingest result to its scan run (counts are summed, pages counted)."""
    row = await _one(conn, "SELECT counts FROM scan_runs WHERE id = %s", (run_id,))
    counts = dict(row["counts"] or {}) if row else {}
    add = {"seen": seen, "new": res.created, "changed": res.updated, "unchanged": res.unchanged,
           "dup_cross_site": res.duplicate}
    for k, v in add.items():
        counts[k] = int(counts.get(k) or 0) + v
    await conn.execute("""UPDATE scan_runs SET counts = %s, pages = pages + %s, status = 'ok', error = NULL,
                                 finished_at = clock_timestamp() WHERE id = %s""", (Jsonb(counts), pages, run_id))
    await conn.execute("UPDATE sites SET last_scan_at = clock_timestamp(), last_error = NULL WHERE slug = "
                       "(SELECT site_slug FROM scan_runs WHERE id = %s)", (run_id,))


async def scan_run_detail(conn, run_id: str) -> dict | None:
    run = await _one(conn, "SELECT * FROM scan_runs WHERE id = %s", (run_id,))
    if not run:
        return None
    rows = await _all(conn, """SELECT l.short_id, l.title, l.area, l.origin_site, l.pet_status, s.first_seen_at,
                                      (s.first_scan_run_id = %s) AS found_here
                               FROM listing_sources s JOIN listings l ON l.id = s.listing_id
                               WHERE s.scan_run_id = %s OR s.first_scan_run_id = %s
                               ORDER BY found_here DESC, s.first_seen_at DESC LIMIT 500""", (run_id, run_id, run_id))
    return {**run, "listings": rows}


# ── agent runs ──────────────────────────────────────────────
async def create_agent_run(conn, *, profile: str, command: str, run_dir: str, log_path: str | None = None,
                           started_by: str = "app", launcher: str = "cli", kind: str = "other",
                           site_slug: str | None = None, params: dict | None = None, session_id: str | None = None,
                           status: str = "running") -> str:
    row = await _one(conn, """INSERT INTO agent_runs (profile, command, run_dir, log_path, started_by, launcher, kind,
                                                      site_slug, params, session_id, status, started_at)
                              VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,clock_timestamp()) RETURNING id""",
                     (profile, command, run_dir, log_path, started_by, launcher, kind, site_slug, Jsonb(params or {}),
                      session_id, status))
    return str(row["id"])


async def finish_agent_run(conn, run_id: str, status: str, exit_code: int | None = None,
                           result: dict | None = None) -> None:
    result = result or {}
    await conn.execute(
        """UPDATE agent_runs SET finished_at = clock_timestamp(), status = %s, exit_code = %s,
                  cost_usd = coalesce(%s, cost_usd), num_turns = coalesce(%s, num_turns),
                  result = coalesce(%s, result), session_id = coalesce(session_id, %s),
                  summary = coalesce(summary, %s)
           WHERE id = %s""",
        (status, exit_code, result.get("total_cost_usd"), result.get("num_turns"),
         Jsonb(result) if result else None, result.get("session_id"),
         (result.get("result") or None) and str(result["result"])[:4000], run_id))


async def attach_agent_run(conn, run_id: str, session_id: str | None) -> dict | None:
    return await _one(conn, """UPDATE agent_runs SET status = 'running', session_id = coalesce(%s, session_id)
                               WHERE id = %s AND status IN ('waiting','running') RETURNING id, run_dir, status""",
                      (session_id, run_id))


async def close_agent_run(conn, run_id: str, summary: str) -> None:
    await conn.execute("""UPDATE agent_runs SET summary = %s, finished_at = coalesce(finished_at, clock_timestamp()),
                                 status = CASE WHEN status IN ('running','waiting') THEN 'ok' ELSE status END
                          WHERE id = %s""", (summary[:4000], run_id))


async def session_ended(conn, session_id: str, transcript_path: str | None, reason: str | None) -> dict | None:
    """SessionEnd hook: close a run whose agent ended without `run close`. Unknown sessions are ignored."""
    return await _one(conn, """UPDATE agent_runs SET status = 'ended_no_handover', finished_at = clock_timestamp(),
                                      transcript_path = %s,
                                      result = coalesce(result, '{}'::jsonb) || jsonb_build_object('end_reason', %s::text)
                               WHERE session_id = %s AND status IN ('waiting','running') RETURNING id""",
                      (transcript_path, reason, session_id))


async def expire_waiting(conn, hours: float = 2) -> None:
    await conn.execute("""UPDATE agent_runs SET status = 'expired', finished_at = clock_timestamp()
                          WHERE status = 'waiting' AND started_at < clock_timestamp() - make_interval(secs => %s)""",
                       (hours * 3600,))


async def get_agent_run(conn, run_id: str) -> dict | None:
    return await _one(conn, "SELECT * FROM agent_runs WHERE id = %s", (run_id,))


# ── timeline ────────────────────────────────────────────────
def _duration(r: dict) -> float | None:
    if r.get("started_at") and r.get("finished_at"):
        return round((r["finished_at"] - r["started_at"]).total_seconds(), 1)
    return None


async def timeline(conn, limit: int = 50, site: str | None = None, status: str | None = None,
                   kind: str | None = None) -> dict[str, Any]:
    """Agent runs with their scan runs (and job runs) nested, plus scan runs no agent produced; newest first."""
    await expire_waiting(conn)
    where, params = [], []
    if site:
        where.append("(a.site_slug = %s OR EXISTS (SELECT 1 FROM scan_runs s WHERE s.agent_run_id = a.id "
                     "AND s.site_slug = %s))")
        params += [site, site]
    if status:
        where.append("a.status = %s")
        params.append(status)
    if kind:
        where.append("a.kind = %s")
        params.append(kind)
    sql = "SELECT a.* FROM agent_runs a" + (" WHERE " + " AND ".join(where) if where else "")
    agents = await _all(conn, sql + " ORDER BY a.started_at DESC LIMIT %s", (*params, limit))
    ids = [a["id"] for a in agents]
    children = await _all(conn, "SELECT * FROM scan_runs WHERE agent_run_id = ANY(%s) ORDER BY started_at",
                          (ids,)) if ids else []
    jobs = await _job_runs_for(conn, ids)
    for a in agents:
        a["duration_s"] = _duration(a)
        a["scan_runs"] = [dict(s, duration_s=_duration(s)) for s in children if s["agent_run_id"] == a["id"]]
        a["job_runs"] = [j for j in jobs if j["agent_run_id"] == a["id"]]
    s_where, s_params = ["agent_run_id IS NULL"], []
    if site:
        s_where.append("site_slug = %s")
        s_params.append(site)
    if status:
        s_where.append("status = %s")
        s_params.append(status)
    scans = [] if kind and kind != "scan" else await _all(
        conn, f"SELECT * FROM scan_runs WHERE {' AND '.join(s_where)} ORDER BY started_at DESC LIMIT %s",
        (*s_params, limit))
    for s in scans:
        s["duration_s"] = _duration(s)
    return {"agent_runs": agents, "scan_runs": scans}


async def _job_runs_for(conn, agent_ids: list) -> list[dict]:
    if not agent_ids:
        return []
    exists = await _one(conn, "SELECT to_regclass('job_runs') AS t")
    if not exists or not exists["t"]:
        return []
    return await _all(conn, "SELECT id, job_key, status, counts, agent_run_id, started_at, finished_at "
                            "FROM job_runs WHERE agent_run_id = ANY(%s)", (agent_ids,))
