"""File inbox: the write path for agents that cannot call the API (Claude desktop / Cowork writing into the
connected folder). The backend imports every inbox/*.json on startup and when files appear, then moves each
file to inbox/processed/ (or inbox/failed/ with an .error.txt next to it).

Accepted shapes:
  {"site": "qasa", "parser": "qasa", "source": "agent_browser", "docs": [...raw site items...]}
  {"listings": [ListingIn, ...]}            or a bare list of ListingIn
After every import it refreshes runs/state/<site>.json (latest published timestamp, counts) so the next
browser scan only extracts newer listings.
"""
from __future__ import annotations

import asyncio
import importlib.util
import json
import logging
import shutil
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from findhome.core.paths import inbox_dir, sites_dir, state_dir
from findhome.db import repo
from findhome.domain.models import IngestRequest, ListingIn

log = logging.getLogger(__name__)
_lock = asyncio.Lock()


def site_parser(slug: str):
    path = sites_dir() / slug / "scanner.py"
    spec = importlib.util.spec_from_file_location(f"findhome_site_{slug.replace('-', '_')}_inbox", path)
    if spec is None or not path.exists():
        raise ValueError(f"no parser: {path} not found")
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    if not hasattr(mod, "to_listing"):
        raise ValueError(f"{path} has no to_listing()")
    return mod.to_listing


def to_listings(data: Any) -> list[ListingIn]:
    if isinstance(data, dict) and "docs" in data:
        if not data.get("parser"):
            raise ValueError("'docs' needs a 'parser' (site slug)")
        convert = site_parser(data["parser"])
        items = [convert(d) for d in data["docs"]]
        if data.get("source"):
            for it in items:
                it.source.method = data["source"]
        return items
    raw = data.get("listings") if isinstance(data, dict) else data
    if not isinstance(raw, list):
        raise ValueError("expected {'docs': [...], 'parser': ...}, {'listings': [...]} or a list")
    return [ListingIn.model_validate(x) for x in raw]


def _move(path: Path, folder: str, error: str | None = None) -> None:
    dest = path.parent / folder
    dest.mkdir(exist_ok=True)
    target = dest / path.name
    if target.exists():
        target = dest / f"{path.stem}-{datetime.now(UTC):%H%M%S%f}{path.suffix}"
    shutil.move(str(path), target)
    if error:
        target.with_suffix(".error.txt").write_text(error, encoding="utf-8")


async def import_file(conn, path: Path) -> dict[str, Any]:
    try:
        items = to_listings(json.loads(path.read_text(encoding="utf-8")))
        res = await repo.ingest(conn, IngestRequest(listings=items))
        await conn.commit()
    except Exception as exc:  # noqa: BLE001 - a bad file must not stop the others
        await conn.rollback()
        _move(path, "failed", f"{exc.__class__.__name__}: {exc}")
        log.warning("inbox: %s failed: %s", path.name, exc)
        return {"file": path.name, "error": str(exc)}
    _move(path, "processed")
    summary = {"file": path.name, "created": res.created, "updated": res.updated, "unchanged": res.unchanged,
               "duplicate": res.duplicate}
    log.info("inbox: %s", summary)
    return summary


def scan_urls(site, bundle, pages: int | None = None) -> list[str]:
    """Result-page URLs for a site, built exactly like the scripted scanner builds them (profile filters
    through the site's filter_map), so browser agents never assemble URLs themselves."""
    from findhome.scanning.filters import resolve
    from findhome.scanning.generic import HttpListScanner

    if not (site.fetch or {}).get("list_url_template"):
        return []
    limit = pages or int(site.politeness.get("max_pages_per_run", 5))
    params = resolve(bundle, site, site.kinds[0]).params
    return [q.url for q in HttpListScanner(site, save_raw=False).build_queries(params, limit)]


async def write_state(conn, bundle=None) -> None:
    """runs/state/<site>.json for every registered site: newest publishedAt seen (sites that report it),
    counts, and the scan URLs to open in a browser."""
    from findhome.config.store import get_store

    bundle = bundle or get_store().bundle
    rows = await (await conn.execute(
        """SELECT s.site_slug, count(*) AS n, max(s.last_seen_at) AS last_seen,
                  max(l.attributes->>'publishedAt') AS last_published
           FROM listing_sources s JOIN listings l ON l.id = s.listing_id GROUP BY s.site_slug""")).fetchall()
    by_site = {r["site_slug"]: r for r in rows}
    slugs = set(by_site) | set(bundle.sites if bundle else [])
    state_dir().mkdir(parents=True, exist_ok=True)
    for slug in sorted(slugs):
        r = by_site.get(slug, {})
        site = bundle.sites.get(slug) if bundle else None
        (state_dir() / f"{slug}.json").write_text(json.dumps({
            "site": slug, "status": site.status if site else None,
            "method": site.fetch.get("method") if site else None,
            "known_listings": r.get("n", 0), "last_published": r.get("last_published"),
            "last_seen": r["last_seen"].isoformat() if r.get("last_seen") else None,
            "scan_urls": scan_urls(site, bundle) if site and site.status == "active" else [],
            "updated_at": datetime.now(UTC).isoformat()}, indent=2, ensure_ascii=False), encoding="utf-8")


async def import_all(pool) -> list[dict[str, Any]]:
    folder = inbox_dir()
    if not folder.exists():
        return []
    async with _lock:
        results = []
        async with pool.connection() as conn:
            for path in sorted(folder.glob("*.json")):
                results.append(await import_file(conn, path))
            await write_state(conn)
        return results


async def watch(pool) -> None:
    from watchfiles import Change, awatch

    folder = inbox_dir()
    folder.mkdir(exist_ok=True)
    try:
        await import_all(pool)
    except Exception:  # noqa: BLE001 - DB may be down at startup
        log.warning("inbox: initial import skipped (database not ready)")
    async for changes in awatch(folder, recursive=False):
        if any(c == Change.added and p.endswith(".json") for c, p in changes):
            await asyncio.sleep(1)          # let the writer finish the file
            try:
                await import_all(pool)
            except Exception:  # noqa: BLE001
                log.exception("inbox: import failed")
