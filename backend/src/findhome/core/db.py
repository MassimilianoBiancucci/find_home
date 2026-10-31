"""Async Postgres pool for the API (psycopg 3).

The pool opens WITHOUT waiting: the API starts even when Postgres is down, keeps retrying in
the background, and every request that needs the database fails fast with a clear 503
(see api/main.py) instead of the whole process exiting at startup.
"""
from __future__ import annotations

import re
from collections.abc import AsyncIterator

from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from findhome.core.settings import get_settings

_pool: AsyncConnectionPool | None = None
REQUEST_TIMEOUT_S = 5


def redacted(url: str) -> str:
    return re.sub(r"://([^:/@]+):[^@]*@", r"://\1:***@", url)


async def open_pool(database_url: str | None = None) -> AsyncConnectionPool:
    global _pool
    if _pool is None:
        _pool = AsyncConnectionPool(
            database_url or get_settings().database_url,
            min_size=1, max_size=8, open=False, timeout=REQUEST_TIMEOUT_S, reconnect_timeout=60 * 60 * 24,
            kwargs={"row_factory": dict_row, "autocommit": False, "connect_timeout": 5},
        )
        await _pool.open(wait=False)
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def pool() -> AsyncConnectionPool:
    if _pool is None:
        raise RuntimeError("database pool not opened")
    return _pool


async def get_conn() -> AsyncIterator:
    """FastAPI dependency: one connection per request, committed on success."""
    async with pool().connection() as conn:
        yield conn


async def probe(database_url: str | None = None) -> str | None:
    """Try a direct connection; return None when OK, else the error text (for /health and logs)."""
    import psycopg

    try:
        conn = await psycopg.AsyncConnection.connect(database_url or get_settings().database_url, connect_timeout=3)
        await conn.close()
        return None
    except Exception as exc:  # noqa: BLE001
        return f"{exc.__class__.__name__}: {str(exc).strip().splitlines()[0] if str(exc).strip() else ''}"
