"""Start an external agent CLI (Claude Code, Codex, ...) as a subprocess.

The app contains no LLM code: it reads a profile from config/agent.yaml, prepares the run
folder (with the history digest), spawns `command args...` WITHOUT a shell, streams
stdout/stderr into log.jsonl and records the run in agent_runs. One concurrent run per profile.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import UTC, datetime
from pathlib import Path

from findhome.config.loader import ConfigBundle
from findhome.core.db import pool
from findhome.core.paths import repo_root
from findhome.core.settings import get_settings
from findhome.digest.history import history_digest

log = logging.getLogger(__name__)
_running: dict[str, asyncio.Task] = {}


class AgentRunError(Exception):
    pass


def build_argv(profile, prompt_text: str) -> list[str]:
    return [profile.command, *[a.replace("{prompt}", prompt_text) for a in profile.args]]


async def start(bundle: ConfigBundle, profile_name: str) -> dict:
    from findhome.agentrun.rundir import new_run_dir

    profile = bundle.agent.profiles.get(profile_name)
    if profile is None:
        raise AgentRunError(f"unknown profile '{profile_name}'")
    task = _running.get(profile_name)
    if task and not task.done():
        raise AgentRunError(f"profile '{profile_name}' is already running")
    prompt_path = repo_root() / profile.prompt_file
    if not prompt_path.exists():
        raise AgentRunError(f"prompt file missing: {profile.prompt_file}")
    run_dir = new_run_dir(profile_name, profile.prompt_file, started_by="app")
    async with pool().connection() as conn:
        (run_dir / "context" / "history_digest.md").write_text(await history_digest(conn, bundle), encoding="utf-8")
        row = await (await conn.execute(
            "INSERT INTO agent_runs (profile, command, run_dir, log_path) VALUES (%s,%s,%s,%s) RETURNING id",
            (profile_name, profile.command, str(run_dir.relative_to(repo_root())),
             str((run_dir / "log.jsonl").relative_to(repo_root()))))).fetchone()
    run_id = str(row["id"])
    argv = build_argv(profile, prompt_path.read_text(encoding="utf-8"))
    _running[profile_name] = asyncio.create_task(_supervise(run_id, profile, argv, run_dir))
    return {"id": run_id, "run_dir": str(run_dir.relative_to(repo_root())), "profile": profile_name}


async def _supervise(run_id: str, profile, argv: list[str], run_dir: Path) -> None:
    env = {k: os.environ[k] for k in profile.env_passthrough if k in os.environ}
    env.update({"FINDHOME_RUN_DIR": str(run_dir), "FINDHOME_API": get_settings().api_base,
                "FINDHOME_AGENT_RUN_ID": run_id, "FINDHOME_ROOT": str(repo_root())})
    log_path = run_dir / "log.jsonl"
    status, exit_code = "error", None
    try:
        proc = await asyncio.create_subprocess_exec(
            *argv, cwd=str(repo_root()), env=env,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
    except FileNotFoundError:
        _append(log_path, "system", f"command not found: {argv[0]} (install and log in to the agent CLI)")
        await _finish(run_id, "error", None)
        return
    try:
        async with asyncio.timeout(profile.timeout_min * 60):
            assert proc.stdout is not None
            async for line in proc.stdout:
                _append(log_path, "out", line.decode(errors="replace").rstrip("\n"))
            exit_code = await proc.wait()
            status = "ok" if exit_code == 0 else "error"
    except TimeoutError:
        proc.kill()
        status = "timeout"
        _append(log_path, "system", f"timeout after {profile.timeout_min} min")
    except asyncio.CancelledError:
        proc.kill()
        status = "cancelled"
        raise
    finally:
        await _finish(run_id, status, exit_code)


def _append(path: Path, stream: str, text: str) -> None:
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps({"t": datetime.now(UTC).isoformat(), "s": stream, "m": text}, ensure_ascii=False) + "\n")


async def _finish(run_id: str, status: str, exit_code: int | None) -> None:
    async with pool().connection() as conn:
        await conn.execute("UPDATE agent_runs SET finished_at = now(), status = %s, exit_code = %s WHERE id = %s",
                           (status, exit_code, run_id))


async def cancel(profile_name: str) -> bool:
    task = _running.get(profile_name)
    if task and not task.done():
        task.cancel()
        return True
    return False
