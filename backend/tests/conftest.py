from __future__ import annotations

import os
from pathlib import Path

import pytest
from repo_copy import build_test_repo

REPO = Path(__file__).resolve().parents[2]
os.environ.setdefault("FINDHOME_ROOT", str(REPO))


@pytest.fixture
def repo_root() -> Path:
    return REPO


@pytest.fixture
def tmp_repo(tmp_path: Path) -> Path:
    """A disposable copy of config/ and sites/ built from the committed examples (see repo_copy.py)."""
    return build_test_repo(tmp_path)


@pytest.fixture(scope="session")
def shared_repo(tmp_path_factory) -> Path:
    """Same as tmp_repo, built once per session, for read-only tests."""
    return build_test_repo(tmp_path_factory.mktemp("shared_repo"))
