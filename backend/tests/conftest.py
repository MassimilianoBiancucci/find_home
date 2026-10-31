from __future__ import annotations

import os
import shutil
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
os.environ.setdefault("FINDHOME_ROOT", str(REPO))


@pytest.fixture
def repo_root() -> Path:
    return REPO


@pytest.fixture
def tmp_repo(tmp_path: Path) -> Path:
    """A disposable copy of config/ and sites/ for tests that write files."""
    shutil.copytree(REPO / "config", tmp_path / "config", ignore=shutil.ignore_patterns("*.env"))
    if (REPO / "sites").exists():
        shutil.copytree(REPO / "sites", tmp_path / "sites")
    else:
        (tmp_path / "sites").mkdir()
    return tmp_path
