"""Listings: list with scores, detail, lifecycle status and feedback."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from findhome.api.state import bundle
from findhome.core.db import get_conn
from findhome.db import repo
from findhome.domain import value_scale as vs
from findhome.domain.models import FeedbackIn, PetIn, StatusChange
from findhome.geo.store import load_zones, zone_at

router = APIRouter(prefix="/api/listings", tags=["listings"])


def _with_zone(rows: list[dict]) -> list[dict]:
    """Each listing with the zone its coordinates fall in (zone_id / zone_name; None outside every zone)."""
    zones = load_zones()
    for r in rows:
        z = zone_at(zones, r.get("lat"), r.get("lon"))
        r["zone_id"], r["zone_name"] = (z.id, z.name) if z else (None, None)
    return rows


@router.get("")
async def list_listings(status: str | None = None, kind: str | None = None, q: str | None = None,
                        include_rejected: bool = True, limit: int = Query(200, le=5000), since: str | None = None,
                        origin: str | None = None, site: str | None = None, scan_run: str | None = None,
                        conn=Depends(get_conn)):
    rows = await repo.list_listings(conn, bundle().config_hash, status, kind, q, include_rejected, limit, since,
                                    origin, site, scan_run)
    return {"config_hash": bundle().config_hash, "items": _with_zone(rows)}


@router.get("/scale")
async def scale(kind: str = "rent", conn=Depends(get_conn)):
    """Values of the listings still in the running (scored, not rejected) and your targets, to colour rent, size,
    rooms and rent per m² by percentile and target."""
    b = bundle()
    rows = await repo.list_listings(conn, b.config_hash, None, kind, None, True, 1000, None)
    return vs.value_scale(rows, b.profile.kinds.get(kind))


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
    _with_zone([L])
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


@router.post("/{short_id}/pet")
async def set_pet(short_id: str, body: PetIn, conn=Depends(get_conn)):
    """Your answer on the pet policy: overrides the agent, the site and the keyword rules."""
    L = await repo.get_listing(conn, short_id)
    if body.status == "unknown":       # "I don't know": clear your answer, let the other sources decide again
        await conn.execute("UPDATE listings SET pet_status = 'unknown', pet_evidence = NULL, pet_source = NULL "
                           "WHERE id = %s AND pet_source = 'user'", (L["id"],))
        return {"short_id": short_id, "cleared": True}
    res = await repo.set_pet(conn, L["id"], body.status, body.note or "your answer", "user")
    return {"short_id": short_id, **(res or {})}
