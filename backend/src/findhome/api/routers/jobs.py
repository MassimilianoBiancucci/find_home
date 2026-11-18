"""Jobs: definitions, executions, items; the agent protocol (next / submit) and undo."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from findhome.agentrun import launcher
from findhome.api.state import bundle
from findhome.core.db import get_conn
from findhome.jobs import service
from findhome.jobs.service import JobError

_background: set = set()                 # in-app runs working in the background (kept alive here)
router = APIRouter(prefix="/api", tags=["jobs"])


class SettingsIn(BaseModel):
    settings: dict = Field(default_factory=dict)


class RunIn(BaseModel):
    settings: dict = Field(default_factory=dict, description="Overrides for this execution only")
    launcher: str | None = None


class SubmitIn(BaseModel):
    """A pet check answer (`pet` + `evidence`), or a details job's free-text findings (`fields` + `field_evidence`,
    one quote per field), or `gone` (the ad no longer exists)."""
    short_id: str
    pet: str | None = None
    evidence: str | None = None
    url: str | None = None
    fields: dict | None = None
    field_evidence: dict | None = None
    gone: bool = False


def _err(exc: JobError) -> HTTPException:
    return HTTPException(404 if "unknown job" in str(exc) or "no such" in str(exc) else 409, str(exc))


@router.get("/jobs")
async def jobs(conn=Depends(get_conn)):
    return {"items": await service.list_jobs(conn)}


@router.get("/jobs/{key}")
async def job(key: str, conn=Depends(get_conn)):
    try:
        return await service.get_job(conn, key)
    except JobError as exc:
        raise _err(exc) from exc


@router.patch("/jobs/{key}")
async def job_settings(key: str, body: SettingsIn, conn=Depends(get_conn)):
    try:
        return await service.update_settings(conn, key, body.settings)
    except (JobError, ValueError) as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/jobs/{key}/preview")
async def job_preview(key: str, body: SettingsIn, conn=Depends(get_conn)):
    try:
        return await service.preview(conn, key, bundle().config_hash, body.settings)
    except (JobError, ValueError) as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/jobs/{key}/run")
async def job_run(key: str, body: RunIn, conn=Depends(get_conn)):
    settings = dict(body.settings)
    if body.launcher:
        settings["launcher"] = body.launcher
    try:
        run = await service.create_run(conn, key, bundle().config_hash, settings)
    except (JobError, ValueError) as exc:
        raise _err(exc) if isinstance(exc, JobError) else HTTPException(422, str(exc)) from exc
    if run["kind"] == "inapp" and run["job_key"] == "listing_details_script":
        await conn.commit()                              # the background reader uses its own connections
        from findhome.core.db import pool
        from findhome.jobs.details import run_details_script

        task = asyncio.create_task(run_details_script(pool(), str(run["id"])))
        _background.add(task)
        task.add_done_callback(_background.discard)
        return {"run": run, "note": "reading the pages in the background, 3 s apart"}
    if run["kind"] == "inapp":
        return {"run": await service.run_keywords(conn, run["id"])}
    if not run["counts"].get("queued"):
        return {"run": await service._close_run(conn, run["id"], "ok"), "note": "no listing matches the subset"}
    await conn.commit()                                  # the agent reads the queue through the API
    try:
        agent = await launcher.start(bundle(), run["profile"], service.agent_params(run),
                                     run["settings"].get("launcher") or "cli")
    except launcher.AgentRunError as exc:
        await service._close_run(conn, run["id"], "error", str(exc))
        raise HTTPException(409, str(exc)) from exc
    await service.link_agent_run(conn, run["id"], agent["id"])
    return {"run": {**run, "agent_run_id": agent["id"]}, "agent": agent}


@router.get("/jobs/{key}/runs")
async def job_runs(key: str, limit: int = 50, conn=Depends(get_conn)):
    return {"items": await service.list_runs(conn, key, min(limit, 200))}


@router.get("/job-runs/{run_id}")
async def job_run_detail(run_id: str, outcome: str | None = None, conn=Depends(get_conn)):
    try:
        return await service.run_detail(conn, run_id, outcome)
    except JobError as exc:
        raise _err(exc) from exc


@router.post("/job-runs/{run_id}/cancel")
async def job_run_cancel(run_id: str, conn=Depends(get_conn)):
    run = await service.run_detail(conn, run_id)
    if run.get("agent_run_id"):
        await launcher.cancel(str(run["agent_run_id"]))
    return await service.cancel_run(conn, run_id)


async def _refuse_cancelled(conn, job_run_id: str) -> None:
    from findhome.db import runs_repo

    run = await service.run_detail(conn, job_run_id)
    if why := await runs_repo.run_refuses_writes(conn, run.get("agent_run_id")):
        raise HTTPException(409, why)


@router.post("/job-runs/{run_id}/next")
async def job_next(run_id: str, conn=Depends(get_conn)):
    await _refuse_cancelled(conn, run_id)
    try:
        return {"item": await service.next_item(conn, run_id)}
    except JobError as exc:
        raise _err(exc) from exc


@router.post("/job-runs/{run_id}/submit")
async def job_submit(run_id: str, body: SubmitIn, conn=Depends(get_conn)):
    await _refuse_cancelled(conn, run_id)
    try:
        if body.fields is not None or body.gone:
            from findhome.jobs.details import submit_details

            return await submit_details(conn, run_id, body.short_id, body.fields or {}, body.field_evidence or {},
                                        body.url, gone=body.gone)
        if body.pet is None:
            raise JobError("send pet (+ evidence), or fields (+ field_evidence), or gone")
        return await service.submit(conn, run_id, body.short_id, body.pet, body.evidence, body.url)
    except JobError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/job-items/{item_id}/undo")
async def job_undo(item_id: int, conn=Depends(get_conn)):
    try:
        row = await (await conn.execute(
            "SELECT j.type FROM job_items i JOIN job_runs r ON r.id = i.job_run_id JOIN jobs j ON j.key = r.job_key "
            "WHERE i.id = %s", (item_id,))).fetchone()
        if row and row["type"] in ("listing_details", "listing_details_script"):
            from findhome.jobs.details import undo_details

            return await undo_details(conn, item_id)
        return await service.undo(conn, item_id)
    except JobError as exc:
        raise HTTPException(409, str(exc)) from exc
