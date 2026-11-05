"""Listing statistics per zone (Explore → Listings): how many listings, and their rent, rent per m², size and rooms.

Pure: rows in (one per listing, already filtered and assigned to a zone), one summary per zone out. Zones with
fewer than `min_n` listings get only their count, so a single ad does not paint a zone.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any

METRICS = ("rent", "rent_per_m2", "size", "rooms")


@dataclass(frozen=True)
class StatsFilter:
    """What the Explore filter bar sends. Dates are inclusive; None means no limit."""
    statuses: tuple[str, ...] = ()                 # pipeline statuses (tags.yaml); empty = all
    seen: str = "all"                              # active (seen within active_days) | gone | all
    active_days: int = 14
    scored: str = "all"                            # passing (no hard-filter failure) | rejected | all
    posted_from: date | None = None                # Qasa publishedAt (attributes)
    posted_to: date | None = None
    first_seen_from: date | None = None
    first_seen_to: date | None = None
    rent_min: float | None = None
    rent_max: float | None = None
    size_min: float | None = None
    size_max: float | None = None
    rooms_min: float | None = None
    rooms_max: float | None = None
    min_n: int = 3


def where_sql(f: StatsFilter) -> tuple[str, list[Any]]:
    """SQL WHERE clause (on listings l, scores s for the current config) and its parameters."""
    cond, args = ["l.lat IS NOT NULL", "l.lon IS NOT NULL"], []
    if f.statuses:
        cond.append("l.status = ANY(%s)")
        args.append(list(f.statuses))
    if f.seen in ("active", "gone"):
        cond.append(f"l.last_seen_at {'>=' if f.seen == 'active' else '<'} now() - make_interval(days => %s)")
        args.append(int(f.active_days))
    if f.scored == "passing":
        cond.append("s.total IS NOT NULL")
    elif f.scored == "rejected":
        cond.append("coalesce(jsonb_array_length(s.rejected_by), 0) > 0")
    for col, lo, hi in (("(l.attributes->>'publishedAt')::date", f.posted_from, f.posted_to),
                        ("l.first_seen_at::date", f.first_seen_from, f.first_seen_to),
                        ("l.rent_sek", f.rent_min, f.rent_max), ("l.size_m2", f.size_min, f.size_max),
                        ("l.rooms_rok", f.rooms_min, f.rooms_max)):
        if lo is not None:
            cond.append(f"{col} >= %s")
            args.append(lo)
        if hi is not None:
            cond.append(f"{col} <= %s")
            args.append(hi)
    return " AND ".join(cond), args


def _quantile(vs: list[float], q: float) -> float:
    """Linear-interpolated quantile of a non-empty list."""
    s = sorted(vs)
    pos = (len(s) - 1) * q
    lo, hi = int(pos), min(int(pos) + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (pos - lo)


def zone_stats(rows: list[dict[str, Any]], areas_km2: dict[str, float | None], min_n: int = 3) -> dict[str, dict[str, Any]]:
    """rows: {zone_id, rent, size, rooms}. Per zone: n, per_km2 and, from min_n listings up, median / p25 / p75 of
    each metric (rent per m² only for listings with both rent and size)."""
    by: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        if r.get("zone_id"):
            by.setdefault(r["zone_id"], []).append(r)
    out: dict[str, dict[str, Any]] = {}
    for zid, rs in by.items():
        area = areas_km2.get(zid)
        z: dict[str, Any] = {"n": len(rs), "per_km2": round(len(rs) / area, 2) if area else None}
        if len(rs) >= min_n:
            vals = {
                "rent": [float(r["rent"]) for r in rs if r.get("rent") is not None],
                "size": [float(r["size"]) for r in rs if r.get("size") is not None],
                "rooms": [float(r["rooms"]) for r in rs if r.get("rooms") is not None],
                "rent_per_m2": [float(r["rent"]) / float(r["size"]) for r in rs if r.get("rent") and r.get("size")],
            }
            for k, v in vals.items():
                if v:
                    z[k] = {"median": round(_quantile(v, 0.5), 1), "p25": round(_quantile(v, 0.25), 1),
                            "p75": round(_quantile(v, 0.75), 1), "n": len(v)}
        out[zid] = z
    return out
