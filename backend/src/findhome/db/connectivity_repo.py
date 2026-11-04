"""Storage of the Connectivity matrix: zone_commute rows, routing_cache entries and provider failures.

`ConnectivityStore` is what the background job needs; `PgConnectivityStore` implements it on the pool, one short
transaction per call so progress survives a crash or a cancel. Tests use an in-memory store.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Protocol

from psycopg.types.json import Jsonb

PairKey = tuple[str, str, str, str, str]            # zone_id, point_id, direction, day_type, window_label


@dataclass(frozen=True)
class StoredRow:
    status: str                    # ok | estimated | failed
    provider: str
    minutes: float | None
    error: str | None
    fetched_at: datetime | None


@dataclass(frozen=True)
class CacheHit:
    minutes: float | None
    created_at: datetime


@dataclass(frozen=True)
class RowWrite:
    inputs_hash: str
    key: PairKey
    window_weight: float
    provider: str
    minutes: float | None
    status: str
    error: str | None = None
    fetched_at: datetime | None = None


class ConnectivityStore(Protocol):
    async def rows(self, inputs_hash: str) -> dict[PairKey, StoredRow]: ...
    async def failures(self, provider: str) -> dict[str, str]: ...
    async def record_failure(self, provider: str, coord_key: str, code: str, message: str) -> None: ...
    async def clear_failures(self, provider: str) -> int: ...
    async def cache_get(self, key: str) -> CacheHit | None: ...
    async def cache_put(self, key: str, provider: str, minutes: float | None, ttl_days: int) -> datetime: ...
    async def write(self, row: RowWrite) -> None: ...


_ROWS = """SELECT zone_id, point_id, direction, day_type, window_label, status, provider, minutes, error, fetched_at
           FROM zone_commute WHERE inputs_hash = %s"""


def stored_row(r: dict) -> StoredRow:
    return StoredRow(r["status"], r["provider"], None if r["minutes"] is None else float(r["minutes"]), r["error"],
                     r["fetched_at"])


async def read_rows(conn, inputs_hash: str) -> dict[PairKey, StoredRow]:
    rows = await (await conn.execute(_ROWS, (inputs_hash,))).fetchall()
    return {(r["zone_id"], r["point_id"], r["direction"], r["day_type"], r["window_label"]): stored_row(r) for r in rows}


async def cache_ages(conn, keys: list[str]) -> dict[str, datetime]:
    """created_at per routing_cache key (for the cost estimate of a refresh)."""
    if not keys:
        return {}
    rows = await (await conn.execute("SELECT key, created_at FROM routing_cache WHERE key = ANY(%s)", (keys,))).fetchall()
    return {r["key"]: r["created_at"] for r in rows}


async def read_failures(conn, provider: str) -> dict[str, str]:
    rows = await (await conn.execute(
        "SELECT coord_key, error_code FROM provider_failure WHERE provider = %s", (provider,))).fetchall()
    return {r["coord_key"]: r["error_code"] for r in rows}


class PgConnectivityStore:
    def __init__(self, pool):
        self.pool = pool

    async def rows(self, inputs_hash: str) -> dict[PairKey, StoredRow]:
        async with self.pool.connection() as conn:
            return await read_rows(conn, inputs_hash)

    async def failures(self, provider: str) -> dict[str, str]:
        async with self.pool.connection() as conn:
            return await read_failures(conn, provider)

    async def record_failure(self, provider: str, coord_key: str, code: str, message: str) -> None:
        async with self.pool.connection() as conn:
            await conn.execute(
                """INSERT INTO provider_failure (provider, coord_key, error_code, message) VALUES (%s, %s, %s, %s)
                   ON CONFLICT (provider, coord_key) DO UPDATE SET error_code = EXCLUDED.error_code,
                     message = EXCLUDED.message, attempts = provider_failure.attempts + 1, last_seen = now()""",
                (provider, coord_key, code, message))

    async def clear_failures(self, provider: str) -> int:
        async with self.pool.connection() as conn:
            cur = await conn.execute("DELETE FROM provider_failure WHERE provider = %s", (provider,))
            return cur.rowcount

    async def cache_get(self, key: str) -> CacheHit | None:
        async with self.pool.connection() as conn:
            r = await (await conn.execute(
                "SELECT minutes, created_at FROM routing_cache WHERE key = %s", (key,))).fetchone()
        if r is None:
            return None
        return CacheHit(None if r["minutes"] is None else float(r["minutes"]), r["created_at"])

    async def cache_put(self, key: str, provider: str, minutes: float | None, ttl_days: int) -> datetime:
        now = datetime.now(UTC)
        async with self.pool.connection() as conn:
            await conn.execute(
                """INSERT INTO routing_cache (key, provider, minutes, response, created_at, expires_at)
                   VALUES (%s, %s, %s, %s, %s, %s)
                   ON CONFLICT (key) DO UPDATE SET minutes = EXCLUDED.minutes, response = EXCLUDED.response,
                     created_at = EXCLUDED.created_at, expires_at = EXCLUDED.expires_at""",
                (key, provider, minutes, Jsonb({"minutes": minutes, "source": "connectivity"}), now,
                 now + timedelta(days=ttl_days)))
        return now

    async def write(self, row: RowWrite) -> None:
        zid, pid, direction, day, window = row.key
        async with self.pool.connection() as conn:
            await conn.execute(
                """INSERT INTO zone_commute (inputs_hash, zone_id, point_id, direction, day_type, window_label,
                     window_weight, provider, minutes, estimate, status, error, fetched_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (inputs_hash, zone_id, point_id, direction, day_type, window_label) DO UPDATE SET
                     minutes = EXCLUDED.minutes, provider = EXCLUDED.provider, estimate = EXCLUDED.estimate,
                     status = EXCLUDED.status, error = EXCLUDED.error, fetched_at = EXCLUDED.fetched_at,
                     computed_at = now()""",
                (row.inputs_hash, zid, pid, direction, day, window, row.window_weight, row.provider,
                 None if row.minutes is None else round(row.minutes, 1), row.status == "estimated", row.status,
                 row.error, row.fetched_at))
