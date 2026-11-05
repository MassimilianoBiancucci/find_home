"""The subset of listings a job works on: one filter shared by every job type."""
from __future__ import annotations

from typing import Any

KEYS = ("sites", "origin_sites", "pet_status", "pet_source", "new_since", "passes_hard_filters", "order",
        "short_ids", "exclude_checked_within_days", "status")
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
    if subset.get("exclude_checked_within_days"):
        where.append("(l.pet_checked_at IS NULL OR l.pet_checked_at < now() - make_interval(days => %s))")
        params.append(int(subset["exclude_checked_within_days"]))
    order = ORDERS.get(subset.get("order") or "score_desc", ORDERS["score_desc"])
    params.append(limit)
    sql = (f"SELECT l.id, l.short_id, l.title, l.area, l.origin_site, l.pet_status, l.pet_source, s.total AS score "
           f"FROM listings l LEFT JOIN scores s ON s.listing_id = l.id AND s.config_hash = %s "
           f"WHERE {' AND '.join(where)} ORDER BY {order} LIMIT %s")
    return sql, params
