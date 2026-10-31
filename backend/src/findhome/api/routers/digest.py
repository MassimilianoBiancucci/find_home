"""Token-lean text digests for agents (and the UI copy button)."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import PlainTextResponse

from findhome.api.state import bundle
from findhome.core.db import get_conn
from findhome.digest.history import history_digest
from findhome.digest.listing import listing_digest

router = APIRouter(prefix="/api/digest", tags=["digest"])


@router.get("/history", response_class=PlainTextResponse)
async def history(since: str | None = None, conn=Depends(get_conn)):
    return await history_digest(conn, bundle(), since)


@router.get("/listing/{short_id}", response_class=PlainTextResponse)
async def listing(short_id: str, full: bool = False, conn=Depends(get_conn)):
    return await listing_digest(conn, bundle(), short_id, full)
