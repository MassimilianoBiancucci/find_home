"""Scan and agent runs; start an external agent and tail its log (SSE)."""
from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from findhome.agentrun import launcher
from findhome.api.state import bundle
from findhome.core.db import get_conn
from findhome.core.paths import repo_root
from findhome.db import repo
from findhome.domain.models import AgentRunRequest

router = APIRouter(prefix="/api", tags=["runs"])


@router.get("/runs")
async def list_runs(conn=Depends(get_conn)):
    return await repo.list_runs(conn)


@router.get("/agent-profiles")
async def profiles():
    return {"items": [{"name": k, "label": p.label, "command": p.command, "prompt_file": p.prompt_file,
                       "timeout_min": p.timeout_min} for k, p in bundle().agent.profiles.items()]}


@router.post("/agent-runs")
async def start(body: AgentRunRequest):
    try:
        return await launcher.start(bundle(), body.profile)
    except launcher.AgentRunError as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post("/agent-runs/{profile}/cancel")
async def cancel(profile: str):
    return {"cancelled": await launcher.cancel(profile)}


@router.patch("/agent-runs/{run_id}")
async def close(run_id: str, body: dict, conn=Depends(get_conn)):
    """Used by `findhome run close`: store the handover summary."""
    await conn.execute("UPDATE agent_runs SET summary = %s, finished_at = coalesce(finished_at, now()), "
                       "status = CASE WHEN status = 'running' THEN 'ok' ELSE status END WHERE id = %s",
                       (body.get("summary", "")[:4000], run_id))
    return {"ok": True}


@router.post("/agent-runs/register")
async def register(body: dict, conn=Depends(get_conn)):
    """Used by `findhome run new`: record a CLI-started run (agent started outside the app)."""
    row = await (await conn.execute(
        "INSERT INTO agent_runs (profile, command, run_dir, started_by) VALUES (%s,%s,%s,'cli') RETURNING id",
        (body["profile"], body.get("command", "manual"), body["run_dir"]))).fetchone()
    return {"id": str(row["id"])}


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
