"""Which agent sessions are alive, and the processes behind them.

`claude agents --json` lists every live Claude Code session on this machine, `claude -p` runs included:
[{"pid", "sessionId", "name", "status": "busy" | "idle", "kind", "cwd", "startedAt"}]. The app starts each run with its
own --session-id, so a run is found by that id. A process is only ever signalled after its command line shows the
run's session id (`is_ours`), so a reused pid or another session (your own chats, Chrome) is never touched.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import signal
from dataclasses import dataclass

log = logging.getLogger(__name__)


@dataclass
class Session:
    session_id: str
    pid: int | None
    name: str | None
    status: str | None                  # busy | idle


@dataclass
class Sessions:
    ok: bool                            # False: the list could not be read (no claude, old CLI, timeout)
    by_id: dict[str, Session]

    def get(self, session_id: str | None) -> Session | None:
        return self.by_id.get(session_id or "")


def parse_sessions(text: str) -> dict[str, Session]:
    out = {}
    for s in json.loads(text or "[]"):
        if isinstance(s, dict) and s.get("sessionId"):
            pid = s.get("pid")
            out[s["sessionId"]] = Session(s["sessionId"], int(pid) if isinstance(pid, int) else None, s.get("name"),
                                          s.get("status"))
    return out


async def _run(*argv: str, timeout: float = 5) -> str | None:
    try:
        proc = await asyncio.create_subprocess_exec(*argv, stdout=asyncio.subprocess.PIPE,
                                                    stderr=asyncio.subprocess.DEVNULL)
        out, _ = await asyncio.wait_for(proc.communicate(), timeout)
    except (OSError, TimeoutError):
        return None
    return out.decode(errors="replace") if proc.returncode == 0 else None


async def live_sessions() -> Sessions:
    claude = os.environ.get("FINDHOME_CLAUDE_BIN") or shutil.which("claude")
    if not claude:
        return Sessions(False, {})
    text = await _run(claude, "agents", "--json")
    if text is None:
        return Sessions(False, {})
    try:
        return Sessions(True, parse_sessions(text))
    except (ValueError, TypeError) as exc:
        log.info("claude agents --json not understood: %s", exc)
        return Sessions(False, {})


def pid_alive(pid: int | None) -> bool:
    if not pid:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


async def command_line(pid: int) -> str | None:
    text = await _run("ps", "-o", "command=", "-p", str(pid))
    return text.strip() if text else None


async def is_ours(pid: int | None, session_id: str | None) -> bool:
    """The pid runs the agent of this run: its command line carries `--session-id <session_id>` (or `--resume`)."""
    if not pid or not session_id or not pid_alive(pid):
        return False
    cmd = await command_line(pid)
    return bool(cmd and session_id in cmd)


def descendants_from(table: list[tuple[int, int]], root: int) -> list[int]:
    """Every process below `root` in a (pid, ppid) table, children first found breadth-first."""
    kids: dict[int, list[int]] = {}
    for pid, ppid in table:
        kids.setdefault(ppid, []).append(pid)
    out, todo = [], [root]
    while todo:
        for child in kids.get(todo.pop(), []):
            if child not in out:
                out.append(child)
                todo.append(child)
    return out


async def descendants(pid: int) -> list[int]:
    """The agent's child commands. Claude runs each Bash command in its own process group, so the tree is found by
    parent pid, not by group."""
    text = await _run("ps", "-A", "-o", "pid=,ppid=")
    table = []
    for line in (text or "").splitlines():
        parts = line.split()
        if len(parts) == 2 and parts[0].isdigit() and parts[1].isdigit():
            table.append((int(parts[0]), int(parts[1])))
    return descendants_from(table, pid)


async def stop_tree(pid: int, grace_s: float = 10) -> int:
    """SIGTERM the agent and its children, wait up to `grace_s`, SIGKILL what is left. Returns how many were stopped."""
    targets = [pid, *await descendants(pid)]
    for p in targets:
        try:
            os.kill(p, signal.SIGTERM)
        except (ProcessLookupError, PermissionError):
            pass
    for _ in range(int(grace_s * 4)):
        if not any(pid_alive(p) for p in targets):
            break
        await asyncio.sleep(0.25)
    for p in targets:
        if pid_alive(p):
            try:
                os.kill(p, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass
    return len(targets)
