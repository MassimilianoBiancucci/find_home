"""Postgres-backed tests. Skipped when FINDHOME_TEST_DATABASE_URL is unreachable.

Each test session recreates the test database and applies the migrations; each test gets a
truncated database and a temporary copy of config/ and sites/ (osm routing disabled so
nothing goes to the network: commute falls back to haversine estimates).
"""
from __future__ import annotations

import json
import os
import shutil
from pathlib import Path

import psycopg
import pytest

TEST_URL = os.environ.get("FINDHOME_TEST_DATABASE_URL", "postgresql://postgres:postgres@localhost:5434/findhome_test")
REPO = Path(__file__).resolve().parents[3]
TABLES = ("listings", "listing_sources", "listing_status_events", "feedback", "evaluations", "scores",
          "commute_results", "routing_cache", "geocode_cache", "poi_cache", "scan_runs", "agent_runs", "sites")


@pytest.fixture(scope="session")
def db_url():
    base, name = TEST_URL.rsplit("/", 1)
    try:
        admin = psycopg.connect(f"{base}/postgres", autocommit=True, connect_timeout=3)
    except psycopg.OperationalError as exc:
        pytest.skip(f"Postgres not reachable for tests ({exc.__class__.__name__}): set FINDHOME_TEST_DATABASE_URL")
    with admin:
        admin.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
        admin.execute(f'CREATE DATABASE "{name}"')
    from findhome.db.migrate import migrate

    assert migrate(TEST_URL), "no migrations applied"
    return TEST_URL


@pytest.fixture
def test_repo(tmp_path: Path) -> Path:
    shutil.copytree(REPO / "config", tmp_path / "config", ignore=shutil.ignore_patterns("*.env"))
    shutil.copytree(REPO / "sites", tmp_path / "sites")
    from findhome.config.writer import apply_ops

    apply_ops("providers", [{"op": "replace", "path": "/routing/osm/enabled", "value": False}],
              tmp_path / "config", tmp_path / "sites")
    apply_ops("agent", [{"op": "add", "path": "/profiles/test_echo", "value": {
        "label": "test", "command": "python3", "args": ["-c", "import sys; print('prompt chars', len(sys.argv[1]))",
                                                         "{prompt}"],
        "prompt_file": "README.md", "timeout_min": 1, "env_passthrough": ["PATH"]}}],
        tmp_path / "config", tmp_path / "sites")
    return tmp_path


@pytest.fixture
def client(db_url, test_repo, monkeypatch):
    from fastapi.testclient import TestClient

    import findhome.config.store as store_mod
    from findhome.core import db as db_mod
    from findhome.core.settings import get_settings

    monkeypatch.setenv("FINDHOME_DATABASE_URL", db_url)
    get_settings.cache_clear()
    db_mod._pool = None
    store_mod._store = store_mod.ConfigStore(test_repo / "config", test_repo / "sites")
    with psycopg.connect(db_url, autocommit=True) as conn:
        conn.execute(f"TRUNCATE {', '.join(TABLES)} CASCADE")
    from findhome.api.main import app

    with TestClient(app) as c:
        yield c
    store_mod._store = None
    get_settings.cache_clear()


@pytest.fixture
def sample_listings() -> list[dict]:
    return json.loads((REPO / "backend" / "tests" / "fixtures" / "listings_sample.json").read_text())
