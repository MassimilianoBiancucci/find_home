"""Data access for the API. Async psycopg, dict rows, explicit SQL."""
from __future__ import annotations

from typing import Any

from psycopg import errors
from psycopg.types.json import Jsonb
from rapidfuzz import fuzz

from findhome.db import runs_repo
from findhome.db.runs_repo import create_scan_run, finish_scan_run  # noqa: F401 - scan runner API
from findhome.domain.models import EvaluationIn, FeedbackIn, IngestItemResult, IngestRequest, IngestResult, ListingIn
from findhome.domain.normalize import content_hash, dedupe_key, new_short_id, normalize_address
from findhome.pets import apply_pet, ingest_candidate

LISTING_FIELDS = (
    "listing_kind", "title", "address_raw", "area", "lat", "lon", "size_m2", "rooms_rok", "has_sovalkov", "floor",
    "has_elevator", "has_balcony", "build_year", "furnished", "rent_sek", "deposit_sek", "contract_type",
    "contract_start", "contract_end", "max_duration_months", "price_sek", "avgift_sek", "drift_sek",
    "pet_status", "pet_evidence", "available_from", "description_excerpt", "photo_urls", "floorplan_urls",
    "attributes",
)
_JSON_FIELDS = {"photo_urls", "floorplan_urls", "attributes"}


class NotFound(Exception):
    pass


def _val(field: str, value: Any) -> Any:
    return Jsonb(value) if field in _JSON_FIELDS else value


async def _fetchone(conn, sql: str, params: tuple = ()) -> dict | None:
    return await (await conn.execute(sql, params)).fetchone()


async def _fetchall(conn, sql: str, params: tuple = ()) -> list[dict]:
    return await (await conn.execute(sql, params)).fetchall()


# ── ingest ──────────────────────────────────────────────────
def _site_platforms() -> dict[str, dict[str, str]]:
    """slug → its `platforms` map (aggregators), from the loaded config; empty when no config is loaded."""
    from findhome.config.store import get_store

    try:
        b = get_store().bundle
    except Exception:  # noqa: BLE001 - ingest must work without a config (tests, CLI)
        return {}
    return {slug: s.platforms for slug, s in (b.sites if b else {}).items() if s.platforms}


def origin_site(item: ListingIn, platforms: dict[str, dict[str, str]]) -> str:
    """Where the listing was first published: the aggregator's platform mapping, else the site it was found on."""
    site = item.source.site_slug
    platform = (item.attributes or {}).get("platform")
    return (platforms.get(site) or {}).get(str(platform), site) if platform else site


async def _insert_listing(conn, item: ListingIn, key: str | None, chash: str, origin: str | None = None) -> dict:
    data = item.model_dump(include=set(LISTING_FIELDS))
    data.update(apply_pet(None, None, *ingest_candidate(item)) or {})
    cols = list(data) + ["short_id", "canonical_url", "address_norm", "dedupe_key", "content_hash", "origin_site"]
    for _ in range(8):
        short_id = new_short_id()
        values = [_val(k, v) for k, v in data.items()] + [
            short_id, item.source.url, normalize_address(item.address_raw), key, chash, origin]
        try:
            async with conn.transaction():
                return await _fetchone(
                    conn, f"INSERT INTO listings ({', '.join(cols)}) VALUES ({', '.join(['%s'] * len(cols))}) "
                          "RETURNING id, short_id", tuple(values))
        except errors.UniqueViolation:
            continue
    raise RuntimeError("could not allocate a unique short_id")


async def _update_listing(conn, listing_id, item: ListingIn, current: dict, chash: str) -> None:
    data = item.model_dump(include=set(LISTING_FIELDS), exclude_none=True)
    data.pop("pet_status", None)
    data.pop("pet_evidence", None)
    # pet status: only when the new source ranks at least as high as the one that set it (pets.apply_pet)
    data.update(apply_pet(current.get("pet_status"), current.get("pet_source"), *ingest_candidate(item)) or {})
    for k in ("photo_urls", "floorplan_urls"):
        if not data.get(k):
            data.pop(k, None)
    if not data.get("attributes"):
        data.pop("attributes", None)
    sets = ", ".join(f"{k} = %s" for k in data)
    params = [_val(k, v) for k, v in data.items()]
    await conn.execute(
        f"UPDATE listings SET {sets + ', ' if sets else ''}content_hash = %s, address_norm = %s, "
        "dedupe_key = COALESCE(%s, dedupe_key), last_seen_at = now(), last_changed_at = now() WHERE id = %s",
        (*params, chash, normalize_address(item.address_raw) or current.get("address_norm"), dedupe_key(item),
         listing_id))


async def _upsert_source(conn, listing_id, item: ListingIn, scan_run_id: str | None, chash: str) -> None:
    s = item.source
    await conn.execute(
        """INSERT INTO listing_sources (listing_id, site_slug, external_id, url, scan_run_id, first_scan_run_id,
               source_method, raw_snapshot_path, content_hash)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
           ON CONFLICT (site_slug, external_id) DO UPDATE SET url = COALESCE(EXCLUDED.url, listing_sources.url),
             scan_run_id = COALESCE(EXCLUDED.scan_run_id, listing_sources.scan_run_id),
             raw_snapshot_path = COALESCE(EXCLUDED.raw_snapshot_path, listing_sources.raw_snapshot_path),
             content_hash = EXCLUDED.content_hash, last_seen_at = now(), active = true""",
        (listing_id, s.site_slug, s.external_id, s.url, scan_run_id, scan_run_id, s.method, s.raw_snapshot_path,
         chash))


async def _find_duplicate(conn, item: ListingIn, key: str | None) -> dict | None:
    if not key:
        return None
    rows = await _fetchall(conn, "SELECT id, short_id, address_norm FROM listings WHERE dedupe_key = %s", (key,))
    addr = normalize_address(item.address_raw) or ""
    for r in rows:
        if fuzz.ratio(addr, r["address_norm"] or "") >= 90:
            return r
    return None


async def _apply_pet_to(conn, listing_id, item: ListingIn) -> None:
    cur = await _fetchone(conn, "SELECT pet_status, pet_source FROM listings WHERE id = %s", (listing_id,))
    upd = apply_pet(cur["pet_status"], cur["pet_source"], *ingest_candidate(item)) if cur else None
    if upd:
        await conn.execute("UPDATE listings SET pet_status = %s, pet_evidence = %s, pet_source = %s, "
                           "last_changed_at = now() WHERE id = %s",
                           (upd["pet_status"], upd["pet_evidence"], upd["pet_source"], listing_id))


async def set_pet(conn, listing_id, status: str, evidence: str | None, source: str) -> dict | None:
    """Write a pet status from the agent or the user through the precedence rule; returns the update or None."""
    cur = await _fetchone(conn, "SELECT pet_status, pet_source, pet_evidence FROM listings WHERE id = %s",
                          (listing_id,))
    if cur is None:
        raise NotFound(str(listing_id))
    upd = apply_pet(cur["pet_status"], cur["pet_source"], status, evidence, source)
    if upd and (upd["pet_status"], upd["pet_source"], upd["pet_evidence"]) == (
            cur["pet_status"], cur["pet_source"], cur["pet_evidence"]):
        upd = None                                         # the same answer again: nothing changes
    checked = source in ("agent", "user")
    if upd:
        await conn.execute("UPDATE listings SET pet_status = %s, pet_evidence = %s, pet_source = %s, "
                           "pet_checked_at = CASE WHEN %s THEN now() ELSE pet_checked_at END, last_changed_at = now() "
                           "WHERE id = %s",
                           (upd["pet_status"], upd["pet_evidence"], upd["pet_source"], checked, listing_id))
    elif checked:
        await conn.execute("UPDATE listings SET pet_checked_at = now() WHERE id = %s", (listing_id,))
    return {"before": {"pet_status": cur["pet_status"], "pet_source": cur["pet_source"],
                       "pet_evidence": cur["pet_evidence"]}, "after": upd}


async def ingest(conn, req: IngestRequest) -> IngestResult:
    result = IngestResult()
    platforms = _site_platforms()
    for item in req.listings:
        # enrichment (detail pages) only happens for new items; hashing the list-page view keeps
        # the next scan's un-enriched copy of the same listing "unchanged"
        chash = item.attributes.pop("_list_hash", None) or content_hash(item)
        key = dedupe_key(item)
        src = await _fetchone(
            conn, """SELECT l.id, l.short_id, s.content_hash, l.pet_status, l.pet_source, l.address_norm
                     FROM listing_sources s
                     JOIN listings l ON l.id = s.listing_id WHERE s.site_slug = %s AND s.external_id = %s""",
            (item.source.site_slug, item.source.external_id))
        if src:
            # change detection is per source, so two sites listing the same flat do not flip-flop it
            if src["content_hash"] == chash:
                await conn.execute("UPDATE listings SET last_seen_at = now() WHERE id = %s", (src["id"],))
                outcome = "unchanged"
            else:
                await _update_listing(conn, src["id"], item, src, chash)
                outcome = "updated"
            await conn.execute("UPDATE listings SET origin_site = %s WHERE id = %s AND origin_site IS NULL",
                               (origin_site(item, platforms), src["id"]))
            row = src
        else:
            dup = await _find_duplicate(conn, item, key)
            if dup:
                await conn.execute("UPDATE listings SET last_seen_at = now() WHERE id = %s", (dup["id"],))
                await _apply_pet_to(conn, dup["id"], item)       # a second site may know more about pets
                row, outcome = dup, "duplicate"
            else:
                row, outcome = await _insert_listing(conn, item, key, chash, origin_site(item, platforms)), "created"
                await conn.execute(
                    "INSERT INTO listing_status_events (listing_id, to_status, actor, note) VALUES (%s,'new','system',%s)",
                    (row["id"], f"found on {item.source.site_slug}"))
        await _upsert_source(conn, row["id"], item, req.scan_run_id, chash)
        setattr(result, outcome, getattr(result, outcome) + 1)
        result.items.append(IngestItemResult(short_id=row["short_id"], outcome=outcome,
                                             external_id=item.source.external_id))
    return result


# ── reads ───────────────────────────────────────────────────
async def get_listing(conn, short_id: str) -> dict:
    row = await _fetchone(conn, "SELECT * FROM listings WHERE short_id = %s", (short_id.upper(),))
    if not row:
        raise NotFound(short_id)
    return row


async def listing_sources(conn, listing_id) -> list[dict]:
    return await _fetchall(conn, "SELECT site_slug, external_id, url, source_method, first_seen_at, last_seen_at, "
                                 "scan_run_id, first_scan_run_id "
                                 "FROM listing_sources WHERE listing_id = %s ORDER BY first_seen_at", (listing_id,))


async def source_exists(conn, site: str, ref: str) -> dict | None:
    return await _fetchone(
        conn, """SELECT l.short_id, l.status, s.last_seen_at FROM listing_sources s JOIN listings l ON l.id = s.listing_id
                 WHERE s.site_slug = %s AND (s.external_id = %s OR s.url = %s)""", (site, ref, ref))


async def list_listings(conn, config_hash: str, status: str | None = None, kind: str | None = None,
                        q: str | None = None, include_rejected: bool = True, limit: int = 200,
                        since: str | None = None, origin: str | None = None, site: str | None = None,
                        scan_run: str | None = None) -> list[dict]:
    where, params = ["true"], [config_hash]
    if origin:
        where.append("l.origin_site = %s")
        params.append(origin)
    if site:
        where.append("EXISTS (SELECT 1 FROM listing_sources ls WHERE ls.listing_id = l.id AND ls.site_slug = %s)")
        params.append(site)
    if scan_run:
        where.append("EXISTS (SELECT 1 FROM listing_sources ls WHERE ls.listing_id = l.id "
                     "AND (ls.scan_run_id = %s OR ls.first_scan_run_id = %s))")
        params += [scan_run, scan_run]
    if status:
        where.append("l.status = ANY(%s)")
        params.append(status.split(","))
    if kind:
        where.append("l.listing_kind = %s")
        params.append(kind)
    if q:
        where.append("(l.address_raw ILIKE %s OR l.area ILIKE %s OR l.title ILIKE %s OR l.short_id = upper(%s))")
        params += [f"%{q}%"] * 3 + [q]
    if since:
        where.append("l.last_changed_at > %s")
        params.append(since)
    if not include_rejected:
        where.append("(s.total IS NOT NULL OR s.listing_id IS NULL)")
    params.append(limit)
    return await _fetchall(
        conn, f"""SELECT l.*, s.total AS score, s.rejected_by, s.breakdown, s.config_hash AS score_hash,
                    (SELECT array_agg(DISTINCT ls.site_slug) FROM listing_sources ls WHERE ls.listing_id = l.id) AS found_on,
                    (s.listing_id IS NULL) AS score_stale,
                    coalesce(ll.payload->'scores'->>'transport', ll.payload->>'transport')::float AS house_transport,
                    (ll.payload->>'services')::float AS house_services,
                    coalesce((ll.payload->'scores'->>'estimated')::boolean, false) AS house_estimated
                 FROM listings l LEFT JOIN scores s ON s.listing_id = l.id AND s.config_hash = %s
                 LEFT JOIN listing_location ll ON ll.listing_id = l.id
                 WHERE {' AND '.join(where)}
                 ORDER BY s.total DESC NULLS LAST, l.last_changed_at DESC LIMIT %s""", tuple(params))


async def commute_for(conn, listing_id, config_hash: str) -> list[dict]:
    return await _fetchall(
        conn, """SELECT point_id, direction, day_type, window_label, window_weight, mode, provider,
                        median_min, p90_min, worst_min, spread_min, samples, computed_at
                 FROM commute_results WHERE listing_id = %s AND config_hash = %s
                 ORDER BY point_id, direction, day_type, window_label, mode""", (listing_id, config_hash))


async def feedback_for(conn, listing_id) -> list[dict]:
    return await _fetchall(conn, "SELECT polarity, tags, note, actor, at FROM feedback WHERE listing_id = %s "
                                 "ORDER BY at DESC", (listing_id,))


async def evaluations_for(conn, listing_id, limit: int = 3) -> list[dict]:
    return await _fetchall(conn, "SELECT * FROM evaluations WHERE listing_id = %s ORDER BY at DESC LIMIT %s",
                           (listing_id, limit))


async def status_events(conn, listing_id) -> list[dict]:
    return await _fetchall(conn, "SELECT from_status, to_status, actor, note, at FROM listing_status_events "
                                 "WHERE listing_id = %s ORDER BY at", (listing_id,))


# ── writes ──────────────────────────────────────────────────
async def set_status(conn, short_id: str, status: str, actor: str, note: str | None) -> dict:
    row = await get_listing(conn, short_id)
    if row["status"] != status:
        await conn.execute("UPDATE listings SET status = %s WHERE id = %s", (status, row["id"]))
        await conn.execute("INSERT INTO listing_status_events (listing_id, from_status, to_status, actor, note) "
                           "VALUES (%s,%s,%s,%s,%s)", (row["id"], row["status"], status, actor, note))
    return {"short_id": row["short_id"], "from": row["status"], "to": status}


async def add_feedback(conn, short_id: str, fb: FeedbackIn) -> dict:
    row = await get_listing(conn, short_id)
    await conn.execute("INSERT INTO feedback (listing_id, polarity, tags, note, actor) VALUES (%s,%s,%s,%s,%s)",
                       (row["id"], fb.polarity, fb.tags, fb.note, fb.actor))
    if "no_pets" in fb.tags:              # your feedback is the highest pet source
        await set_pet(conn, row["id"], "no", fb.note or "your feedback: no pets", fb.actor)
    return {"short_id": row["short_id"], "ok": True}


async def add_evaluation(conn, ev: EvaluationIn) -> dict:
    row = await get_listing(conn, ev.short_id)
    await conn.execute(
        """INSERT INTO evaluations (listing_id, agent_run_id, summary, pros, cons, questions_for_landlord,
               extracted, confidence) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
        (row["id"], ev.agent_run_id, ev.summary, ev.pros, ev.cons, ev.questions_for_landlord, Jsonb(ev.extracted),
         ev.confidence))
    if ev.pet_status and ev.pet_evidence:
        await set_pet(conn, row["id"], ev.pet_status, ev.pet_evidence, "agent")
    return {"short_id": row["short_id"], "ok": True}


async def save_score(conn, listing_id, config_hash: str, result: dict) -> None:
    await conn.execute(
        """INSERT INTO scores (listing_id, config_hash, total, rejected_by, breakdown) VALUES (%s,%s,%s,%s,%s)
           ON CONFLICT (listing_id, config_hash) DO UPDATE SET total = EXCLUDED.total,
             rejected_by = EXCLUDED.rejected_by, breakdown = EXCLUDED.breakdown, computed_at = now()""",
        (listing_id, config_hash, result["total"], result["rejected_by"], Jsonb(result["breakdown"])))


# ── sites & runs ────────────────────────────────────────────
async def sync_sites(conn, sites: dict, hashes: dict[str, str]) -> None:
    for slug, s in sites.items():
        await conn.execute(
            """INSERT INTO sites (slug, name, url, kinds, status, fetch_method, config_hash)
               VALUES (%s,%s,%s,%s::listing_kind[],%s,%s,%s)
               ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, url = EXCLUDED.url, kinds = EXCLUDED.kinds,
                 status = EXCLUDED.status, fetch_method = EXCLUDED.fetch_method, config_hash = EXCLUDED.config_hash,
                 synced_at = now()""",
            (slug, s.name, s.url, s.kinds, s.status, s.fetch.get("method"), hashes.get(slug, "")))
    if sites:
        await conn.execute("DELETE FROM sites WHERE NOT (slug = ANY(%s))", (list(sites),))


async def list_sites(conn) -> list[dict]:
    """Registry rows with the latest scan run of any method (script, browser agent, inbox import)."""
    return await _fetchall(conn, """SELECT s.*, r.counts AS last_counts, r.status AS last_status, r.id AS last_run_id
                                    FROM sites s LEFT JOIN LATERAL (
                                        SELECT id, counts, status FROM scan_runs WHERE site_slug = s.slug
                                        AND NOT dry_run ORDER BY started_at DESC LIMIT 1) r ON true
                                    ORDER BY s.slug""")


async def site_listing_counts(conn) -> list[dict]:
    """Per site: listings found on it (sources) and listings first published on it (origin)."""
    return await _fetchall(conn, """SELECT slug, sum(found)::int AS found, sum(origin)::int AS origin FROM (
                                        SELECT site_slug AS slug, count(DISTINCT listing_id) AS found, 0 AS origin
                                        FROM listing_sources GROUP BY site_slug
                                        UNION ALL
                                        SELECT origin_site, 0, count(*) FROM listings
                                        WHERE origin_site IS NOT NULL GROUP BY origin_site) x GROUP BY slug""")


async def list_runs(conn, limit: int = 50) -> dict[str, list[dict]]:
    return await runs_repo.timeline(conn, limit)
