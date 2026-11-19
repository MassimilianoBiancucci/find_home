"""The subset of listings a job works on: one filter shared by every job type."""
from __future__ import annotations

from typing import Any

KEYS = ("sites", "origin_sites", "pet_status", "pet_source", "new_since", "passes_hard_filters", "order",
        "short_ids", "exclude_checked_within_days", "status", "missing_fields", "exclude_details_checked_within_days",
        "agent_run", "ad_status_in", "not_seen_since_last_scan")
# what the details job fills: no move-in, no photos, no description, no street number, or a page never read
MISSING_FIELDS_SQL = ("(l.available_from IS NULL OR coalesce(jsonb_array_length(l.photo_urls), 0) = 0 "
                      "OR l.description_excerpt IS NULL OR NOT (l.attributes ? 'details_checked_at') "
                      "OR (l.attributes->'address_parts' ? 'street' AND NOT (l.attributes->'address_parts' ? 'number')))")
ORDERS = {"score_desc": "s.total DESC NULLS LAST, l.last_changed_at DESC",
          "newest": "l.first_seen_at DESC", "oldest": "l.first_seen_at ASC"}


def subset_sql(subset: dict[str, Any], config_hash: str, limit: int) -> tuple[str, list]:
    """SELECT of listing ids (with short_id) matching the subset, in the subset's order, capped by limit."""
    unknown = set(subset) - set(KEYS)
    if unknown:
        raise ValueError(f"unknown subset key(s) {sorted(unknown)}; allowed: {', '.join(KEYS)}")
    where, params = ["true"], [config_hash]
    if subset.get("sites"):
        where.append("EXISTS (SELECT 1 FROM listing_sources ls WHERE ls.listing_id = l.id AND ls.site_slug = ANY(%s))")
        params.append(list(subset["sites"]))
    if subset.get("origin_sites"):
        where.append("l.origin_site = ANY(%s)")
        params.append(list(subset["origin_sites"]))
    if subset.get("pet_status"):
        where.append("l.pet_status::text = ANY(%s)")
        params.append(list(subset["pet_status"]))
    if subset.get("pet_source"):
        where.append("coalesce(l.pet_source, 'none') = ANY(%s)")
        params.append(list(subset["pet_source"]))
    if subset.get("status"):
        where.append("l.status = ANY(%s)")
        params.append(list(subset["status"]))
    else:
        where.append("l.status NOT IN ('rejected', 'archived')")
    if subset.get("new_since"):
        where.append("l.first_seen_at >= %s")
        params.append(subset["new_since"])
    if subset.get("passes_hard_filters"):
        where.append("(s.listing_id IS NULL OR s.total IS NOT NULL)")       # not scored yet counts as passing
    if subset.get("short_ids"):
        where.append("l.short_id = ANY(%s)")
        params.append([str(x).upper() for x in subset["short_ids"]])
    if subset.get("missing_fields"):
        where.append(MISSING_FIELDS_SQL)
    if subset.get("exclude_details_checked_within_days"):
        where.append("(NOT (l.attributes ? 'details_checked_at') OR (l.attributes->>'details_checked_at')::timestamptz "
                     "< now() - make_interval(days => %s))")
        params.append(int(subset["exclude_details_checked_within_days"]))
    if subset.get("agent_run"):                       # the listings a browser scan run saw
        where.append("EXISTS (SELECT 1 FROM listing_sources ls JOIN scan_runs sr ON sr.id = ls.scan_run_id "
                     "WHERE ls.listing_id = l.id AND sr.agent_run_id::text = %s)")
        params.append(str(subset["agent_run"]))
    if subset.get("ad_status_in"):                    # a source (on the chosen sites) with one of these statuses
        site_cond = " AND ls.site_slug = ANY(%s)" if subset.get("sites") else ""
        where.append(f"EXISTS (SELECT 1 FROM listing_sources ls WHERE ls.listing_id = l.id "
                     f"AND ls.ad_status = ANY(%s){site_cond})")
        params.append(list(subset["ad_status_in"]))
        if site_cond:
            params.append(list(subset["sites"]))
    if subset.get("not_seen_since_last_scan"):        # a source the site's last completed scan did not list
        where.append("EXISTS (SELECT 1 FROM listing_sources ls WHERE ls.listing_id = l.id AND ls.last_seen_at < "
                     "(SELECT max(sr.started_at) FROM scan_runs sr WHERE sr.site_slug = ls.site_slug "
                     "AND sr.status IN ('ok', 'partial') AND NOT sr.dry_run))")
    if subset.get("exclude_checked_within_days"):
        where.append("(l.pet_checked_at IS NULL OR l.pet_checked_at < now() - make_interval(days => %s))")
        params.append(int(subset["exclude_checked_within_days"]))
    order = ORDERS.get(subset.get("order") or "score_desc", ORDERS["score_desc"])
    params.append(limit)
    sql = (f"SELECT l.id, l.short_id, l.title, l.area, l.origin_site, l.pet_status, l.pet_source, s.total AS score "
           f"FROM listings l LEFT JOIN scores s ON s.listing_id = l.id AND s.config_hash = %s "
           f"WHERE {' AND '.join(where)} ORDER BY {order} LIMIT %s")
    return sql, params
