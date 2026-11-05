"""The agent ↔ app write path (used by `findhome ingest` and the scanners)."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from findhome.core.db import get_conn
from findhome.db import repo, runs_repo
from findhome.domain.models import EvaluationsRequest, IngestRequest, IngestResult

router = APIRouter(prefix="/api/ingest", tags=["ingest"])


@router.post("/listings", response_model=IngestResult)
async def ingest_listings(body: IngestRequest, conn=Depends(get_conn)):
    if body.scan_run_id or not body.run or not body.listings:
        return await repo.ingest(conn, body)
    # an agent's ingest with a run id: one scan run per site, shared by every call with the same run id
    total = IngestResult()
    by_site: dict[str, list] = {}
    for it in body.listings:
        by_site.setdefault(it.source.site_slug, []).append(it)
    for site, items in by_site.items():
        run_id = await runs_repo.batch_scan_run(conn, site, items[0].source.method, body.run, body.run,
                                                trigger="agent")
        res = await repo.ingest(conn, IngestRequest(listings=items, scan_run_id=run_id))
        await runs_repo.add_to_scan_run(conn, run_id, res, seen=len(items))
        for k in ("created", "updated", "unchanged", "duplicate"):
            setattr(total, k, getattr(total, k) + getattr(res, k))
        total.items += res.items
    return total


@router.post("/evaluations")
async def ingest_evaluations(body: EvaluationsRequest, conn=Depends(get_conn)):
    return {"results": [await repo.add_evaluation(conn, ev) for ev in body.evaluations]}
