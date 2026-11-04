"""Status of every planned Connectivity route, derived in one place so the bubble, the route list and the map agree.

cached     the provider answered and the answer is younger than cache.routing_ttl_days
stale      the provider answered, but longer ago than the TTL; still used, refreshed only on request
estimated  a straight-line estimate (no key, or chosen in the pause dialog)
failed     the provider could not answer (unroutable zone point or provider error); not retried on its own
missing    not computed yet
pending    not computed yet, and a refresh is running that will reach it
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from findhome.db.connectivity_repo import PairKey, StoredRow
from findhome.domain.commute import Request
from findhome.domain.connectivity import is_stale, zone_side

Status = Literal["cached", "stale", "estimated", "failed", "missing", "pending"]
STATUSES: tuple[Status, ...] = ("cached", "stale", "estimated", "failed", "missing", "pending")


def route_status(row: StoredRow | None, ttl_days: int, now: datetime, running: bool = False) -> Status:
    if row is None:
        return "pending" if running else "missing"
    if row.status in ("estimated", "failed"):
        return row.status  # type: ignore[return-value]
    return "stale" if is_stale(row.fetched_at, ttl_days, now) else "cached"


def pair_key(zid: str, r: Request) -> PairKey:
    return (zid, r.point_id, r.direction, r.day_type, r.window_label)


def counts(reqs: list[tuple[str, Request]], rows: dict[PairKey, StoredRow], ttl_days: int, now: datetime,
           running: bool = False) -> dict[str, int]:
    out = dict.fromkeys(STATUSES, 0)
    for zid, r in reqs:
        out[route_status(rows.get(pair_key(zid, r)), ttl_days, now, running)] += 1
    out["planned"] = len(reqs)
    out["evaluated"] = out["cached"] + out["stale"] + out["estimated"] + out["failed"]
    return out


def route_items(reqs: list[tuple[str, Request]], rows: dict[PairKey, StoredRow], names: dict[str, tuple[str, str]],
                labels: dict[str, str], ttl_days: int, now: datetime, running: bool = False) -> list[dict[str, Any]]:
    """One entry per planned route, in plan order (origin by origin). names: origin id → (name, district)."""
    out = []
    for zid, r in reqs:
        row = rows.get(pair_key(zid, r))
        name, district = names.get(zid, (zid, ""))
        at = zone_side(r)
        out.append({
            "zone_id": zid, "zone": name, "district": district,
            "point_id": r.point_id, "point": labels.get(r.point_id, r.point_id), "direction": r.direction,
            "day_type": r.day_type, "window_label": r.window_label,
            "status": route_status(row, ttl_days, now, running),
            "minutes": row.minutes if row else None, "provider": row.provider if row else None,
            "error": row.error if row else None,
            "fetched_at": row.fetched_at.isoformat() if row and row.fetched_at else None,
            "lat": at.lat, "lon": at.lon,
        })
    return out
