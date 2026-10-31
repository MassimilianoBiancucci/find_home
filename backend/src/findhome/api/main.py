"""FastAPI app. Bind to 127.0.0.1 only (single-user, no auth: see guide/issues)."""
from __future__ import annotations

import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from findhome import __version__
from findhome.api.routers import config as config_router
from findhome.api.routers import digest, ingest, listings, map as map_router, runs, scoring, sites
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    logging.basicConfig(level=get_settings().log_level)
    store = get_store()
    store.reload()
    await db.open_pool()
    loop = asyncio.get_running_loop()
    store.listeners.append(lambda _b: loop.create_task(_sync_sites()))
    await _sync_sites()
    watcher = asyncio.create_task(store.watch())
    try:
        yield
    finally:
        watcher.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await watcher
        await db.close_pool()


app = FastAPI(title="find_home API", version=__version__, lifespan=lifespan,
              description="Local API of the find_home app. The agent writes through the findhome CLI, which calls this API.")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:4400", "http://127.0.0.1:4400"],
                   allow_methods=["*"], allow_headers=["*"])


@app.exception_handler(ConfigError)
async def config_error_handler(_req: Request, exc: ConfigError):
    return JSONResponse(status_code=422, content={"detail": "config invalid", "errors": exc.errors})


@app.exception_handler(repo.NotFound)
async def not_found_handler(_req: Request, exc: repo.NotFound):
    return JSONResponse(status_code=404, content={"detail": f"not found: {exc}"})


@app.get("/health", tags=["health"])
async def health():
    store = get_store()
    db_ok = True
    try:
        async with db.pool().connection() as conn:
            await conn.execute("SELECT 1")
    except Exception:  # noqa: BLE001
        db_ok = False
    body = {"status": "ok" if db_ok and store.bundle else "degraded", "version": __version__, "db": db_ok,
            "config_hash": store.bundle.config_hash if store.bundle else None, "config_errors": store.last_errors}
    return JSONResponse(status_code=200 if db_ok and store.bundle else 503, content=body)


for r in (config_router, listings, ingest, scoring, digest, sites, runs, map_router):
    app.include_router(r.router)
