"""Site registry status and scripted scans."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from findhome.api.state import bundle
from findhome.core.db import get_conn
from findhome.db import repo
from findhome.domain.models import ScanRequest
from findhome.scanning.runner import ScanError, scan_site, summary_line

router = APIRouter(prefix="/api", tags=["sites & scans"])


@router.get("/sites")
async def list_sites(conn=Depends(get_conn)):
    b = bundle()
    rows = {r["slug"]: r for r in await repo.list_sites(conn)}
    out = []
    for slug, s in sorted(b.sites.items()):
        r = rows.get(slug, {})
        out.append({"slug": slug, "name": s.name, "url": s.url, "kinds": s.kinds, "status": s.status,
                    "method": s.fetch.get("method"), "auth": s.auth.get("mode"), "notes": s.notes,
                    "last_scan_at": r.get("last_scan_at"), "last_error": r.get("last_error"),
                    "last_counts": r.get("last_counts")})
    return {"items": out}


@router.post("/scans")
async def scan(body: ScanRequest, conn=Depends(get_conn)):
    b = bundle()
    slugs = [s for s, cfg in b.sites.items() if cfg.status == "active"] if body.site in ("all", "--all") else [body.site]
    results = []
    for slug in slugs:
        try:
            s = await scan_site(conn, b, slug, body.dry_run, body.max_pages)
            results.append({**s, "line": summary_line(s)})
        except ScanError as exc:
            if body.site not in ("all", "--all"):
                raise HTTPException(422, str(exc)) from exc
            results.append({"site": slug, "error": str(exc), "line": f"{slug}: skipped: {exc}"})
    return {"results": results}
