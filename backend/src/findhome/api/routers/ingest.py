"""The agent ↔ app write path (used by `findhome ingest` and the scanners)."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from findhome.core.db import get_conn
from findhome.db import repo
from findhome.domain.models import EvaluationsRequest, IngestRequest, IngestResult

router = APIRouter(prefix="/api/ingest", tags=["ingest"])


@router.post("/listings", response_model=IngestResult)
async def ingest_listings(body: IngestRequest, conn=Depends(get_conn)):
    return await repo.ingest(conn, body)


@router.post("/evaluations")
async def ingest_evaluations(body: EvaluationsRequest, conn=Depends(get_conn)):
    return {"results": [await repo.add_evaluation(conn, ev) for ev in body.evaluations]}
