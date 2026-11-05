"""FastAPI app. Bind to 127.0.0.1 only (single-user, no auth: see guide/issues)."""
from __future__ import annotations

import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from psycopg import OperationalError
from psycopg_pool import PoolTimeout

from findhome import __version__, inbox
from findhome.api.routers import config as config_router
from findhome.api.routers import digest, ingest, listings, map as map_router, runs, scoring, sites
from findhome.api.routers import geocode as geocode_router
from findhome.api.routers import geo as geo_router
from findhome.api.routers import probe as probe_router
from findhome.api.routers import connectivity as connectivity_router
from findhome.api.routers import zone as zone_router
from findhome.api.routers import house as house_router
from findhome.config.loader import ConfigError
from findhome.config.store import get_store
from findhome.core import db
from findhome.core.settings import get_settings
from findhome.db import repo

log = logging.getLogger("findhome")


async def _sync_sites() -> None:
    store = get_store()
    if store.bundle is None:
        return
    async with db.pool().connection() as conn:
        await repo.sync_sites(conn, store.bundle.sites, store.bundle.site_hashes)
        await conn.commit()
        await inbox.write_state(conn, store.bundle)     # scan URLs follow profile/site changes


async def _sync_sites_safe() -> None:
    try:
        await _sync_sites()
    except Exception as exc:  # noqa: BLE001 - DB may be down at startup; /api/sites re-reads config anyway
        log.warning("site registry not synced to the database yet: %s", exc.__class__.__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logging.basicConfig(level=get_settings().log_level)
    store = get_store()
    store.reload()
    settings = get_settings()
    await db.open_pool()
    db_error = await db.probe()
    log.info("find_home API · http://%s:%s · db %s %s · config %s", settings.api_host, settings.api_port,
             db.redacted(settings.database_url), "OK" if not db_error else f"UNREACHABLE ({db_error})",
             store.bundle.config_hash if store.bundle else f"INVALID ({len(store.last_errors)} errors)")
    if db_error:
        log.warning("database unreachable: start it with 'docker compose up -d --wait' (the API keeps retrying)")
    loop = asyncio.get_running_loop()
    store.listeners.append(lambda _b: loop.create_task(_sync_sites_safe()))
    await _sync_sites_safe()
    watcher = asyncio.create_task(store.watch())
    inbox_watcher = asyncio.create_task(inbox.watch(db.pool()))
    try:
        yield
    finally:
        for task in (watcher, inbox_watcher):
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        await db.close_pool()


app = FastAPI(title="find_home API", version=__version__, lifespan=lifespan,
              description="Local API of the find_home app. The agent writes through the findhome CLI, which calls this API.")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:4400", "http://127.0.0.1:4400"],
                   allow_methods=["*"], allow_headers=["*"])


@app.exception_handler(ConfigError)
async def config_error_handler(_req: Request, exc: ConfigError):
    return JSONResponse(status_code=422, content={"detail": "config invalid", "errors": exc.errors})


@app.exception_handler(PoolTimeout)
@app.exception_handler(OperationalError)
async def db_down_handler(_req: Request, exc: Exception):
    detail = await db.probe() or exc.__class__.__name__
    return JSONResponse(status_code=503, content={
        "detail": f"database unreachable ({detail}). Start it: docker compose up -d --wait"})


@app.exception_handler(repo.NotFound)
async def not_found_handler(_req: Request, exc: repo.NotFound):
    return JSONResponse(status_code=404, content={"detail": f"not found: {exc}"})


@app.get("/health", tags=["health"])
async def health():
    store = get_store()
    db_error = None
    try:
        async with db.pool().connection(timeout=3) as conn:
            await conn.execute("SELECT 1")
    except Exception:  # noqa: BLE001
        db_error = await db.probe() or "connection pool timeout"
    db_ok = db_error is None
    body = {"status": "ok" if db_ok and store.bundle else "degraded", "version": __version__, "db": db_ok,
            "db_error": db_error, "config_hash": store.bundle.config_hash if store.bundle else None,
            "config_errors": store.last_errors}
    return JSONResponse(status_code=200 if db_ok and store.bundle else 503, content=body)


for r in (config_router, listings, ingest, scoring, digest, sites, runs, map_router, geocode_router, geo_router,
          probe_router, connectivity_router, zone_router, house_router):
    app.include_router(r.router)
