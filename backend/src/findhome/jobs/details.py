"""The listing details jobs: read a listing's own page and store what it shows.

- Browser sites (`listing_details`, an agent job): the site's detail_extract.js runs on the open page and posts its
  output to POST /api/inbox/raw (kind `detail`), which maps it with the site's `detail_to_listing` and applies it here.
  The agent then reads the page's free text only for what is still missing and records each value with its quote
  (`findhome jobs submit <run> <id> --fields-file`).
- Scripted sites (`listing_details_script`, in the app): the scanner's `enrich` reads the page again, without tokens.

A value is written only when the page has it: a missing value never overwrites a stored one. Each item keeps the
fields it changed (before / after) for undo.
"""
from __future__ import annotations

import asyncio
import importlib.util
import logging
import re
from datetime import UTC, date, datetime
from typing import Any

from psycopg.types.json import Jsonb

from findhome.core.paths import sites_dir
from findhome.domain.attributes import validate_attributes
from findhome.jobs.service import JobError, _all, _close_run, _counts, _one, mark_item_usage

log = logging.getLogger(__name__)

# columns a page read may set (anything else in a mapper's output is ignored)
COLUMNS = ("available_from", "contract_start", "contract_end", "floor", "furnished", "rent_sek", "rooms_rok",
           "size_m2", "lat", "lon", "description_excerpt", "photo_urls", "floorplan_urls", "has_balcony",
           "has_elevator", "build_year", "has_sovalkov", "deposit_sek")
JSON_COLUMNS = ("photo_urls", "floorplan_urls")
# values the agent may record from free text, each with its quote; the rest of a fields file is refused
AGENT_FIELDS = {"available_from": "date", "contract_start": "date", "contract_end": "date", "floor": "int",
                "furnished": "bool", "has_sovalkov": "bool", "deposit_sek": "int", "move_in_raw": "attr",
                "contract_terms": "attr", "max_tenants": "attr", "other_costs": "attr", "pet": "pet"}
_modules: dict[str, Any] = {}


def site_module(slug: str):
    """sites/<slug>/scanner.py, loaded once."""
    if slug not in _modules:
        path = sites_dir() / slug / "scanner.py"
        spec = importlib.util.spec_from_file_location(f"findhome_site_{slug.replace('-', '_')}_details", path)
        if spec is None or not path.exists():
            raise JobError(f"no scanner for site '{slug}'")
        mod = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(mod)
        _modules[slug] = mod
    return _modules[slug]


def _plain(v: Any) -> Any:
    return v.isoformat() if isinstance(v, (date, datetime)) else v


async def missing_of(conn, listing_id) -> list[str]:
    L = await _one(conn, """SELECT available_from, photo_urls, description_excerpt, attributes FROM listings
                            WHERE id = %s""", (listing_id,))
    out = []
    if L["available_from"] is None:
        out.append("available_from")
    if not L["photo_urls"]:
        out.append("photo_urls")
    if not L["description_excerpt"]:
        out.append("description_excerpt")
    parts = (L["attributes"] or {}).get("address_parts") or {}
    if parts.get("street") and not parts.get("number"):
        out.append("address_number")
    return out


async def apply_fields(conn, listing_id, cols: dict[str, Any], attrs: dict[str, Any],
                       pet: tuple[str, str, str] | None = None) -> tuple[dict, dict]:
    """Write the given columns and attribute keys (merged key by key) when they differ; returns (before, after) of
    what changed. `pet` = (status, evidence, source) goes through the pet precedence."""
    from findhome.db import repo

    cols = {k: v for k, v in cols.items() if k in COLUMNS and v is not None and v != []}
    attrs = validate_attributes({k: v for k, v in attrs.items() if v is not None})
    cur = await _one(conn, f"SELECT {', '.join(COLUMNS)}, attributes FROM listings WHERE id = %s", (listing_id,))
    before, after = {}, {}
    for k, v in cols.items():
        if _plain(cur[k]) != _plain(v) and not (isinstance(cur[k], float) and v is not None and float(v) == cur[k]):
            before[k], after[k] = _plain(cur[k]), _plain(v)
    cur_attrs = cur["attributes"] or {}
    for k, v in attrs.items():
        if k != "details_checked_at" and cur_attrs.get(k) != v:
            before[f"attributes.{k}"], after[f"attributes.{k}"] = cur_attrs.get(k), v
    sets = [f"{k} = %s" for k in cols]
    params: list[Any] = [Jsonb(v) if k in JSON_COLUMNS else v for k, v in cols.items()]
    if attrs:
        sets.append("attributes = COALESCE(listings.attributes, '{}'::jsonb) || %s::jsonb")
        params.append(Jsonb(attrs))
    if sets:
        await conn.execute(f"UPDATE listings SET {', '.join(sets)}"
                           + (", last_changed_at = now()" if after else "") + " WHERE id = %s", (*params, listing_id))
    if pet:
        res = await repo.set_pet(conn, listing_id, *pet)
        if res and res.get("after"):
            before["pet_status"], after["pet_status"] = res["before"].get("pet_status"), res["after"]["pet_status"]
    return before, after


def _pet_from_flag(flag: dict | None) -> tuple[str, str, str] | None:
    if not flag:
        return None
    value = flag.get("value")
    status = "yes" if value is True else "no" if value is False else "ask" if value == "ask" else None
    return (status, flag.get("evidence") or "site flag", "site") if status else None


async def _item_for(conn, job_run: str | None, listing_id) -> dict | None:
    if not job_run:
        return None
    return await _one(conn, "SELECT id, state, before, after FROM job_items WHERE job_run_id::text = %s AND listing_id = %s",
                      (str(job_run), listing_id))


async def _record(conn, job_run: str | None, item: dict | None, before: dict, after: dict, outcome: str,
                  note: str | None, page_url: str | None, evidence: str | None = None) -> None:
    if not item:
        return
    b = {**(item["before"] or {}), **{k: v for k, v in before.items() if k not in (item["before"] or {})}}
    a = {**(item["after"] or {}), **after}
    await conn.execute("""UPDATE job_items SET state = 'done', before = %s, after = %s, outcome = %s, note = %s,
                                 page_url = coalesce(%s, page_url),
                                 evidence = CASE WHEN %s::text IS NULL THEN evidence
                                                 ELSE coalesce(evidence || E'\\n', '') || %s END,
                                 at = clock_timestamp(), leased_until = NULL WHERE id = %s""",
                       (Jsonb(b) if b else None, Jsonb(a) if a else None, outcome, note, page_url, evidence, evidence,
                        item["id"]))
    await conn.execute("UPDATE job_runs SET counts = %s WHERE id::text = %s",
                       (Jsonb(await _counts(conn, job_run)), str(job_run)))


async def find_listing(conn, site: str, url: str) -> dict | None:
    """The listing a page belongs to: by its source URL, else by the id in the URL (site scanner's id_from_url)."""
    row = await _one(conn, """SELECT l.id, l.short_id FROM listing_sources s JOIN listings l ON l.id = s.listing_id
                              WHERE s.site_slug = %s AND s.url = %s""", (site, url))
    if row:
        return row
    mod = site_module(site)
    ext = mod.id_from_url(url) if hasattr(mod, "id_from_url") else None
    if not ext:
        return None
    return await _one(conn, """SELECT l.id, l.short_id FROM listing_sources s JOIN listings l ON l.id = s.listing_id
                               WHERE s.site_slug = %s AND s.external_id = %s""", (site, str(ext)))


REDACTED = "[BLOCKED"          # what the browser tool puts in place of URLs with query strings (CLI fallback only)


def _drop_redacted(doc: dict) -> int:
    """Remove the browser tool's redaction markers from the doc's string lists (a doc that passed through the agent's
    context, `jobs post-detail`); the number removed."""
    n = 0
    for k, v in list(doc.items()):
        if isinstance(v, list):
            keep = [x for x in v if not (isinstance(x, str) and REDACTED in x)]
            n += len(v) - len(keep)
            doc[k] = keep
        elif isinstance(v, dict):
            n += _drop_redacted(v)
    return n


async def raw_detail(conn, site: str, url: str, doc: dict, job_run: str | None) -> dict:
    """A listing page's data posted by detail_extract.js: apply what the page had, record it on the job item."""
    L = await find_listing(conn, site, url)
    if not L:
        raise JobError(f"no stored listing for {url}")
    item = await _item_for(conn, job_run, L["id"])
    if not doc.get("translated"):                      # the page also tells the ad status (Qasa)
        from findhome.jobs.status import status_from_detail

        await status_from_detail(conn, site, url, doc)
    if doc.get("translated"):
        await _record(conn, job_run, item, {}, {}, "translated", "page translated by Chrome: nothing read", url)
        return {"short_id": L["short_id"], "outcome": "translated", "stop": "page translated: turn off Chrome translation"}
    if doc.get("listing") is False:            # read: not picked again within exclude_details_checked_within_days
        await apply_fields(conn, L["id"], {}, {"details_checked_at": datetime.now(UTC).isoformat(timespec="seconds")},
                           None)
        await _record(conn, job_run, item, {}, {}, "gone", "the ad is gone (the status job records how)", url)
        return {"short_id": L["short_id"], "outcome": "gone"}
    if doc.get("listing") is None:
        await _record(conn, job_run, item, {}, {}, "unread", doc.get("reason") or "page state not readable", url)
        return {"short_id": L["short_id"], "outcome": "unread", "reason": doc.get("reason")}
    redacted = _drop_redacted(doc)
    mapped = site_module(site).detail_to_listing(doc)
    attrs = {**(mapped.pop("attributes", None) or {}), "details_checked_at": datetime.now(UTC).isoformat(timespec="seconds")}
    if redacted:              # a partial list never replaces a stored one
        stored = await _one(conn, "SELECT photo_urls, floorplan_urls FROM listings WHERE id = %s", (L["id"],))
        for col in ("photo_urls", "floorplan_urls"):
            if stored[col]:
                mapped.pop(col, None)
        attrs.pop("photo_count", None)
    pet = _pet_from_flag(attrs.pop("pets_flag", None))
    before, after = await apply_fields(conn, L["id"], mapped, attrs, pet)
    missing = await missing_of(conn, L["id"])
    notes = ([f"{redacted} URLs redacted by the browser tool"] if redacted else []) + (
        ["still missing: " + ", ".join(missing)] if missing else [])
    await _record(conn, job_run, item, before, after, "changed" if after else "unchanged", "; ".join(notes) or None, url)
    if item and job_run:
        await mark_item_usage(conn, str(job_run), item["id"])
    return {"short_id": L["short_id"], "outcome": "changed" if after else "unchanged", "changed": sorted(after),
            "missing": missing}


def _coerce(field: str, kind: str, value: Any) -> Any:
    if kind == "date":
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(value)):
            raise JobError(f"{field} must be a date YYYY-MM-DD")
        return str(value)
    if kind == "int":
        return int(value)
    if kind == "bool":
        if not isinstance(value, bool):
            raise JobError(f"{field} must be true or false")
        return value
    return value


async def submit_details(conn, run_id: str, short_id: str, fields: dict[str, Any], evidence: dict[str, str],
                         page_url: str | None = None, gone: bool = False) -> dict:
    """The agent's free-text findings for one listing (`jobs submit --fields-file`): every value with its quote."""
    item = await _one(conn, """SELECT i.id, i.listing_id, i.state, i.before, i.after FROM job_items i
                               JOIN listings l ON l.id = i.listing_id WHERE i.job_run_id = %s AND l.short_id = %s""",
                      (run_id, short_id.upper()))
    if not item:
        raise JobError(f"{short_id} is not part of this job run")
    if gone:
        await apply_fields(conn, item["listing_id"], {}, {"details_checked_at": datetime.now(UTC).isoformat(
            timespec="seconds")}, None)
        await _record(conn, run_id, item, {}, {}, "gone", "the ad is gone (reported by the agent)", page_url)
        return {"short_id": short_id.upper(), "outcome": "gone"}
    unknown = set(fields) - set(AGENT_FIELDS)
    if unknown:
        raise JobError(f"unknown field(s) {sorted(unknown)}; allowed: {', '.join(AGENT_FIELDS)}")
    for f in fields:
        quote = (evidence or {}).get(f, "").strip()
        if not quote:
            raise JobError(f"{f}: a quote from the page is required (evidence.{f})")
        if len(quote) > 300:
            raise JobError(f"{f}: the quote must be 300 characters at most")
    cols, attrs, pet = {}, {}, None
    for f, v in fields.items():
        kind = AGENT_FIELDS[f]
        if kind == "pet":
            if v not in ("yes", "no", "ask"):
                raise JobError("pet must be yes, no or ask")
            pet = (v, evidence[f], "agent")
        elif kind == "attr":
            attrs[f] = v
        else:
            cols[f] = _coerce(f, kind, v)
    attrs["details_checked_at"] = datetime.now(UTC).isoformat(timespec="seconds")
    attrs["details_evidence"] = {**{f: evidence[f] for f in fields}}
    before, after = await apply_fields(conn, item["listing_id"], cols, attrs, pet)
    missing = await missing_of(conn, item["listing_id"])
    quotes = "; ".join(f"{f}: “{evidence[f]}”" for f in fields)
    await _record(conn, run_id, item, before, after, "changed" if after or item["after"] else "unchanged",
                  ("still missing: " + ", ".join(missing)) if missing else None, page_url, quotes or None)
    await mark_item_usage(conn, run_id, item["id"])
    return {"short_id": short_id.upper(), "changed": sorted(after), "missing": missing}


async def undo_details(conn, item_id: int) -> dict:
    """Put back the fields an item changed, when the listing still holds the values it wrote."""
    from findhome.db import repo

    it = await _one(conn, "SELECT * FROM job_items WHERE id = %s", (item_id,))
    if not it or it["state"] != "done" or not it["after"]:
        raise JobError("nothing to undo for this item")
    cur = await _one(conn, f"SELECT {', '.join(COLUMNS)}, attributes, pet_status, pet_source FROM listings WHERE id = %s",
                     (it["listing_id"],))
    for k, v in it["after"].items():
        now = (cur["attributes"] or {}).get(k[11:]) if k.startswith("attributes.") else _plain(cur.get(k))
        if now != v:
            raise JobError(f"{k} changed after this job: undo it on the listing instead")
    cols = {k: v for k, v in (it["before"] or {}).items() if not k.startswith("attributes.") and k != "pet_status"}
    if cols:
        await conn.execute(f"UPDATE listings SET {', '.join(f'{k} = %s' for k in cols)}, last_changed_at = now() "
                           "WHERE id = %s", (*[Jsonb(v) if k in JSON_COLUMNS else v for k, v in cols.items()],
                                             it["listing_id"]))
    for k, v in (it["before"] or {}).items():
        if k.startswith("attributes."):
            key = k[11:]
            if v is None:
                await conn.execute("UPDATE listings SET attributes = attributes - %s WHERE id = %s", (key, it["listing_id"]))
            else:
                await conn.execute("UPDATE listings SET attributes = attributes || jsonb_build_object(%s::text, %s::jsonb) "
                                   "WHERE id = %s", (key, Jsonb(v), it["listing_id"]))
    if "pet_status" in (it["before"] or {}):
        await repo.set_pet(conn, it["listing_id"], it["before"]["pet_status"] or "unknown", "undo of a details job",
                           "user")
    await conn.execute("UPDATE job_items SET state = 'undone' WHERE id = %s", (item_id,))
    return {"undone": item_id, "restored": it["before"]}


# ── in the app: scripted sites ──────────────────────────────
async def run_details_script(pool, run_id: str) -> None:
    """listing_details_script: each item's page read again by its site's scanner (`enrich`), politely, no tokens.
    Runs in the background; the run closes when every item is done."""
    from findhome.config.store import get_store
    from findhome.domain.models import ListingIn, SourceIn
    from findhome.scanning.runner import make_scanner

    bundle = get_store().bundle
    async with pool.connection() as conn:
        items = await _all(conn, """SELECT i.id, i.listing_id, s.site_slug, s.external_id, s.url, l.attributes
                                    FROM job_items i JOIN listings l ON l.id = i.listing_id
                                    JOIN LATERAL (SELECT * FROM listing_sources ls WHERE ls.listing_id = l.id
                                                  ORDER BY ls.last_seen_at DESC LIMIT 1) s ON true
                                    WHERE i.job_run_id = %s AND i.state = 'queued' ORDER BY i.position""", (run_id,))
        await conn.commit()
    scanners: dict[str, Any] = {}
    for n, it in enumerate(items):
        site = bundle.sites.get(it["site_slug"]) if bundle else None
        async with pool.connection() as conn:
            try:
                if site is None or not hasattr(scanners.setdefault(site.slug, make_scanner(site)), "enrich"):
                    raise JobError(f"{it['site_slug']}: no scripted page reader")
                if n:
                    await asyncio.sleep(float(site.politeness.get("min_delay_s", 3)))
                attrs = it["attributes"] or {}
                item = ListingIn(source=SourceIn(site_slug=site.slug, external_id=it["external_id"], url=it["url"]),
                                 attributes={k: v for k, v in attrs.items() if k in ("floorplans", "apply_by")})
                read = await scanners[site.slug].enrich(item, attrs.get("floorplans") or [])
                data = read.model_dump(include=set(COLUMNS))
                before, after = await apply_fields(conn, it["listing_id"], data, read.attributes)
                missing = await missing_of(conn, it["listing_id"])
                await _record(conn, run_id, {"id": it["id"], "before": None, "after": None}, before, after,
                              "changed" if after else "unchanged",
                              ("still missing: " + ", ".join(missing)) if missing else None, it["url"])
            except Exception as exc:  # noqa: BLE001 - one listing must not stop the run
                await conn.rollback()
                await conn.execute("UPDATE job_items SET state = 'error', outcome = 'error', note = %s WHERE id = %s",
                                   (str(exc)[:300], it["id"]))
            await conn.commit()
    async with pool.connection() as conn:
        from findhome.rescore import score_listings

        await score_listings(conn, [it["listing_id"] for it in items])
        await _close_run(conn, run_id, "ok")
        await conn.commit()


# ── the chain after a browser scan ──────────────────────────
async def chain_after_run(conn, agent_run_id: str) -> dict | None:
    """When a browser scan run ends ok or partial, start the details job on the passing listings that run saw (if the
    job's chain_after_scan is on and there is anything to read). One agent uses your Chrome at a time, so it starts only
    after the scan's process has ended."""
    from findhome.agentrun import launcher
    from findhome.config.store import get_store
    from findhome.jobs import service

    run = await _one(conn, "SELECT id, profile, status, site_slug FROM agent_runs WHERE id = %s", (agent_run_id,))
    if not run or run["profile"] != "browser_scan" or run["status"] not in ("ok", "partial") or not run["site_slug"]:
        return None
    job = await service.get_job(conn, "listing_details")
    if not job["enabled"] or not job["settings"].get("chain_after_scan", True):
        return None
    bundle = get_store().bundle
    subset = {**(job["settings"].get("subset") or {}), "agent_run": str(run["id"]), "sites": [run["site_slug"]]}
    settings = {**job["settings"], "subset": subset}
    pre = await service.preview(conn, "listing_details", bundle.config_hash, settings)
    if not pre["count"]:
        return None
    try:
        jr = await service.create_run(conn, "listing_details", bundle.config_hash, settings)
    except JobError as exc:                          # e.g. a details run is already open: it covers this scan later
        log.info("details job not chained after %s: %s", agent_run_id, exc)
        return None
    await conn.commit()
    agent = await launcher.start(bundle, "listing_details", service.agent_params(jr), "cli")
    await service.link_agent_run(conn, jr["id"], agent["id"])
    await conn.commit()
    log.info("details job %s chained after scan run %s (%d listings)", jr["id"], agent_run_id, pre["count"])
    return {"job_run": str(jr["id"]), "agent_run": agent["id"], "items": pre["count"]}
