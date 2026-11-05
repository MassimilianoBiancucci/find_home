"""Site registry status, logos and scripted scans."""
from __future__ import annotations

from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, RedirectResponse

from findhome.api.state import bundle
from findhome.core.db import get_conn
from findhome.core.paths import sites_dir
from findhome.db import repo
from findhome.domain.models import ScanRequest
from findhome.scanning.runner import ScanError, scan_site, scriptable, summary_line

router = APIRouter(prefix="/api", tags=["sites & scans"])
LOGO_TYPES = {".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".ico": "image/x-icon"}


def _logo_file(slug: str, name: str | None):
    folder = sites_dir() / slug
    candidates = [name] if name else []
    candidates += [f"logo{ext}" for ext in LOGO_TYPES]
    for c in candidates:
        p = (folder / c).resolve()
        if c and p.parent == folder.resolve() and p.is_file() and p.suffix in LOGO_TYPES:
            return p
    return None


@router.get("/sites")
async def list_sites(conn=Depends(get_conn)):
    b = bundle()
    rows = {r["slug"]: r for r in await repo.list_sites(conn)}
    counts = {r["slug"]: r for r in await repo.site_listing_counts(conn)}
    out = []
    for slug, s in sorted(b.sites.items()):
        r, c = rows.get(slug, {}), counts.get(slug, {})
        script_ok, script_why = s.script_scan()
        browser_ok, browser_why = s.browser_scan()
        default_pages, max_pages = s.browser_pages()
        out.append({"slug": slug, "name": s.name, "url": s.url, "kinds": s.kinds, "status": s.status, "role": s.role,
                    "method": s.fetch.get("method"), "auth": s.auth.get("mode"), "notes": s.notes,
                    "brand": s.brand, "logo_url": f"/api/sites/{slug}/logo", "risk_note": s.risk_note,
                    "last_verified": s.last_verified,
                    "scan": {"script": {"enabled": script_ok, "reason": script_why},
                             "browser": {"enabled": browser_ok, "reason": browser_why,
                                         "default_pages": default_pages, "max_pages": max_pages}},
                    "platforms": s.platforms,
                    "known_listings": c.get("found", 0), "origin_listings": c.get("origin", 0),
                    "last_scan_at": r.get("last_scan_at"), "last_error": r.get("last_error"),
                    "last_counts": r.get("last_counts"), "last_scan_status": r.get("last_status"),
                    "last_scan_id": r.get("last_run_id")})
    return {"items": out}


@router.get("/sites/{slug}/logo")
async def site_logo(slug: str):
    site = bundle().sites.get(slug)
    if site is None:
        raise HTTPException(404, "unknown site")
    path = _logo_file(slug, (site.brand or {}).get("logo"))
    if path:
        return FileResponse(path, media_type=LOGO_TYPES[path.suffix], headers={"Cache-Control": "max-age=3600"})
    fav = (site.brand or {}).get("favicon") or f"https://{urlparse(site.url).netloc}/favicon.ico"
    return RedirectResponse(fav)


@router.post("/scans")
async def scan(body: ScanRequest, conn=Depends(get_conn)):
    b = bundle()
    slugs = scriptable(b) if body.site in ("all", "--all") else [body.site]
    results = []
    for slug in slugs:
        try:
            s = await scan_site(conn, b, slug, body.dry_run, body.max_pages, trigger=body.trigger)
            results.append({**s, "line": summary_line(s)})
        except ScanError as exc:
            if body.site not in ("all", "--all"):
                raise HTTPException(422, str(exc)) from exc
            results.append({"site": slug, "error": str(exc), "line": f"{slug}: skipped: {exc}"})
    return {"results": results}
