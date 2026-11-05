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
from findhome.domain.normalize import content_hash
from findhome.scanning.base import ScanStats
from findhome.scanning.filters import resolve
from findhome.scanning.generic import HttpListScanner

log = logging.getLogger(__name__)


class ScanError(Exception):
    pass


def make_scanner(site: SiteConfig):
    """The scripted scanner of a site. The site's capability check comes first, so a site whose scripted access is
    refused or disabled (e.g. Qasa: 429) is never fetched by script, even when it keeps a scanner.py."""
    allowed, why = site.script_scan()
    if not allowed:
        raise ScanError(f"{site.slug}: {why}")
    custom = sites_dir() / site.slug / "scanner.py"
    if custom.exists():
        spec = importlib.util.spec_from_file_location(f"findhome_site_{site.slug.replace('-', '_')}", custom)
        module = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)
        if hasattr(module, "make_scanner"):
            return module.make_scanner(site)
    if site.fetch.get("method") in ("http", "api"):
        return HttpListScanner(site)
    raise ScanError(f"{site.slug}: playwright method needs sites/{site.slug}/scanner.py (make_scanner)")


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


async def enrich_new(conn, site: SiteConfig, scanner, items: list[ListingIn], limit: int | None = None) -> int:
    """Detail-page enrichment for listings not seen before (scanner.enrich), capped and polite."""
    cfg = site.fetch.get("details") or {}
    if not cfg.get("enabled") or not hasattr(scanner, "enrich"):
        return 0
    cap = int(cfg.get("max_per_run", 10)) if limit is None else limit
    done = 0
    for i, item in enumerate(items):
        if done >= cap:
            break
        if await repo.source_exists(conn, site.slug, item.source.external_id):
            continue
        if done:
            await asyncio.sleep(float(site.politeness.get("min_delay_s", 3)))
        try:
            item.attributes["_list_hash"] = content_hash(item)
            items[i] = await scanner.enrich(item)
            done += 1
        except Exception as exc:  # noqa: BLE001 - enrichment is best effort
            log.warning("%s: enrich %s failed: %s", site.slug, item.source.external_id, exc)
    return done


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
            status = getattr(getattr(exc, "response", None), "status_code", None)
            hint = " (the site refuses scripted requests: use fetch.method agent_browser)" if status in (403, 429) else ""
            stats.errors.append(f"page {q.page}: {exc.__class__.__name__} {status or ''}{hint}".strip())
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
    items, outside = _within_search_area(site, bundle, items)
    filtered = {**getattr(scanner, "filtered", {}), **({"outside search area": outside} if outside else {})}
    return items, stats, {"params": filters.params, "local_only": filters.local_only, "unmapped": filters.unmapped,
                          "filtered": filtered}


def _within_search_area(site: SiteConfig, bundle: ConfigBundle, items: list[ListingIn]) -> tuple[list[ListingIn], int]:
    """local_filter.search_area_buffer_m: drop listings whose coordinates lie farther than that from the search
    area (sites whose feed covers a whole region). Listings without coordinates are kept; the score decides."""
    buffer_m = (site.local_filter or {}).get("search_area_buffer_m")
    if buffer_m is None:
        return items, 0
    from findhome.geo.area import area_eval, compiled_for

    area = compiled_for(bundle.raw.get("search_area"))
    if not area.defined:
        return items, 0
    keep = [i for i in items if i.lat is None or i.lon is None
            or area_eval(area, i.lat, i.lon).distance_m <= float(buffer_m)]
    return keep, len(items) - len(keep)


def scriptable(bundle: ConfigBundle) -> list[str]:
    """Active sites a scripted scan may fetch ("scan all")."""
    return [s for s, cfg in bundle.sites.items() if cfg.status == "active" and cfg.script_scan()[0]]


async def scan_site(conn, bundle: ConfigBundle, slug: str, dry_run: bool = False, max_pages: int | None = None,
                    trigger: str = "app") -> dict[str, Any]:
    site = bundle.sites.get(slug)
    if site is None:
        raise ScanError(f"unknown site '{slug}'")
    if site.status != "active" and not dry_run:
        raise ScanError(f"{slug} is '{site.status}': only active sites are scanned (use --dry-run while onboarding)")
    allowed, why = site.script_scan()
    if not allowed:                       # refused before any run row or request
        raise ScanError(f"{slug}: {why}")
    t0 = time.monotonic()
    run_id = None if dry_run else await repo.create_scan_run(conn, slug, site.fetch.get("method") or "?", trigger, False,
                                                             params={"max_pages": max_pages})
    try:
        scanner = make_scanner(site)
        items, stats, filt = await collect(site, bundle, max_pages, scanner=scanner)
        enriched = await enrich_new(conn, site, scanner, items, limit=2 if dry_run else None)
    except Exception as exc:
        if run_id:
            await repo.finish_scan_run(conn, run_id, "error", {}, str(exc))
        raise
    summary: dict[str, Any] = {"site": slug, "method": site.fetch.get("method"), "dry_run": dry_run,
                               "pages": stats.pages, "seen": stats.items, "parsed": stats.parsed,
                               "filtered": sum(filt.get("filtered", {}).values()),
                               "parse_errors": stats.parse_errors, "errors": stats.errors, "filters": filt,
                               "enriched": enriched}
    if dry_run:
        summary["preview"] = [i.model_dump(mode="json", exclude_defaults=True) for i in items[:3]]
    else:
        res = await repo.ingest(conn, IngestRequest(listings=items, scan_run_id=run_id))
        summary.update(new=res.created, changed=res.updated, unchanged=res.unchanged, dup_cross_site=res.duplicate,
                       short_ids_new=[i.short_id for i in res.items if i.outcome == "created"][:50])
        await repo.finish_scan_run(conn, run_id, "error" if stats.errors and not items else
                                   "partial" if stats.errors else "ok",
                                   {k: v for k, v in summary.items() if k not in ("filters", "short_ids_new")},
                                   "; ".join(stats.errors) or None, pages=stats.pages)
    summary["seconds"] = round(time.monotonic() - t0, 1)
    return summary


def summary_line(s: dict[str, Any]) -> str:
    if s.get("dry_run"):
        return (f"{s['site']}: DRY RUN {s['seen']} seen, {s['parsed']} parsed, {s.get('filtered', 0)} filtered out, "
                f"{s['parse_errors']} parse errors (method={s['method']}, {s.get('seconds', 0)}s)") + "".join(f"\n  ! {e}" for e in s.get("errors", []))
    line = (f"{s['site']}: {s['seen']} seen, {s.get('filtered', 0)} filtered out, {s.get('new', 0)} new, "
            f"{s.get('changed', 0)} changed, "
            f"{s.get('dup_cross_site', 0)} dup-cross-site, {s.get('unchanged', 0)} unchanged, "
            f"{s['parse_errors']} parse errors (method={s['method']}, {s.get('seconds', 0)}s)")
    return line + "".join(f"\n  ! {e}" for e in s.get("errors", []))
