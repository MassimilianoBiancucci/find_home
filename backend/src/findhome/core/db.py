"""Async Postgres pool for the API (psycopg 3)."""
from __future__ import annotations

from collections.abc import AsyncIterator

from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from findhome.core.settings import get_settings

_pool: AsyncConnectionPool | None = None


async def open_pool(database_url: str | None = None) -> AsyncConnectionPool:
    global _pool
    if _pool is None:
        _pool = AsyncConnectionPool(
            database_url or get_settings().database_url,
            min_size=1, max_size=8, open=False,
            kwargs={"row_factory": dict_row, "autocommit": False},
        )
        await _pool.open(wait=True, timeout=10)
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
