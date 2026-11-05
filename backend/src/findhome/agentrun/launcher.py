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
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote

from findhome.config.loader import ConfigBundle
from findhome.core.db import pool
from findhome.core.paths import repo_root
from findhome.core.settings import get_settings
from findhome.db import runs_repo
from findhome.digest.history import history_digest

log = logging.getLogger(__name__)
_running: dict[str, tuple[str, asyncio.Task]] = {}      # run id → (concurrency key, task)
_needs_close: set[str] = set()                           # runs whose prompt asks the agent to `findhome run close`
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
    fill = {**values, "run_id": run_id, "session_id": session_id, "max_turns": max_turns(profile, values)}
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
    env = {**env, "FINDHOME_RUN_DIR": str(run_dir), "FINDHOME_API": get_settings().api_base,
           "FINDHOME_AGENT_RUN_ID": run_id, "FINDHOME_ROOT": str(repo_root())}
    log_path = run_dir / "log.jsonl"
    status, exit_code, result = "error", None, None
    try:
        proc = await asyncio.create_subprocess_exec(
            *argv, cwd=str(repo_root()), env=env,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT, limit=2 ** 24)
    except FileNotFoundError:
        _append(log_path, "system", f"command not found: {argv[0]} ({INSTALL_HINT})")
        await _finish(run_id, "error", None, None)
        return
    try:
        async with asyncio.timeout(profile.timeout_min * 60):
            assert proc.stdout is not None
            async for line in proc.stdout:
                text = line.decode(errors="replace").rstrip("\n")
                _append(log_path, "out", text)
                result = _result_event(text) or result
            exit_code = await proc.wait()
            status = "ok" if exit_code == 0 and not (result or {}).get("is_error") else "error"
    except TimeoutError:
        proc.kill()
        status = "timeout"
        _append(log_path, "system", f"timeout after {profile.timeout_min} min")
    except asyncio.CancelledError:
        proc.kill()
        status = "cancelled"
        raise
    finally:
        await _finish(run_id, status, exit_code, result)


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
            "permission_denials", "stop_reason", "errors")
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


async def cancel(target: str) -> bool:
    """Cancel by run id, or every running run of a profile (older callers)."""
    hits = [rid for rid, (key, task) in _running.items()
            if not task.done() and (rid == target or key.split(":", 1)[0] == target)]
    for rid in hits:
        _running[rid][1].cancel()
    if not hits:
        try:
            uuid.UUID(target)
        except ValueError:
            return False
        async with pool().connection() as conn:      # a waiting (VS Code) run: nothing to kill, mark it
            row = await (await conn.execute(
                "UPDATE agent_runs SET status = 'cancelled', finished_at = clock_timestamp() "
                "WHERE id = %s AND status = 'waiting' RETURNING id", (target,))).fetchone()
            return row is not None
    return True
