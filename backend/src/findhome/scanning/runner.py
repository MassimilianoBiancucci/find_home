"""Run a scripted scan of one site (or all active sites) and ingest the results.

Order of work: site status/method checks → robots.txt → resolve filters → fetch pages with
the site's politeness delay → parse → (dry run: preview only) → ingest in one transaction
per site → record scan_runs. Token-free: no LLM involved.
"""
from __future__ import annotations

import asyncio
import importlib.util
import logging
import time
from typing import Any
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser

import httpx

from findhome.config.loader import ConfigBundle
from findhome.config.models import SiteConfig
from findhome.core.paths import sites_dir
from findhome.db import repo
from findhome.domain.models import IngestRequest, ListingIn
from findhome.scanning.base import ScanStats
from findhome.scanning.filters import resolve
from findhome.scanning.generic import HttpListScanner

log = logging.getLogger(__name__)


class ScanError(Exception):
    pass


def make_scanner(site: SiteConfig):
    custom = sites_dir() / site.slug / "scanner.py"
    if custom.exists():
        spec = importlib.util.spec_from_file_location(f"findhome_site_{site.slug.replace('-', '_')}", custom)
        module = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)
        return module.make_scanner(site)
    method = site.fetch.get("method")
    if method in ("http", "api"):
        return HttpListScanner(site)
    if method == "playwright":
        raise ScanError(f"{site.slug}: playwright method needs sites/{site.slug}/scanner.py (make_scanner)")
    if method == "agent_browser":
        raise ScanError(f"{site.slug}: agent_browser site — scan it with the agent (prompts/browser_scan.md)")
    raise ScanError(f"{site.slug}: fetch.method not set (site status {site.status}); onboard it first")


async def robots_allows(url: str, user_agent: str) -> bool:
    parts = urlparse(url)
    robots = f"{parts.scheme}://{parts.netloc}/robots.txt"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(robots, headers={"User-Agent": user_agent})
        if resp.status_code >= 400:
            return True
        rp = RobotFileParser()
        rp.parse(resp.text.splitlines())
        return rp.can_fetch(user_agent, url)
    except httpx.HTTPError:
        return True


async def collect(site: SiteConfig, bundle: ConfigBundle, max_pages: int | None = None,
                  scanner=None) -> tuple[list[ListingIn], ScanStats, dict[str, Any]]:
    scanner = scanner or make_scanner(site)
    kind = site.kinds[0]
    filters = resolve(bundle, site, kind)
    pol = site.politeness
    limit = min(max_pages or pol.get("max_pages_per_run", 5), pol.get("max_pages_per_run", 5))
    queries = scanner.build_queries(filters.params, limit)
    stats, items = ScanStats(), []
    ua = pol.get("user_agent") or "findhome/0.1 (personal use)"
    if pol.get("respect_robots", True) and queries and not await robots_allows(queries[0].url, ua):
        raise ScanError(f"{site.slug}: robots.txt disallows {queries[0].url}")
    for i, q in enumerate(queries):
        if i:
            await asyncio.sleep(float(pol.get("min_delay_s", 3)))
        try:
            raws = await scanner.fetch(q)
        except Exception as exc:  # noqa: BLE001
            stats.errors.append(f"page {q.page}: {exc}")
            break
        stats.pages += 1
        stats.items += len(raws)
        if not raws:
            break
        for raw in raws:
            try:
                items.append(scanner.parse(raw))
                stats.parsed += 1
            except Exception as exc:  # noqa: BLE001
                stats.parse_errors += 1
                if len(stats.errors) < 5:
                    stats.errors.append(f"parse: {exc}")
    return items, stats, {"params": filters.params, "local_only": filters.local_only, "unmapped": filters.unmapped}


async def scan_site(conn, bundle: ConfigBundle, slug: str, dry_run: bool = False, max_pages: int | None = None,
                    trigger: str = "api") -> dict[str, Any]:
    site = bundle.sites.get(slug)
    if site is None:
        raise ScanError(f"unknown site '{slug}'")
    if site.status != "active" and not dry_run:
        raise ScanError(f"{slug} is '{site.status}': only active sites are scanned (use --dry-run while onboarding)")
    t0 = time.monotonic()
    run_id = None if dry_run else await repo.create_scan_run(conn, slug, site.fetch.get("method") or "?", trigger, False)
    try:
        items, stats, filt = await collect(site, bundle, max_pages)
    except Exception as exc:
        if run_id:
            await repo.finish_scan_run(conn, run_id, "error", {}, str(exc))
        raise
    summary: dict[str, Any] = {"site": slug, "method": site.fetch.get("method"), "dry_run": dry_run,
                               "pages": stats.pages, "seen": stats.items, "parsed": stats.parsed,
                               "parse_errors": stats.parse_errors, "errors": stats.errors, "filters": filt}
    if dry_run:
        summary["preview"] = [i.model_dump(mode="json", exclude_defaults=True) for i in items[:3]]
    else:
        res = await repo.ingest(conn, IngestRequest(listings=items, scan_run_id=run_id))
        summary.update(new=res.created, changed=res.updated, unchanged=res.unchanged, dup_cross_site=res.duplicate,
                       short_ids_new=[i.short_id for i in res.items if i.outcome == "created"][:50])
        await repo.finish_scan_run(conn, run_id, "error" if stats.errors and not items else "ok",
                                   {k: v for k, v in summary.items() if k not in ("filters", "short_ids_new")},
                                   "; ".join(stats.errors) or None)
    summary["seconds"] = round(time.monotonic() - t0, 1)
    return summary


def summary_line(s: dict[str, Any]) -> str:
    if s.get("dry_run"):
        return (f"{s['site']}: DRY RUN {s['seen']} seen, {s['parsed']} parsed, {s['parse_errors']} parse errors "
                f"(method={s['method']}, {s.get('seconds', 0)}s)")
    return (f"{s['site']}: {s['seen']} seen, {s.get('new', 0)} new, {s.get('changed', 0)} changed, "
            f"{s.get('dup_cross_site', 0)} dup-cross-site, {s.get('unchanged', 0)} unchanged, "
            f"{s['parse_errors']} errors (method={s['method']}, {s.get('seconds', 0)}s)")
