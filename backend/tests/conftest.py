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
    """A disposable copy of config/ and sites/. locations.yaml is replaced by the frozen test fixture so
    tests never depend on (or geocode) the user's real points."""
    shutil.copytree(REPO / "config", tmp_path / "config", ignore=shutil.ignore_patterns("*.env"))
    shutil.copy(REPO / "backend" / "tests" / "fixtures" / "locations.yaml", tmp_path / "config" / "locations.yaml")
    if (REPO / "sites").exists():
        shutil.copytree(REPO / "sites", tmp_path / "sites")
    else:
        (tmp_path / "sites").mkdir()
    return tmp_path
