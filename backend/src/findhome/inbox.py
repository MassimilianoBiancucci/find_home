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


FILE_STAMP = re.compile(r"(\d{8})T\d{4,6}")


def seen_date(name: str) -> str:
    """The day an inbox file's page was read: the UTC stamp in its name (site-20261105T204500-p1.json), else today."""
    m = FILE_STAMP.search(name)
    if m:
        d = m.group(1)
        return f"{d[:4]}-{d[4:6]}-{d[6:]}"
    return datetime.now(UTC).date().isoformat()


def to_listings(data: Any, seen: str | None = None) -> list[ListingIn]:
    """Listings of an inbox file. Raw site docs ('docs' + 'parser') get `_seen`, the day the page was read, so a
    parser can date a card that gives a day without a year."""
    if isinstance(data, dict) and "docs" in data:
        if not data.get("parser"):
            raise ValueError("'docs' needs a 'parser' (site slug)")
        convert = site_parser(data["parser"])
        items = []
        for d in data["docs"]:
            try:
                items.append(convert({**d, "_seen": seen} if seen and isinstance(d, dict) else d))
            except ValueError as exc:      # e.g. an id the browser tool masked and no URL to recover it from
                log.warning("inbox: %s doc skipped: %s", data["parser"], exc)
        if data["docs"] and not items:
            raise ValueError(f"none of the {len(data['docs'])} docs could be converted")
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
    dest.mkdir(parents=True, exist_ok=True)
    target = dest / path.name
    if target.exists():
        target = dest / f"{path.stem}-{datetime.now(UTC):%H%M%S%f}{path.suffix}"
    shutil.move(str(path), target)
    if error:
        target.with_suffix(".error.txt").write_text(error, encoding="utf-8")


async def _late_for(conn, run: str | None) -> str | None:
    """The file belongs to a run that is over for the app: cancelled, or ended more than 15 minutes ago (a late write
    from an agent that lived on). Such files are parked, never imported."""
    if not run:
        return None
    row = await (await conn.execute(
        """SELECT id, status, finished_at < clock_timestamp() - interval '15 minutes' AS long_ago
           FROM agent_runs WHERE id::text = %s""", (str(run),))).fetchone()
    if row and (row["status"] == "cancelled" or (row["status"] not in ("running", "waiting") and row["long_ago"])):
        return str(row["id"])
    return None


async def _page_usage(conn, scan_run_id: str, meta: dict[str, Any], cards: int, res,
                      data: dict[str, Any] | None = None) -> None:
    """One line per imported result page: its cards, new listings and the tokens the agent used since the previous
    page, kept in scan_runs.counts.pages and written to the agent run's log."""
    from findhome.agentrun import usage as u
    from findhome.config.store import get_store

    bundle = get_store().bundle
    mark = await runs_repo.usage_mark(conn, meta.get("run"), dict(bundle.agent.prices) if bundle else {})
    page = str(meta.get("page") or "?")
    data = data or {}
    total = data.get("total_shown") or data.get("totalCount")       # the site's counter for this search
    entry = {"cards": cards, "new": res.created, "updated": res.updated, "duplicates": res.duplicate,
             **({"total": total} if total else {}), **({"last_page": data["last_page"]} if "last_page" in data else {}),
             **({"usage": mark} if mark else {})}
    await conn.execute("""UPDATE scan_runs SET counts = jsonb_set(coalesce(counts, '{}'::jsonb), '{pages}',
                                 coalesce(counts->'pages', '{}'::jsonb) || jsonb_build_object(%s::text, %s::jsonb))
                          WHERE id = %s""", (page, json.dumps(entry), scan_run_id))
    run = await (await conn.execute("SELECT log_path FROM agent_runs WHERE id::text = %s",
                                    (str(meta.get("run") or ""),))).fetchone()
    if run and run["log_path"]:
        from findhome.core.paths import repo_root

        line = f"page {page}: {cards} cards, {res.created} new" + (
            f" · {u.short(mark['tokens'], mark['cost_estimate'])}" if mark else "")
        with (repo_root() / run["log_path"]).open("a", encoding="utf-8") as fh:
            fh.write(json.dumps({"t": datetime.now(UTC).isoformat(), "s": "system", "m": line}, ensure_ascii=False) + "\n")


async def import_data(conn, data: Any, name: str) -> dict[str, Any]:
    """Import one result page (an inbox file's content, or a page posted by extract.js): ingest its listings into the
    scan run of its agent run, mark them open (listed by the site), and record the page's counts. Commits."""
    items = to_listings(data, seen_date(name))
    meta = file_meta(data, items)
    run_id = None
    if meta["site"]:
        run_id = await runs_repo.batch_scan_run(conn, meta["site"], meta["method"], meta["run"], name)
    res = await repo.ingest(conn, IngestRequest(listings=items, scan_run_id=run_id))
    for site in {i.source.site_slug for i in items}:          # listed in search results: the site says open
        await repo.mark_seen_open(conn, site, [i.source.external_id for i in items if i.source.site_slug == site],
                                  {"rule": "in search results", "page": meta.get("page"), "file": name})
    if run_id:
        await runs_repo.add_to_scan_run(conn, run_id, res, seen=len(items))
        await _page_usage(conn, run_id, meta, len(items), res, data if isinstance(data, dict) else {})
    touched = [i.short_id for i in res.items if i.outcome in ("created", "updated")]
    if touched:          # scored now, as a scripted scan does: "passes the hard filters" must be true for the chain
        from findhome.rescore import score_listings

        ids = [r["id"] for r in await (await conn.execute(
            "SELECT id FROM listings WHERE short_id = ANY(%s)", (touched,))).fetchall()]
        try:
            await score_listings(conn, ids)
        except Exception as exc:  # noqa: BLE001 - the page's data is stored; scores can be recomputed
            log.warning("inbox: scoring %s failed: %s", name, exc)
    await conn.commit()
    return {"file": name, "created": res.created, "updated": res.updated, "unchanged": res.unchanged,
            "duplicate": res.duplicate, "scan_run_id": run_id, "cards": len(items), "page": meta.get("page")}


async def import_file(conn, path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        late = await _late_for(conn, data.get("run") if isinstance(data, dict) else None)
        if late:
            await conn.execute("UPDATE agent_runs SET late_files = late_files + 1 WHERE id = %s", (late,))
            await conn.commit()
            _move(path, f"cancelled/{late}")
            log.info("inbox: %s parked: its run %s is over", path.name, late)
            return {"file": path.name, "parked": late}
        summary = await import_data(conn, data, path.name)
    except Exception as exc:  # noqa: BLE001 - a bad file must not stop the others
        await conn.rollback()
        _move(path, "failed", f"{exc.__class__.__name__}: {exc}")
        log.warning("inbox: %s failed: %s", path.name, exc)
        return {"file": path.name, "error": str(exc)}
    _move(path, "processed")
    log.info("inbox: %s", summary)
    return summary


async def import_page_post(conn, site: str, run: str, doc: dict[str, Any]) -> dict[str, Any]:
    """A result page posted by extract.js (POST /api/inbox/raw, kind page): kept in inbox/processed as the record a
    file would leave, imported at once. The answer is the short line the agent needs to page on."""
    if doc.get("translated"):
        return {"translated": True, "stop": "page translated: turn off Chrome translation for Swedish"}
    page = doc.get("page") or 1
    name = f"{site}-{datetime.now(UTC).strftime('%Y%m%dT%H%M%S')}-p{page}.json"
    data = {**doc, "site": site, "parser": site, "source": "agent_browser", "run": run}
    folder = inbox_dir() / "processed"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / name).write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    async with _import_lock():
        res = await import_data(conn, data, name)
    total = doc.get("total_shown") or doc.get("totalCount")
    return {"page": page, "cards": res["cards"], "new": res["created"], "updated": res["updated"],
            "duplicates": res["duplicate"], "total": total, "last_page": doc.get("last_page"), "file": name}


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


def browser_paging(site) -> dict[str, Any]:
    """How a browser scan pages: every result page is a URL of scan_urls, opened in order. `page_size` (cards per full
    page) lets the agent stop after a short page; the app never asks it to type into a search form."""
    pag = (site.fetch or {}).get("pagination") or {}
    return {"page_size": pag.get("page_size")} if pag.get("page_size") else {}


async def write_state(conn, bundle=None) -> None:
    """runs/state/<site>.json for every registered site: newest publishedAt seen (sites that report it),
    counts, and the scan URLs to open in a browser."""
    from findhome.config.store import get_store

    bundle = bundle or get_store().bundle
    totals = {r["site_slug"]: r["total"] for r in await (await conn.execute(
        """SELECT DISTINCT ON (site_slug) site_slug,
                  (SELECT max((p.value->>'total')::int) FROM jsonb_each(counts->'pages') p) AS total
           FROM scan_runs WHERE jsonb_typeof(counts->'pages') = 'object'     -- a scripted scan stores a page count
           ORDER BY site_slug, started_at DESC""")).fetchall()}
    rows = await (await conn.execute(
        """SELECT s.site_slug, count(*) AS n, max(s.last_seen_at) AS last_seen,
                  max(COALESCE(l.attributes->>'publishedOrBumpedAt', l.attributes->>'publishedAt')) AS last_published
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
            **(browser_paging(site) if site else {}),
            "last_total": totals.get(slug),            # the site's counter in the last browser scan
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
