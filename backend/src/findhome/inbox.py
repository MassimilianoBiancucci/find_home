"""File inbox: the write path for agents that cannot call the API (Claude desktop / Cowork writing into the
connected folder). The backend imports every inbox/*.json on startup and when files appear, then moves each
file to inbox/processed/ (or inbox/failed/ with an .error.txt next to it).

Accepted shapes:
  {"site": "qasa", "parser": "qasa", "source": "agent_browser", "run": "<id>", "page": 1, "docs": [...raw items...]}
  {"listings": [ListingIn, ...], "run": "<id>"}   or a bare list of ListingIn
Every file is recorded in a scan run: files that share a "run" value (the agent run id the app gave the agent, or
any batch id) fill one scan run; a file without it gets its own. After every import it refreshes
runs/state/<site>.json (latest published timestamp, counts) so the next browser scan only extracts newer listings.
"""
from __future__ import annotations

import asyncio
import importlib.util
import json
import logging
import re
import shutil
from datetime import UTC, datetime
from itertools import pairwise
from pathlib import Path
from typing import Any

from findhome.core.paths import inbox_dir, sites_dir, state_dir
from findhome.db import repo, runs_repo
from findhome.domain.models import IngestRequest, ListingIn

log = logging.getLogger(__name__)
_lock: tuple[asyncio.AbstractEventLoop, asyncio.Lock] | None = None


def _import_lock() -> asyncio.Lock:
    """One import at a time per event loop (the API's loop; tests start a new loop per client)."""
    global _lock
    loop = asyncio.get_running_loop()
    if _lock is None or _lock[0] is not loop:
        _lock = (loop, asyncio.Lock())
    return _lock[1]


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


def file_meta(data: Any, items: list[ListingIn]) -> dict[str, Any]:
    """Site, method and run id of an inbox file (for its scan run)."""
    meta = data if isinstance(data, dict) else {}
    site = meta.get("site") or meta.get("parser") or (items[0].source.site_slug if items else None)
    method = meta.get("source") or (items[0].source.method if items else None) or "agent_browser"
    return {"site": site, "method": method, "run": meta.get("run"), "page": meta.get("page")}


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
        data = json.loads(path.read_text(encoding="utf-8"))
        items = to_listings(data)
        meta = file_meta(data, items)
        run_id = None
        if meta["site"]:
            run_id = await runs_repo.batch_scan_run(conn, meta["site"], meta["method"], meta["run"], path.name)
        res = await repo.ingest(conn, IngestRequest(listings=items, scan_run_id=run_id))
        if run_id:
            await runs_repo.add_to_scan_run(conn, run_id, res, seen=len(items))
        await conn.commit()
    except Exception as exc:  # noqa: BLE001 - a bad file must not stop the others
        await conn.rollback()
        _move(path, "failed", f"{exc.__class__.__name__}: {exc}")
        log.warning("inbox: %s failed: %s", path.name, exc)
        return {"file": path.name, "error": str(exc)}
    _move(path, "processed")
    summary = {"file": path.name, "created": res.created, "updated": res.updated, "unchanged": res.unchanged,
               "duplicate": res.duplicate, "scan_run_id": run_id}
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


def move_in_sweep(start, end) -> list[str]:
    """Dates to try in a site's move-in field: move_in_from, then the 1st of every following month up to move_in_to."""
    from datetime import date

    def as_date(v):
        return v if isinstance(v, date) else date.fromisoformat(str(v)) if v else None
    a, b = as_date(start), as_date(end)
    if not a or not b or b < a:
        return []
    out, cur = [a], date(a.year + (a.month == 12), a.month % 12 + 1, 1)
    while cur <= b:
        out.append(cur)
        cur = date(cur.year + (cur.month == 12), cur.month % 12 + 1, 1)
    return [d.isoformat() for d in out]


def browser_inputs(site, bundle) -> dict[str, Any]:
    """The search inputs a browser scan sets on the result page and every combination of values to try, from the
    profile (scan.browser.inputs). The app computes them so the agent never invents a value (e.g. today)."""
    cap = (site.scan or {}).get("browser") or {}
    inputs = cap.get("inputs") or []
    paging = {"next_page": cap["next_page"]} if cap.get("next_page") else {}
    if not inputs:
        return paging
    hf = dict(bundle.profile.kinds[site.kinds[0]].hard_filters) if bundle and site.kinds[0] in bundle.profile.kinds else {}
    sets: list[dict[str, str]] = [{}]
    missing = []
    for inp in inputs:
        if inp.get("filter") == "move_in_from":
            dates = move_in_sweep(hf.get("move_in_from"), hf.get("move_in_to"))
            if not dates:
                missing.append("move_in_from / move_in_to")
            sets = [{**s, inp["label"]: d} for s in sets for d in dates]
    return {"inputs": inputs, "input_sets": [] if missing else sets, "avoid_paths": cap.get("avoid_paths") or [],
            "inputs_missing": missing, **paging}


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
            # active sites, and browser sites waiting for their verification scan (unverified, browser on)
            "scan_urls": scan_urls(site, bundle) if site and (site.status == "active" or (
                site.status == "unverified" and site.browser_scan()[0])) else [],
            **(browser_inputs(site, bundle) if site else {}),
            "updated_at": datetime.now(UTC).isoformat()}, indent=2, ensure_ascii=False, default=str), encoding="utf-8")


async def import_all(pool) -> list[dict[str, Any]]:
    folder = inbox_dir()
    if not folder.exists():
        return []
    async with _import_lock():
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


_STAMPED = re.compile(r"^(?P<site>[a-z0-9-]+)-(?P<ts>\d{8}T\d{6})Z?-p(?P<page>\d+)\.json$")


def _processed_batches(folder: Path, gap_s: int = 600) -> list[tuple[str, list[tuple[datetime, Path]]]]:
    """inbox/processed files named <site>-<UTC yyyymmddThhmmss>-p<N>.json, grouped per site into scans: files less
    than gap_s apart belong to the same scan."""
    found: dict[str, list[tuple[datetime, Path]]] = {}
    for p in sorted(folder.glob("*.json")):
        m = _STAMPED.match(p.name)
        if m:
            ts = datetime.strptime(m["ts"], "%Y%m%dT%H%M%S").replace(tzinfo=UTC)
            found.setdefault(m["site"], []).append((ts, p))
    batches = []
    for site, files in found.items():
        files.sort()
        group = [files[0]]
        for prev, cur in pairwise(files):
            if (cur[0] - prev[0]).total_seconds() > gap_s:
                batches.append((site, group))
                group = []
            group.append(cur)
        batches.append((site, group))
    return batches


async def backfill_runs(conn) -> list[dict[str, Any]]:
    """Record a run for every past browser scan in inbox/processed that has none (imports made before inbox files
    carried a run id). Idempotent: a batch already recorded (batch_id backfill:<first file>) is skipped."""
    from psycopg.types.json import Jsonb

    out = []
    for site, files in _processed_batches(inbox_dir() / "processed"):
        batch = f"backfill:{files[0][1].name}"
        if await (await conn.execute("SELECT 1 FROM scan_runs WHERE batch_id = %s", (batch,))).fetchone():
            continue
        ids: list[str] = []
        method = "agent_browser"
        for _, path in files:
            data = json.loads(path.read_text(encoding="utf-8"))
            items = to_listings(data)
            method = file_meta(data, items)["method"]
            ids += [it.source.external_id for it in items]
        start, end = files[0][0], files[-1][0]
        agent = await (await conn.execute(
            """INSERT INTO agent_runs (profile, command, run_dir, started_by, launcher, kind, site_slug, status,
                                       started_at, finished_at, summary)
               VALUES (%s,'unknown','inbox/processed','cli','manual','scan',%s,'ok',%s,%s,%s) RETURNING id""",
            (f"{site}_browser_scan", site, start, end,
             (f"Backfilled from {len(files)} inbox files ({files[0][1].name} … {files[-1][1].name}); "
              "the agent session itself was not recorded.")))).fetchone()
        run = await (await conn.execute(
            """INSERT INTO scan_runs (site_slug, method, trigger, agent_run_id, batch_id, pages, status, started_at,
                                      finished_at, counts)
               VALUES (%s,%s,'backfill',%s,%s,%s,'ok',%s,%s,%s) RETURNING id""",
            (site, method, agent["id"], batch, len(files), start, end, Jsonb({"seen": len(ids)})))).fetchone()
        linked = await (await conn.execute(
            """UPDATE listing_sources SET scan_run_id = coalesce(scan_run_id, %s),
                                          first_scan_run_id = coalesce(first_scan_run_id, %s)
               WHERE site_slug = %s AND external_id = ANY(%s) AND first_scan_run_id IS NULL
               RETURNING first_seen_at""",
            (run["id"], run["id"], site, ids))).fetchall()
        new = sum(1 for r in linked if start.timestamp() - 60 <= r["first_seen_at"].timestamp() <= end.timestamp() + 600)
        await conn.execute("UPDATE scan_runs SET counts = %s WHERE id = %s",
                           (Jsonb({"seen": len(ids), "new": new, "linked": len(linked)}), run["id"]))
        await conn.execute("UPDATE sites SET last_scan_at = greatest(coalesce(last_scan_at, %s), %s), last_error = NULL "
                           "WHERE slug = %s", (end, end, site))
        out.append({"site": site, "files": len(files), "seen": len(ids), "linked": len(linked), "new": new,
                    "scan_run_id": str(run["id"]), "agent_run_id": str(agent["id"])})
    await conn.commit()
    return out
