"""Run folder convention shared by `findhome run new` and the app's "Run agent" button.

runs/<UTC timestamp>-<profile>/
  run.yaml                     manifest
  scratchpad.md                agent working notes (template below)
  context/history_digest.md    written before the agent starts
  log.jsonl                    app-started runs only
"""
from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from ruamel.yaml import YAML

from findhome.core.paths import runs_dir

SCRATCHPAD = """# Scratchpad · {run_id}

Profile: {profile} · prompt: {prompt_file} · started {started} UTC

## Goal
<!-- one or two lines: what this run must achieve, from the prompt header -->

## Context loaded
- [ ] context/history_digest.md
<!-- other files read; keep the list short -->

## Sites planned
<!-- slug · method · why -->

## Findings
<!-- short_ids with one line each; raw page text never goes here -->

## Decisions
<!-- status changes, config proposals (proposed_config.patch.yaml), skipped items and why -->

## Handover
<!-- 3-6 lines for the user and the next run: what changed, what needs a human -->
"""


def new_run_dir(profile: str, prompt_file: str = "", started_by: str = "cli") -> Path:
    now = datetime.now(UTC)
    run_id = f"{now:%Y%m%dT%H%M%SZ}-{profile}"
    path = runs_dir() / run_id
    (path / "context").mkdir(parents=True, exist_ok=False)
    YAML().dump({"run_id": run_id, "profile": profile, "prompt_file": prompt_file, "started_by": started_by,
                 "started_at": now.isoformat()}, path / "run.yaml")
    (path / "scratchpad.md").write_text(SCRATCHPAD.format(run_id=run_id, profile=profile, prompt_file=prompt_file or "-",
                                                          started=f"{now:%Y-%m-%d %H:%M}"), encoding="utf-8")
    return path
