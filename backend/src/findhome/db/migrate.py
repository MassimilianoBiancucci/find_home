"""Plain-SQL migration runner.

Applies backend/migrations/NNN_*.sql in order, each in its own transaction, and records
name + checksum in schema_migrations. An applied file whose checksum changed is an error
(write a new migration instead of editing an old one).
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path

import psycopg

MIGRATIONS_DIR = Path(__file__).resolve().parents[3] / "migrations"


@dataclass
class MigrationStatus:
    applied: list[str]
    pending: list[str]
    changed: list[str]


def _files(directory: Path = MIGRATIONS_DIR) -> list[Path]:
    return sorted(p for p in directory.glob("[0-9][0-9][0-9]_*.sql"))


def _checksum(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _ensure_table(conn: psycopg.Connection) -> None:
    conn.execute(
        """CREATE TABLE IF NOT EXISTS schema_migrations (
               name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())"""
    )
    conn.commit()


def status(database_url: str, directory: Path = MIGRATIONS_DIR) -> MigrationStatus:
    with psycopg.connect(database_url) as conn:
        _ensure_table(conn)
        rows = dict(conn.execute("SELECT name, checksum FROM schema_migrations").fetchall())
    applied, pending, changed = [], [], []
    for f in _files(directory):
        if f.name not in rows:
            pending.append(f.name)
        elif rows[f.name] != _checksum(f):
            changed.append(f.name)
        else:
            applied.append(f.name)
    return MigrationStatus(applied, pending, changed)


def migrate(database_url: str, directory: Path = MIGRATIONS_DIR) -> list[str]:
    st = status(database_url, directory)
    if st.changed:
        raise RuntimeError(f"applied migrations were modified: {', '.join(st.changed)}")
    done: list[str] = []
    with psycopg.connect(database_url) as conn:
        for name in st.pending:
            path = directory / name
            with conn.transaction():
                conn.execute(path.read_text(encoding="utf-8"))
                conn.execute("INSERT INTO schema_migrations (name, checksum) VALUES (%s, %s)", (name, _checksum(path)))
            done.append(name)
    return done
