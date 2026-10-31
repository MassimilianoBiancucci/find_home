"""Listings: list with scores, detail, lifecycle status and feedback."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from findhome.api.state import bundle
from findhome.core.db import get_conn
from findhome.db import repo
from findhome.domain.models import FeedbackIn, StatusChange

router = APIRouter(prefix="/api/listings", tags=["listings"])


@router.get("")
async def list_listings(status: str | None = None, kind: str | None = None, q: str | None = None,
                        include_rejected: bool = True, limit: int = Query(200, le=1000), since: str | None = None,
                        conn=Depends(get_conn)):
    rows = await repo.list_listings(conn, bundle().config_hash, status, kind, q, include_rejected, limit, since)
    return {"config_hash": bundle().config_hash, "items": rows}


@router.get("/exists")
async def exists(site: str, ref: str, conn=Depends(get_conn)):
    row = await repo.source_exists(conn, site, ref)
    return {"exists": row is not None, **(row or {})}


@router.get("/{short_id}")
async def detail(short_id: str, conn=Depends(get_conn)):
    b = bundle()
    L = await repo.get_listing(conn, short_id)
    score = await (await conn.execute("SELECT total, rejected_by, breakdown, computed_at FROM scores "
                                      "WHERE listing_id = %s AND config_hash = %s", (L["id"], b.config_hash))).fetchone()
    return {
        "listing": L, "score": score, "score_stale": score is None,
        "commute": await repo.commute_for(conn, L["id"], b.config_hash),
        "feedback": await repo.feedback_for(conn, L["id"]),
        "evaluations": await repo.evaluations_for(conn, L["id"], 5),
        "sources": await repo.listing_sources(conn, L["id"]),
        "events": await repo.status_events(conn, L["id"]),
    }


@router.post("/{short_id}/status")
async def set_status(short_id: str, body: StatusChange, conn=Depends(get_conn)):
    b = bundle()
    L = await repo.get_listing(conn, short_id)
    allowed = b.tags.statuses_for(L["listing_kind"])
    if body.status not in allowed:
        raise HTTPException(422, f"status must be one of {allowed}")
    return await repo.set_status(conn, short_id, body.status, body.actor, body.note)


@router.post("/{short_id}/feedback")
async def feedback(short_id: str, body: FeedbackIn, conn=Depends(get_conn)):
    known = bundle().tags.all_tags()
    unknown = [t for t in body.tags if t not in known]
    if unknown:
        raise HTTPException(422, f"unknown tags {unknown}; add them to config/tags.yaml")
    return await repo.add_feedback(conn, short_id, body)
