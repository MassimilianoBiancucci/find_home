"""Locate the find_home repository root (where config/, sites/ and runs/ live)."""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

_MARKERS = ("config/providers.yaml", "docker-compose.yml")


def _is_root(p: Path) -> bool:
    return all((p / m).exists() for m in _MARKERS)


@lru_cache(maxsize=1)
def repo_root() -> Path:
    """FINDHOME_ROOT env var, else the nearest parent of cwd or of this package that looks like the repo."""
    env = os.environ.get("FINDHOME_ROOT")
    if env:
        return Path(env).resolve()
    for start in (Path.cwd(), Path(__file__).resolve()):
        for p in (start, *start.parents):
            if _is_root(p):
                return p
    raise RuntimeError("find_home root not found: set FINDHOME_ROOT or run inside the repository")


def config_dir() -> Path:
    return repo_root() / "config"


def sites_dir() -> Path:
    return repo_root() / "sites"


def runs_dir() -> Path:
    return repo_root() / "runs"


def data_dir() -> Path:
    return repo_root() / "data"


def inbox_dir() -> Path:
    """Drop folder for agents without shell access to the API (e.g. Claude desktop): JSON files here are
    imported by the running backend. See inbox/README.md."""
    return repo_root() / "inbox"


def state_dir() -> Path:
    """Small state files the backend writes for agents (e.g. last seen listing per site)."""
    return repo_root() / "runs" / "state"
