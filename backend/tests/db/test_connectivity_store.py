"""PgConnectivityStore against Postgres: rows with status, failures per coordinate, cache with its age."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

import psycopg
import pytest
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from findhome.db.connectivity_repo import PgConnectivityStore, RowWrite, cache_ages, read_rows


@pytest.fixture
async def store(db_url):
    with psycopg.connect(db_url, autocommit=True) as c:
        c.execute("TRUNCATE zone_commute, provider_failure, routing_cache")
    pool = AsyncConnectionPool(db_url, open=False, kwargs={"row_factory": dict_row})
    await pool.open()
    yield PgConnectivityStore(pool)
    await pool.close()


async def test_rows_failures_and_cache_round_trip(store):
    key = ("Z1", "work", "to_point", "weekday", "am")
    fetched = await store.cache_put("resrobot|transit|a|b|weekday|510|arrive_by", "resrobot", 21.0, 30)
    await store.write(RowWrite("h1", key, 1.0, "resrobot", 21.04, "ok", None, fetched))
    await store.write(RowWrite("h1", ("Z2", "work", "to_point", "weekday", "am"), 1.0, "resrobot", None, "failed",
                               "SVC_LOC: no stops nearby"))
    rows = await store.rows("h1")
    assert rows[key].status == "ok" and rows[key].minutes == 21.0 and rows[key].fetched_at == fetched
    assert rows[("Z2", "work", "to_point", "weekday", "am")].status == "failed" and not await store.rows("other")

    await store.write(RowWrite("h1", key, 1.0, "haversine", 30.0, "estimated"))      # upsert keeps one row
    async with store.pool.connection() as conn:
        again = await read_rows(conn, "h1")
        est = await (await conn.execute("SELECT estimate FROM zone_commute WHERE zone_id = 'Z1'")).fetchone()
        ages = await cache_ages(conn, ["resrobot|transit|a|b|weekday|510|arrive_by", "missing"])
    assert again[key].status == "estimated" and est["estimate"] is True
    assert list(ages) == ["resrobot|transit|a|b|weekday|510|arrive_by"]
    assert datetime.now(UTC) - ages["resrobot|transit|a|b|weekday|510|arrive_by"] < timedelta(minutes=1)

    hit = await store.cache_get("resrobot|transit|a|b|weekday|510|arrive_by")
    assert hit.minutes == 21.0 and await store.cache_get("nope") is None

    await store.record_failure("resrobot", "59.1000,18.1000", "SVC_LOC", "no stops")
    await store.record_failure("resrobot", "59.1000,18.1000", "SVC_LOC", "no stops")
    assert await store.failures("resrobot") == {"59.1000,18.1000": "SVC_LOC"} and await store.failures("google") == {}
    async with store.pool.connection() as conn:
        n = await (await conn.execute("SELECT attempts FROM provider_failure")).fetchone()
    assert n["attempts"] == 2
    assert await store.clear_failures("resrobot") == 1 and await store.failures("resrobot") == {}
