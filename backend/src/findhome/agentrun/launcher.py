"""Start an external agent (Claude Code, Codex, ...) for a run the app registers first.

The app contains no LLM code. A profile in config/agent.yaml names the command, its args, the prompt and the
parameters the app may pass (site, pages, job run ...). Two launchers:

- cli:    the app spawns `command args...` WITHOUT a shell, streams stdout into runs/<id>/log.jsonl and reads the
          final stream-json `result` event (cost, turns, errors). Environment limited to env_passthrough plus
          FINDHOME_RUN_DIR, FINDHOME_API, FINDHOME_AGENT_RUN_ID, FINDHOME_ROOT.
- vscode: no process. The run waits ("waiting") and the app returns a vscode://anthropic.claude-code/open link
          with the prompt prefilled; the agent attaches with `findhome run attach <id>` when you press Enter.

The run row exists before the agent starts, so a run is recorded whatever the agent does. One run at a time per
(profile, site or job).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote

from findhome.agentrun import sessions
from findhome.agentrun import usage as usage_mod
from findhome.config.loader import ConfigBundle
from findhome.core.db import pool
from findhome.core.paths import repo_root
from findhome.core.settings import get_settings
from findhome.db import runs_repo
from findhome.digest.history import history_digest

log = logging.getLogger(__name__)
_running: dict[str, tuple[str, asyncio.Task]] = {}      # run id → (concurrency key, task)
_needs_close: set[str] = set()                           # runs whose prompt asks the agent to `findhome run close`
_cancelled: set[str] = set()                             # runs Cancel stopped: their follower finishes them as cancelled
_cancelling: set[str] = set()                            # runs Cancel is stopping right now: the watchdog skips them
VSCODE_OPEN = "vscode://anthropic.claude-code/open?prompt="
INSTALL_HINT = ("install Claude Code (curl -fsSL https://claude.ai/install.sh | bash), log in with /login, "
                "or set FINDHOME_CLAUDE_BIN to the claude binary")


class AgentRunError(Exception):
    pass


# ── parameters and argv ─────────────────────────────────────
def resolve_params(bundle: ConfigBundle, profile, given: dict[str, Any] | None) -> dict[str, Any]:
    """Validate the parameters of a launch against the profile; returns them with defaults filled."""
    given = dict(given or {})
    unknown = set(given) - set(profile.params)
    if unknown:
        raise AgentRunError(f"unknown parameter(s) {sorted(unknown)} for this profile")
    out: dict[str, Any] = {}
    site = None
    for name, spec in profile.params.items():          # sites first, so int limits can read them
        if spec.get("type") != "site":
            continue
        value = given.get(name, spec.get("default"))
        if value is None:
            if spec.get("required"):
                raise AgentRunError(f"parameter '{name}' (site) is required")
            continue
        site = bundle.sites.get(str(value))
        if site is None:
            raise AgentRunError(f"unknown site '{value}'")
        if spec.get("site_needs") == "browser":
            ok, why = site.browser_scan()
            if not ok:
                raise AgentRunError(f"{value}: {why}")
        if spec.get("site_needs") == "not_origin" and site.role == "origin":
            raise AgentRunError(f"{value}: origin-only site")
        out[name] = site.slug
    for name, spec in profile.params.items():
        kind = spec.get("type")
        if kind == "site":
            continue
        value = given.get(name, spec.get("default"))
        lo, hi = spec.get("min"), spec.get("max")
        if spec.get("from_site") == "browser_pages" and site is not None:
            default, hi = site.browser_pages()
            value = given.get(name, default)
        if value is None:
            if spec.get("required"):
                raise AgentRunError(f"parameter '{name}' is required")
            continue
        if kind == "int":
            try:
                value = int(value)
            except (TypeError, ValueError) as exc:
                raise AgentRunError(f"parameter '{name}' must be an integer") from exc
            if (lo is not None and value < lo) or (hi is not None and value > hi):
                raise AgentRunError(f"parameter '{name}' must be between {lo or 1} and {hi}")
        elif kind == "choice":
            value = str(value)
            if value not in (spec.get("choices") or []):
                raise AgentRunError(f"parameter '{name}' must be one of {spec.get('choices')}")
        elif kind == "job_run":
            try:
                value = str(uuid.UUID(str(value)))
            except ValueError as exc:
                raise AgentRunError(f"parameter '{name}' must be a job run id") from exc
        else:
            value = str(value)
            if any(c in value for c in "{}\n\r"):
                raise AgentRunError(f"parameter '{name}' contains characters that are not allowed")
        out[name] = value
    return out


def _fill(text: str, values: dict[str, Any]) -> str:
    for k, v in values.items():
        text = text.replace("{" + k + "}", str(v))
    return text


def prompt_text(profile, values: dict[str, Any]) -> str:
    text = profile.prompt if profile.prompt else (repo_root() / profile.prompt_file).read_text(encoding="utf-8")
    return _fill(text, values)


def max_turns(profile, params: dict[str, Any]) -> int | None:
    if profile.max_turns is None:
        return None
    per = profile.turns_per or {}
    extra = int(params.get(per.get("param"), 0) or 0) * int(per.get("turns", 0)) if per else 0
    return profile.max_turns + extra


def build_argv(profile, prompt: str, values: dict[str, Any] | None = None) -> list[str]:
    """argv with {prompt}, {session_id}, {max_turns}, {allowed_tools}, {run_id} and every parameter substituted.
    An arg that is exactly a placeholder with no value is dropped together with the flag before it."""
    values = {**(values or {}), "prompt": prompt, "allowed_tools": ",".join(profile.allowed_tools)}
    argv: list[str] = [profile.command]
    for a in profile.args:
        if a.startswith("{") and a.endswith("}") and values.get(a[1:-1]) in (None, ""):
            if len(argv) > 1 and argv[-1].startswith("--"):
                argv.pop()
            continue
        argv.append(prompt if a == "{prompt}" else _fill(a, {k: v for k, v in values.items() if k != "prompt"}))
    return argv


def resolve_command(command: str, env: dict[str, str]) -> str:
    if command == "claude" and os.environ.get("FINDHOME_CLAUDE_BIN"):
        path = os.environ["FINDHOME_CLAUDE_BIN"]
        if Path(path).is_file():
            return path
        raise AgentRunError(f"FINDHOME_CLAUDE_BIN={path} does not exist")
    found = shutil.which(command, path=env.get("PATH"))
    if not found:
        raise AgentRunError(f"command not found: {command}" + (f" ({INSTALL_HINT})" if command == "claude" else ""))
    return found


def vscode_link(prompt: str) -> str:
    return VSCODE_OPEN + quote(prompt, safe="")


# ── start / supervise ───────────────────────────────────────
async def start(bundle: ConfigBundle, profile_name: str, params: dict[str, Any] | None = None,
                launcher: str = "cli") -> dict:
    from findhome.agentrun.rundir import new_run_dir

    profile = bundle.agent.profiles.get(profile_name)
    if profile is None:
        raise AgentRunError(f"unknown profile '{profile_name}'")
    if launcher not in profile.launchers:
        raise AgentRunError(f"profile '{profile_name}' has no '{launcher}' launcher (has {profile.launchers})")
    if profile.prompt_file and not profile.prompt and not (repo_root() / profile.prompt_file).exists():
        raise AgentRunError(f"prompt file missing: {profile.prompt_file}")
    values = resolve_params(bundle, profile, params)
    key = f"{profile_name}:{values.get('site') or values.get('job_run') or ''}"
    if any(k == key and not t.done() for k, t in _running.values()):
        raise AgentRunError(f"'{profile_name}' is already running" + (f" for {key.split(':', 1)[1]}" if ':' in key
                                                                       and key.split(':', 1)[1] else ""))
    env = {k: os.environ[k] for k in profile.env_passthrough if k in os.environ}
    command = resolve_command(profile.command, env) if launcher == "cli" else profile.command
    run_dir = new_run_dir(profile_name, profile.prompt_file or "", started_by="app")
    session_id = str(uuid.uuid4())
    rel = str(run_dir.relative_to(repo_root()))
    async with pool().connection() as conn:
        (run_dir / "context" / "history_digest.md").write_text(await history_digest(conn, bundle), encoding="utf-8")
        run_id = await runs_repo.create_agent_run(
            conn, profile=profile_name, command=profile.command, run_dir=rel,
            log_path=str((run_dir / "log.jsonl").relative_to(repo_root())) if launcher == "cli" else None,
            launcher=launcher, kind=profile.kind, site_slug=values.get("site"), params=values,
            session_id=session_id if launcher == "cli" else None,
            status="running" if launcher == "cli" else "waiting")
        await conn.commit()
    (run_dir / ".run_id").write_text(run_id)
    fill = {**values, "run_id": run_id, "session_id": session_id, "max_turns": max_turns(profile, values),
            "profile": profile_name, "run_short": run_id[:8]}
    prompt = prompt_text(profile, fill)
    out = {"id": run_id, "run_dir": rel, "profile": profile_name, "launcher": launcher, "params": values}
    if launcher == "vscode":
        return {**out, "status": "waiting", "prompt": prompt, "open_url": vscode_link(prompt)}
    argv = build_argv(profile, prompt, fill)
    argv[0] = command
    _running[run_id] = (key, asyncio.create_task(_supervise(run_id, profile, argv, run_dir, env)))
    # a prompt that carries {run_id} tells the agent to close its run; exiting without it is not "ok"
    if "{run_id}" in (profile.prompt or ""):
        _needs_close.add(run_id)
    return {**out, "status": "running", "session_id": session_id}


async def _supervise(run_id: str, profile, argv: list[str], run_dir: Path, env: dict[str, str]) -> None:
    """Spawn the agent with its output going to runs/<id>/stream.jsonl through a file handle (no pipe: a backend
    reload neither kills the agent through a broken pipe nor cuts its output), then follow that file."""
    env = {**env, "FINDHOME_RUN_DIR": str(run_dir), "FINDHOME_API": get_settings().api_base,
           "FINDHOME_AGENT_RUN_ID": run_id, "FINDHOME_ROOT": str(repo_root())}
    log_path = run_dir / "log.jsonl"
    try:
        with (run_dir / "stream.jsonl").open("ab") as out:
            proc = await asyncio.create_subprocess_exec(*argv, cwd=str(repo_root()), env=env, stdout=out,
                                                        stderr=asyncio.subprocess.STDOUT)
    except FileNotFoundError:
        _append(log_path, "system", f"command not found: {argv[0]} ({INSTALL_HINT})")
        await _finish(run_id, "error", None, None)
        return
    name = argv[argv.index("-n") + 1] if "-n" in argv[:-1] else None
    async with pool().connection() as conn:
        await runs_repo.set_process(conn, run_id, proc.pid, name)
        await conn.commit()
    await _follow(run_id, run_dir, profile.timeout_min, proc=proc, pid=proc.pid, started=time.monotonic())


def _read_new(stream: Path, offset: int) -> tuple[list[str], int]:
    """Complete lines appended to the stream since `offset` (a partial last line waits for the next read)."""
    if not stream.exists():
        return [], offset
    with stream.open("rb") as fh:
        fh.seek(offset)
        data = fh.read()
    end = data.rfind(b"\n")
    if end < 0:
        return [], offset
    return data[:end].decode(errors="replace").split("\n"), offset + end + 1


async def _follow(run_id: str, run_dir: Path, timeout_min: float, proc=None, pid: int | None = None,
                  started: float | None = None) -> None:
    """Copy the agent's stream into log.jsonl (the format the run drawer reads), keep its final `result` event, and
    finish the run when the process ends or times out. `proc` is our own child; an adopted run (found again after a
    backend reload) has only its `pid`. A backend shutdown stops this task, never the agent."""
    stream, log_path, offset_file = run_dir / "stream.jsonl", run_dir / "log.jsonl", run_dir / ".stream_offset"
    offset = int(offset_file.read_text()) if offset_file.exists() else 0
    usage = usage_mod.Usage.from_stream(stream, until=offset) if offset else usage_mod.Usage()   # adopted: recount
    result: dict | None = None
    deadline = (started or time.monotonic()) + timeout_min * 60
    status, exit_code = "error", None
    while True:
        lines, offset = _read_new(stream, offset)
        for line in lines:
            _append(log_path, "out", line)
            result = _result_event(line) or result
            usage.add_line(line)
        offset_file.write_text(str(offset))
        if usage.by_model and usage.due(5):         # live totals, every 5 s at most
            await _save_usage(run_id, usage.totals(), None)
        if proc is not None:
            try:
                exit_code = await asyncio.wait_for(asyncio.shield(proc.wait()), 0.5)
                break
            except TimeoutError:
                pass
        elif not sessions.pid_alive(pid):
            break
        else:
            await asyncio.sleep(0.5)
        if run_id in _cancelled:
            break
        if time.monotonic() > deadline:
            if pid and pid in await _our_pids(run_id, pid):
                await sessions.stop_tree(pid)
            _append(log_path, "system", f"timeout after {timeout_min} min")
            status = "timeout"
            break
    lines, offset = _read_new(stream, offset)
    for line in lines:
        _append(log_path, "out", line)
        result = _result_event(line) or result
        usage.add_line(line)
    offset_file.write_text(str(offset))
    await _save_usage(run_id, usage.totals(), result)
    if status != "timeout":
        clean = (exit_code == 0) if proc is not None else bool(result)
        status = "ok" if clean and not (result or {}).get("is_error") else "error"
    if run_id in _cancelled:
        status = "cancelled"
        _cancelled.discard(run_id)
    await _finish(run_id, status, exit_code, result)


def _prices() -> dict:
    from findhome.config.store import get_store

    bundle = get_store().bundle
    return dict(bundle.agent.prices) if bundle else {}


async def _save_usage(run_id: str, live: dict, result: dict | None) -> None:
    """The result event's exact per-model usage and cost when there is one, else the live totals and an estimate."""
    if result and result.get("modelUsage"):
        totals, cost = usage_mod.from_model_usage(result["modelUsage"])
        exact = True
    else:
        totals, cost, exact = live, usage_mod.estimate_cost(live, _prices()), False
    if not totals:
        return
    async with pool().connection() as conn:
        await runs_repo.set_usage(conn, run_id, totals, cost, estimated=not exact)
        await conn.commit()


async def _our_pids(run_id: str, pid: int) -> list[int]:
    async with pool().connection() as conn:
        row = await runs_repo.get_agent_run(conn, run_id) or {}
    return [pid] if await sessions.is_ours(pid, row.get("session_id")) else []


def _result_event(line: str) -> dict | None:
    """The final stream-json event of a Claude Code run: cost, turns, session, errors, permission denials."""
    if not line.startswith("{") or '"result"' not in line:
        return None
    try:
        ev = json.loads(line)
    except json.JSONDecodeError:
        return None
    if ev.get("type") != "result":
        return None
    keep = ("subtype", "is_error", "num_turns", "total_cost_usd", "duration_ms", "session_id", "result",
            "permission_denials", "stop_reason", "errors", "modelUsage")
    return {k: ev[k] for k in keep if k in ev}


def _append(path: Path, stream: str, text: str) -> None:
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps({"t": datetime.now(UTC).isoformat(), "s": stream, "m": text}, ensure_ascii=False) + "\n")


async def _finish(run_id: str, status: str, exit_code: int | None, result: dict | None) -> None:
    async with pool().connection() as conn:
        row = await runs_repo.get_agent_run(conn, run_id) or {}
        status = runs_repo.status_for(status, row.get("outcome"), run_id in _needs_close, bool(row.get("summary")))
        _needs_close.discard(run_id)
        await runs_repo.finish_agent_run(conn, run_id, status, exit_code, result)


async def cancel_run(run_id: str) -> dict[str, Any]:
    """Stop exactly this run: its agent process and that process's children, after checking that the process's command
    line carries the run's session id. Chrome, your own chats and other runs are never signalled. The run is marked
    cancelled whatever its process does; late inbox files are parked and CLI writes refused."""
    async with pool().connection() as conn:
        row = await runs_repo.get_agent_run(conn, run_id)
        if row is None:
            raise AgentRunError("unknown run")
        if row["status"] not in ("running", "waiting"):
            return {"status": "already_finished", "killed": 0, "note": f"the run already ended ({row['status']})"}
        _cancelling.add(run_id)            # the watchdog leaves this run alone until it is marked
        try:
            live = await sessions.live_sessions()
            s = live.get(row.get("session_id"))
            pid = (s.pid if s else None) or row.get("pid")
            killed, note = 0, None
            if pid and await sessions.is_ours(pid, row.get("session_id")):
                _cancelled.add(run_id)
                killed = await sessions.stop_tree(pid)
                outcome = "stopped"
            elif s is not None:            # a session we cannot match safely (a VS Code chat): leave it, say so
                outcome, note = "not_running", "the agent runs in a VS Code chat: stop it there"
            else:
                outcome, note = "not_running", "no live agent process for this run"
            await runs_repo.mark_cancelled(conn, run_id, note or f"stopped {killed} process(es)")
            await conn.commit()
        finally:
            _cancelling.discard(run_id)
    return {"status": outcome, "killed": killed, "note": note}


async def cancel(target: str) -> dict[str, Any]:
    """Cancel by run id, or every open run of a profile (older callers)."""
    try:
        uuid.UUID(target)
    except ValueError:
        async with pool().connection() as conn:
            ids = [str(r["id"]) for r in await runs_repo.open_agent_runs(conn) if r["profile"] == target]
        results = [await cancel_run(i) for i in ids]
        return {"status": "stopped" if any(r["status"] == "stopped" for r in results) else "not_running",
                "killed": sum(r["killed"] for r in results), "runs": len(results), "note": None}
    return await cancel_run(target)


def _timeout_min(profile_name: str) -> float:
    from findhome.config.store import get_store

    bundle = get_store().bundle
    profile = bundle.agent.profiles.get(profile_name) if bundle else None
    return float(profile.timeout_min) if profile else 60.0


async def reconcile(conn, only: str | None = None) -> dict[str, int]:
    """The watchdog (at startup, every 60 s, and on demand): match open runs with the live Claude sessions.

    - The session is listed: record busy / idle; a CLI run nobody follows (after a backend reload) is adopted again.
    - Not listed, but our process still runs: liveness `unknown`; kept, adopted, and stopped at its timeout.
    - Not listed and no process of ours: `ended_no_handover` with the reason (and the stream's cost, if any).
    - The list cannot be read and there is no pid (a VS Code chat): kept until its timeout plus 10 minutes."""
    live = await sessions.live_sessions()
    counts = {"alive": 0, "adopted": 0, "ended": 0, "kept": 0}
    for row in await runs_repo.open_agent_runs(conn):
        run_id = str(row["id"])
        if (only and run_id != only) or run_id in _cancelling:
            continue                                    # Cancel is stopping it and marks it itself
        if run_id in _running and not _running[run_id][1].done():
            counts["kept"] += 1                         # our follower is on it and finishes the run itself
            s = live.get(row.get("session_id"))
            if s is not None:
                await runs_repo.set_liveness(conn, run_id, "alive_busy" if s.status == "busy" else "alive_idle")
            continue
        s = live.get(row.get("session_id"))
        pid = (s.pid if s else None) or row.get("pid")
        timeout = _timeout_min(row["profile"])
        elapsed = (datetime.now(UTC) - row["started_at"]).total_seconds()
        if s is not None:
            await runs_repo.set_liveness(conn, run_id, "alive_busy" if s.status == "busy" else "alive_idle")
            counts["alive"] += 1
        elif pid and await sessions.is_ours(pid, row.get("session_id")):
            await runs_repo.set_liveness(conn, run_id, "unknown")
            counts["kept"] += 1
        elif not live.ok and not pid and elapsed < (timeout + 10) * 60:
            await runs_repo.set_liveness(conn, run_id, "unknown")
            counts["kept"] += 1
            continue
        else:
            reason = ("session ended without run close" if live.ok or pid
                      else "no session list and past the timeout")
            res = _stream_result(row)
            await runs_repo.end_without_handover(conn, run_id, reason, res)
            if res and res.get("modelUsage"):          # what it used: exact when the stream has a result event
                totals, cost = usage_mod.from_model_usage(res["modelUsage"])
                await runs_repo.set_usage(conn, run_id, totals, cost, False)
            elif row.get("run_dir"):                   # else the live totals and an estimated cost
                live = usage_mod.Usage.from_stream(repo_root() / row["run_dir"] / "stream.jsonl").totals()
                if live:
                    await runs_repo.set_usage(conn, run_id, live, usage_mod.estimate_cost(live, _prices()), True)
            counts["ended"] += 1
            continue
        if row.get("launcher") == "cli" and pid and row.get("run_dir"):
            task = asyncio.create_task(_follow(run_id, repo_root() / row["run_dir"], timeout, pid=pid,
                                               started=time.monotonic() - elapsed))
            _running[run_id] = (f"{row['profile']}:{row.get('site_slug') or ''}", task)
            counts["adopted"] += 1
    from findhome.jobs.service import finalize_agent_runs

    await finalize_agent_runs(conn)
    return counts


def _stream_result(row: dict) -> dict | None:
    """The final `result` event in a run's stream file, if the agent got that far."""
    if not row.get("run_dir"):
        return None
    stream = repo_root() / row["run_dir"] / "stream.jsonl"
    if not stream.exists():
        return None
    result = None
    with stream.open(encoding="utf-8", errors="replace") as fh:
        for line in fh:
            result = _result_event(line.rstrip("\n")) or result
    return result


async def watchdog(interval_s: float = 60) -> None:
    """Reconcile at startup, then every `interval_s`; one failure never stops the loop. FINDHOME_RUN_WATCHDOG=off
    turns it off (the Postgres-backed tests reconcile on demand instead)."""
    if os.environ.get("FINDHOME_RUN_WATCHDOG") == "off":
        return
    while True:
        try:
            async with pool().connection() as conn:
                await reconcile(conn)
                await conn.commit()
        except Exception as exc:  # noqa: BLE001 - the database may be down; try again next time
            log.info("run watchdog: %s", exc)
        await asyncio.sleep(interval_s)
