"""Scan and agent runs; start an external agent and tail its log (SSE)."""
from __future__ import annotations

import asyncio
import json
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from findhome.agentrun import launcher
from findhome.api.state import bundle
from findhome.core.db import get_conn
from findhome.core.paths import repo_root
from findhome.db import runs_repo
from findhome.domain.models import AgentRunRequest

router = APIRouter(prefix="/api", tags=["runs"])


@router.post("/inbox/import")
async def inbox_import():
    """Import inbox/*.json now (the backend also does it automatically when files appear)."""
    from findhome import inbox
    from findhome.core.db import pool

    return {"results": await inbox.import_all(pool())}


class RawIn(BaseModel):
    """What a browser script posts from a listing site's page (the only request a script may send)."""
    kind: Literal["detail", "page"]
    site: str
    run: str = Field(description="The open agent run the script works for")
    url: str | None = None
    job_run: str | None = None
    doc: dict | None = None


@router.post("/inbox/raw")
async def inbox_raw(body: RawIn, conn=Depends(get_conn)):
    """A page's extracted data, posted by the site's script (detail_extract.js), so it never passes through the
    agent's context. Accepted only for an open agent run, from the site's own origin (api/raw_cors.py)."""
    import uuid as _uuid

    from findhome.jobs.details import raw_detail
    from findhome.jobs.service import JobError

    try:
        _uuid.UUID(body.run)
    except ValueError as exc:
        raise HTTPException(422, "run must be an agent run id") from exc
    run = await runs_repo.get_agent_run(conn, body.run)
    if not run or run["status"] != "running":
        raise HTTPException(409, "no open agent run with this id")
    if body.kind == "page":
        raise HTTPException(422, "page posts are not enabled yet")
    if not body.url or body.doc is None:
        raise HTTPException(422, "a detail post needs url and doc")
    try:
        return await raw_detail(conn, body.site, body.url, body.doc, body.job_run)
    except JobError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.post("/runs/backfill-inbox")
async def backfill_inbox():
    """Record runs for past browser scans in inbox/processed that have none (idempotent)."""
    from findhome import inbox
    from findhome.core.db import pool

    async with pool().connection() as conn:
        return {"results": await inbox.backfill_runs(conn)}


@router.get("/runs")
async def list_runs(limit: int = 50, site: str | None = None, status: str | None = None, kind: str | None = None,
                    conn=Depends(get_conn)):
    """Timeline: agent runs with their scan runs and job runs nested, plus scan runs no agent produced."""
    return await runs_repo.timeline(conn, min(limit, 200), site, status, kind)


@router.get("/runs/scan/{run_id}")
async def scan_run(run_id: str, conn=Depends(get_conn)):
    row = await runs_repo.scan_run_detail(conn, run_id)
    if not row:
        raise HTTPException(404, "no such scan run")
    return row


@router.get("/agent-runs/{run_id}")
async def agent_run(run_id: str, conn=Depends(get_conn)):
    row = await runs_repo.get_agent_run(conn, run_id)
    if not row:
        raise HTTPException(404, "no such agent run")
    return row


@router.get("/agent-profiles")
async def profiles():
    return {"items": [{"name": k, "label": p.label, "kind": p.kind, "command": p.command, "prompt_file": p.prompt_file,
                       "params": p.params, "launchers": p.launchers, "timeout_min": p.timeout_min}
                      for k, p in bundle().agent.profiles.items()]}


@router.post("/agent-runs")
async def start(body: AgentRunRequest):
    try:
        return await launcher.start(bundle(), body.profile, body.params, body.launcher)
    except launcher.AgentRunError as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post("/agent-runs/{target}/cancel")
async def cancel(target: str):
    """Cancel one run (its id) or every open run of a profile (its name). Stops only that run's agent process and its
    children: {status: stopped | not_running | already_finished, killed, note}."""
    try:
        res = await launcher.cancel(target)
    except launcher.AgentRunError as exc:
        raise HTTPException(404, str(exc)) from exc
    return {"cancelled": res["status"] in ("stopped", "not_running"), **res}


@router.post("/agent-runs/{run_id}/reconcile")
async def reconcile(run_id: str, conn=Depends(get_conn)):
    """Check one open run against the live Claude sessions now ("Mark as ended" when its session is gone)."""
    counts = await launcher.reconcile(conn, only=run_id)
    row = await runs_repo.get_agent_run(conn, run_id)
    return {**counts, "status": row["status"] if row else None, "liveness": row.get("liveness") if row else None}


@router.patch("/agent-runs/{run_id}")
async def close(run_id: str, body: dict, conn=Depends(get_conn)):
    """Used by `findhome run close`: store the handover and the agent's outcome (ok | partial | failed)."""
    try:
        await runs_repo.close_agent_run(conn, run_id, body.get("summary", ""), body.get("outcome") or "ok")
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"ok": True}


@router.post("/agent-runs/register")
async def register(body: dict, conn=Depends(get_conn)):
    """Used by `findhome run new`: record a run whose agent was started outside the app."""
    run_id = await runs_repo.create_agent_run(
        conn, profile=body["profile"], command=body.get("command", "manual"), run_dir=body["run_dir"],
        started_by="cli", launcher=body.get("launcher", "manual"), kind=body.get("kind", "other"),
        site_slug=body.get("site"), session_id=body.get("session_id"))
    return {"id": run_id}


@router.post("/agent-runs/{run_id}/attach")
async def attach(run_id: str, body: dict, conn=Depends(get_conn)):
    """Used by `findhome run attach`: the agent of a run the app registered (VS Code launcher) has started."""
    row = await runs_repo.attach_agent_run(conn, run_id, body.get("session_id"))
    if not row:
        raise HTTPException(409, "run not found, or already finished (expired, cancelled or closed)")
    return {"id": str(row["id"]), "run_dir": row["run_dir"], "status": row["status"]}


@router.post("/hooks/session-end")
async def session_end(body: dict, conn=Depends(get_conn)):
    """Claude Code SessionEnd hook (project .claude/settings.local.json). Acts only on sessions that belong to a
    registered run still open; every other session (code work) is ignored."""
    sid = body.get("session_id")
    row = await runs_repo.session_ended(conn, sid, body.get("transcript_path"), body.get("reason")) if sid else None
    return {"closed": str(row["id"]) if row else None}


@router.get("/agent-runs/{run_id}/log")
async def log_stream(run_id: str, conn=Depends(get_conn)):
    row = await (await conn.execute("SELECT log_path, status FROM agent_runs WHERE id = %s", (run_id,))).fetchone()
    if not row or not row["log_path"]:
        raise HTTPException(404, "no log for this run")
    path = repo_root() / row["log_path"]

    async def events():
        pos, idle = 0, 0
        while idle < 600:
            if path.exists():
                with path.open(encoding="utf-8") as fh:
                    fh.seek(pos)
                    chunk = fh.read()
                    pos = fh.tell()
                if chunk:
                    idle = 0
                    for line in chunk.splitlines():
                        yield f"data: {line}\n\n"
                    continue
            idle += 1
            yield ": keep-alive\n\n" if idle % 15 == 0 else ""
            await asyncio.sleep(1)
        yield f"data: {json.dumps({'s': 'system', 'm': 'stream closed'})}\n\n"

    return StreamingResponse(events(), media_type="text/event-stream")
