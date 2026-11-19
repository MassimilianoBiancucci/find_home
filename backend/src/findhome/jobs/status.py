"""The ad status jobs (sub-plan #11): is an ad still open where the site published it?

- `listing_status` (agent, browser sites): the agent opens each listing's page in your Chrome and runs the site's
  `status_check.js`, which posts `{status, evidence, price?}` to `POST /api/inbox/raw` (kind `status`);
  `apply_status()` sets the source's `ad_status` (an event when it changes), re-reads the price and records the
  job item. `findhome jobs post-detail --kind status` is the fallback when the page cannot post.
- `listing_status_script` (in the app, scripted sites): reads the page of each listing whose applications closed and
  applies the site's `ad_status` rules from site.yaml (redirect, status box text, deadline): rented or removed.
- The chain: when a `listing_details` run ends ok or partial, `listing_status` starts on that run's sites.
Scans set the status for free: listed → open; a complete feed closes what it no longer holds (scanning/runner.py).
"""
from __future__ import annotations

import asyncio
import logging
from datetime import UTC, date, datetime
from typing import Any

from selectolax.lexbor import LexborHTMLParser as HTMLParser

from findhome.db import repo
from findhome.jobs.details import _item_for, _record, apply_fields, site_module
from findhome.jobs.service import JobError, _all, _close_run, _one, mark_item_usage

log = logging.getLogger(__name__)


async def source_for(conn, site: str, url: str) -> dict | None:
    """The source a page belongs to: by its URL, else by the id in the URL (the site scanner's id_from_url)."""
    q = """SELECT s.id, s.listing_id, s.ad_status, l.short_id, l.rent_sek FROM listing_sources s
           JOIN listings l ON l.id = s.listing_id WHERE s.site_slug = %s AND """
    row = await _one(conn, q + "s.url = %s", (site, url))
    if row:
        return row
    mod = site_module(site)
    ext = mod.id_from_url(url) if hasattr(mod, "id_from_url") else None
    return await _one(conn, q + "s.external_id = %s", (site, str(ext))) if ext else None


async def apply_status(conn, site: str, url: str, doc: dict, job_run: str | None, actor: str = "job") -> dict:
    """A page's status (status_check.js output): set the source's ad status, re-read the price of an open ad, record
    the job item. An `unknown` result never overwrites a known status."""
    src = await source_for(conn, site, url)
    if not src:
        raise JobError(f"no stored listing for {url}")
    item = await _item_for(conn, job_run, src["listing_id"])
    if doc.get("translated"):
        await _record(conn, job_run, item, {}, {}, "translated", "page translated by Chrome: nothing read", url)
        return {"short_id": src["short_id"], "outcome": "translated", "stop": "page translated: turn off Chrome translation"}
    status, evidence = doc.get("status"), {**(doc.get("evidence") or {}), "check": "status_check.js"}
    if status not in repo.AD_STATUSES:
        raise JobError(f"status must be one of {', '.join(repo.AD_STATUSES)}")
    before: dict[str, Any] = {}
    after: dict[str, Any] = {}
    if status != "unknown" and await repo.set_ad_status(conn, src["id"], status, evidence, actor):
        before[f"ad_status.{site}"], after[f"ad_status.{site}"] = src["ad_status"], status
    price = doc.get("price")
    if status == "open" and isinstance(price, (int, float)) and price > 0:
        b, a = await apply_fields(conn, src["listing_id"], {"rent_sek": int(price)}, {})
        before.update(b)
        after.update(a)
        if a:
            from findhome.rescore import score_listings

            await score_listings(conn, [src["listing_id"]])
    note = f"{site}: {status} ({evidence.get('rule') or '-'}: {evidence.get('value') or '-'})"
    outcome = "unread" if status == "unknown" else "changed" if after else "unchanged"
    await _record(conn, job_run, item, before, after, outcome, note[:300], url)
    if item and job_run:
        await mark_item_usage(conn, str(job_run), item["id"])
    return {"short_id": src["short_id"], "outcome": outcome, "status": status, "changed": sorted(after)}


async def status_from_detail(conn, site: str, url: str, doc: dict) -> bool:
    """A details page read also tells the status when the site's mapping knows it (Qasa: Home.status, not found)."""
    mod = site_module(site)
    found = mod.ad_status_of(doc) if hasattr(mod, "ad_status_of") else None
    src = await source_for(conn, site, url) if found else None
    if not src:
        return False
    status, evidence = found
    return await repo.set_ad_status(conn, src["id"], status, {**evidence, "url_final": url,
                                                               "check": "detail_extract.js"}, "job")


async def undo_status(conn, item_id: int) -> dict:
    """Put back the ad status (and price) an item changed, while the source still has the status it set."""
    it = await _one(conn, "SELECT * FROM job_items WHERE id = %s", (item_id,))
    if not it or it["state"] != "done" or not it["after"]:
        raise JobError("nothing to undo for this item")
    for key, value in it["after"].items():
        if key.startswith("ad_status."):
            src = await _one(conn, "SELECT id, ad_status FROM listing_sources WHERE listing_id = %s AND site_slug = %s",
                             (it["listing_id"], key.split(".", 1)[1]))
            if not src or src["ad_status"] != value:
                raise JobError(f"{key} changed after this job: change it on the listing instead")
    rent = it["after"].get("rent_sek")
    if rent is not None:
        cur = await _one(conn, "SELECT rent_sek FROM listings WHERE id = %s", (it["listing_id"],))
        if cur["rent_sek"] != rent:
            raise JobError("rent_sek changed after this job: change it on the listing instead")
        await conn.execute("UPDATE listings SET rent_sek = %s, last_changed_at = now() WHERE id = %s",
                           ((it["before"] or {}).get("rent_sek"), it["listing_id"]))
    for key in it["after"]:
        if key.startswith("ad_status."):
            src = await _one(conn, "SELECT id FROM listing_sources WHERE listing_id = %s AND site_slug = %s",
                             (it["listing_id"], key.split(".", 1)[1]))
            await repo.set_ad_status(conn, src["id"], (it["before"] or {}).get(key) or "unknown",
                                     {"rule": f"undo of job item {item_id}"}, "user")
    await conn.execute("UPDATE job_items SET state = 'undone' WHERE id = %s", (item_id,))
    return {"undone": item_id, "restored": it["before"]}


# ── scripted sites: the site.yaml rules on the listing page ──
def _past(apply_by: str | None, today: date | None) -> bool:
    try:
        return bool(apply_by) and date.fromisoformat(str(apply_by)[:10]) < (today or date.today())
    except ValueError:
        return False


def page_status(html: str, final_url: str, rules: dict[str, Any], apply_by: str | None = None,
                today: date | None = None) -> tuple[str, dict[str, Any]]:
    """The ad status a scripted site's listing page shows, by its site.yaml `ad_status` rules, first match wins:
    the redirect of a removed ad, the status box's first words, a deadline in the past; else unknown."""
    if rules.get("removed_url") and rules["removed_url"] in (final_url or ""):
        return "removed", {"rule": "redirect", "value": final_url}
    box = ""
    if rules.get("box_selector"):
        node = HTMLParser(html or "").css_first(rules["box_selector"])
        box = " ".join((node.text() if node else "").split())
        for prefix, status in (rules.get("box") or {}).items():
            if box.lower().startswith(prefix.lower()):
                if status == "open" and _past(apply_by, today):
                    # gate D: an anonymous reader sees the "register interest" prompt even after the deadline
                    return "applications_closed", {"rule": "deadline passed (the box shows the login prompt)",
                                                   "value": str(apply_by)[:10]}
                return status, {"rule": "status box", "value": box[:200]}
    if apply_by:
        try:
            if date.fromisoformat(str(apply_by)[:10]) < (today or date.today()):
                return "applications_closed", {"rule": "deadline passed", "value": str(apply_by)[:10]}
        except ValueError:
            pass
    return "unknown", {"rule": "none matched", "value": box[:200] or None}


async def run_status_script(pool, run_id: str) -> None:
    """listing_status_script: each item's page read by the app with the site's rules, politely, no tokens. Runs in the
    background; the run closes when every item is done."""
    from findhome.config.store import get_store
    from findhome.scanning.runner import make_scanner

    bundle = get_store().bundle
    async with pool.connection() as conn:
        items = await _all(conn, """SELECT i.id, i.listing_id, s.id AS source_id, s.site_slug, s.url, s.ad_status,
                                           l.attributes->>'apply_by' AS apply_by
                                    FROM job_items i JOIN listings l ON l.id = i.listing_id
                                    JOIN LATERAL (SELECT * FROM listing_sources ls WHERE ls.listing_id = l.id
                                                  AND ls.url IS NOT NULL ORDER BY ls.last_seen_at DESC LIMIT 1) s ON true
                                    WHERE i.job_run_id = %s AND i.state = 'queued' ORDER BY i.position""", (run_id,))
        await conn.commit()
    scanners: dict[str, Any] = {}
    for n, it in enumerate(items):
        site = bundle.sites.get(it["site_slug"]) if bundle else None
        async with pool.connection() as conn:
            try:
                if site is None or not (site.ad_status or {}).get("box_selector"):
                    raise JobError(f"{it['site_slug']}: no ad_status page rules in site.yaml")
                scanner = scanners.setdefault(site.slug, make_scanner(site))
                if n:
                    await asyncio.sleep(float(site.politeness.get("min_delay_s", 3)))
                resp = await scanner.client.get(it["url"], follow_redirects=True)
                status, evidence = page_status(resp.text, str(resp.url), site.ad_status, it["apply_by"])
                evidence.update(http=resp.status_code, url_final=str(resp.url),
                                at=datetime.now(UTC).isoformat(timespec="seconds"))
                before, after = {}, {}
                if status != "unknown" and await repo.set_ad_status(conn, it["source_id"], status, evidence, "job"):
                    before[f"ad_status.{site.slug}"], after[f"ad_status.{site.slug}"] = it["ad_status"], status
                await _record(conn, run_id, {"id": it["id"], "before": None, "after": None}, before, after,
                              "unread" if status == "unknown" else "changed" if after else "unchanged",
                              f"{status} ({evidence['rule']}: {evidence.get('value') or '-'})"[:300], it["url"])
            except Exception as exc:  # noqa: BLE001 - one listing must not stop the run
                await conn.rollback()
                await conn.execute("UPDATE job_items SET state = 'error', outcome = 'error', note = %s WHERE id = %s",
                                   (str(exc)[:300], it["id"]))
            await conn.commit()
    async with pool.connection() as conn:
        await _close_run(conn, run_id, "ok")
        await conn.commit()


# ── the chain after a details run ───────────────────────────
async def chain_status(conn, agent_run_id: str) -> dict | None:
    """When a listing_details run ends ok or partial, start listing_status on the same sites (if its
    chain_after_details is on and a listing matches). One agent uses your Chrome at a time."""
    from findhome.agentrun import launcher
    from findhome.config.store import get_store
    from findhome.jobs import service

    run = await _one(conn, "SELECT id, profile, status FROM agent_runs WHERE id = %s", (agent_run_id,))
    if not run or run["profile"] != "listing_details" or run["status"] not in ("ok", "partial"):
        return None
    job = await service.get_job(conn, "listing_status")
    if not job["enabled"] or not job["settings"].get("chain_after_details", True):
        return None
    jr_details = await _one(conn, "SELECT settings FROM job_runs WHERE agent_run_id = %s", (agent_run_id,))
    sites = ((jr_details or {}).get("settings") or {}).get("subset", {}).get("sites")
    subset = {**(job["settings"].get("subset") or {}), **({"sites": sites} if sites else {})}
    settings = {**job["settings"], "subset": subset}
    bundle = get_store().bundle
    pre = await service.preview(conn, "listing_status", bundle.config_hash, settings)
    if not pre["count"]:
        return None
    try:
        jr = await service.create_run(conn, "listing_status", bundle.config_hash, settings)
    except JobError as exc:                          # e.g. a status run is already open
        log.info("status job not chained after %s: %s", agent_run_id, exc)
        return None
    await conn.commit()
    agent = await launcher.start(bundle, "listing_status", service.agent_params(jr), "cli")
    await service.link_agent_run(conn, jr["id"], agent["id"])
    await conn.commit()
    log.info("status job %s chained after details run %s (%d listings)", jr["id"], agent_run_id, pre["count"])
    return {"job_run": str(jr["id"]), "agent_run": agent["id"], "items": pre["count"]}
