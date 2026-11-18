"""Live sessions and the processes behind a run: parsing `claude agents --json`, the child tree, and signalling only
a process whose command line carries the run's session id."""
from __future__ import annotations

import subprocess
import sys

from findhome.agentrun import sessions

LIST = """[{"pid": 111, "cwd": "/x", "kind": "interactive", "startedAt": 1, "sessionId": "s-1", "name": "chat", "status": "idle"},
 {"pid": 222, "sessionId": "s-2", "name": "findhome-browser_scan-abcd1234", "status": "busy"}, {"name": "no id"}]"""


def test_parse_sessions():
    by_id = sessions.parse_sessions(LIST)
    assert set(by_id) == {"s-1", "s-2"}
    assert (by_id["s-2"].pid, by_id["s-2"].status, by_id["s-2"].name) == (222, "busy", "findhome-browser_scan-abcd1234")


def test_descendants_by_parent_pid():
    table = [(10, 1), (11, 10), (12, 11), (13, 10), (20, 1), (21, 20)]
    assert sorted(sessions.descendants_from(table, 10)) == [11, 12, 13]
    assert sessions.descendants_from(table, 99) == []


async def test_only_a_process_carrying_the_session_id_is_ours_and_stop_tree_ends_it():
    code = "import subprocess, sys, time; subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)']); time.sleep(60)"
    proc = subprocess.Popen([sys.executable, "-c", code, "--session-id", "fictional-session-1"])
    try:
        assert await sessions.is_ours(proc.pid, "fictional-session-1")
        assert not await sessions.is_ours(proc.pid, "another-session")
        import os
        assert not await sessions.is_ours(os.getpid(), "fictional-session-1")       # this test run: not ours
        for _ in range(40):                                                         # wait for its child to start
            if await sessions.descendants(proc.pid):
                break
            import asyncio
            await asyncio.sleep(0.05)
        children = await sessions.descendants(proc.pid)
        assert len(children) == 1
        assert await sessions.stop_tree(proc.pid, grace_s=5) == 2
        proc.wait(timeout=5)
        assert not sessions.pid_alive(children[0]) or _zombie(children[0])
    finally:
        if proc.poll() is None:
            proc.kill()


def _zombie(pid: int) -> bool:
    out = subprocess.run(["ps", "-o", "stat=", "-p", str(pid)], capture_output=True, text=True).stdout.strip()
    return out.startswith("Z") or out == ""
