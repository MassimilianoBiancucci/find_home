"""Connectivity: how long it takes from each zone to each of your points, for the map's Connectivity mode.

One request per zone × enabled point × trip direction × window (its middle slot, the trip's first day type), from a
point inside the zone, through the commute providers (ResRobot for transit; haversine estimate without a key).
Answers go through routing_cache like listing commutes and land in zone_commute under `inputs_hash`
(locations + time_model), so a refresh resumes where it stopped and survives unrelated config edits.
"""
from __future__ import annotations

import asyncio
import logging
import time as clock
from dataclasses import dataclass, field
from datetime import UTC, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from psycopg.types.json import Jsonb

from findhome.config.loader import ConfigBundle, canonical_hash
from findhome.config.timegrid import Slot, grid_slots, window_slots
from findhome.domain.commute import MAX_CONSECUTIVE_ERRORS, Request, cache_key, reference_date
from findhome.geo.crs import to_wgs84
from findhome.geo.store import ZoneSet
from findhome.providers.base import LatLon

log = logging.getLogger(__name__)
MODE = "transit"


def inputs_hash(bundle: ConfigBundle) -> str:
    return canonical_hash(bundle.raw["locations"], bundle.raw["time_model"])


def zone_origin(zone) -> LatLon:
    """The zone's centroid, or a point surely inside it when the centroid falls outside (bays, odd shapes)."""
    c = zone.geom.centroid
    p = c if zone.geom.contains(c) else zone.geom.representative_point()
    w = to_wgs84(p)
    return LatLon(round(w.y, 5), round(w.x, 5))


def _middle(slots: list[Slot]) -> Slot:
    return slots[len(slots) // 2]


def plan(bundle: ConfigBundle, zones: ZoneSet, point_coords: dict[str, LatLon],
         zone_ids: list[str] | None = None) -> list[tuple[str, Request]]:
    out: list[tuple[str, Request]] = []
    points = [p for p in bundle.locations.points if p.enabled and p.id in point_coords]
    for zid in zone_ids or list(zones.zones):
        origin = zone_origin(zones.zones[zid])
        for p in points:
            dest = point_coords[p.id]
            for trip in p.trips:
                if MODE not in (trip.modes or p.modes):
                    continue
                if trip.use_default_grid or not trip.windows:
                    windows = [grid_slots(bundle.time_model.default_grid)]
                else:
                    windows = [window_slots(w.model_dump(by_alias=True)) for w in trip.windows]
                directions = ["to_point", "from_point"] if trip.direction == "both" else [trip.direction]
                day = trip.day_types[0]
                for d in directions:
                    a, b = (origin, dest) if d == "to_point" else (dest, origin)
                    for slots in windows:
                        s = _middle(slots)
                        out.append((zid, Request(p.id, d, day, s.window_label, s.weight, MODE, s, a, b)))
    return out


@dataclass
class JobState:
    running: bool = False
    inputs_hash: str | None = None
    total: int = 0
    done: int = 0
    calls: int = 0
    cached: int = 0
    estimated: int = 0
    skipped: int = 0
    errors: int = 0
    last_error: str | None = None
    provider: str | None = None
    started_at: float | None = None
    finished_at: float | None = None
    stopped: str | None = None           # budget | cancelled | error
    _task: asyncio.Task | None = field(default=None, repr=False)

    def reset(self, **values: Any) -> None:
        """Fresh counters for a new run; the task handle stays so cancel keeps working."""
        task = self._task
        self.__init__(**values)
        self._task = task

    def public(self) -> dict[str, Any]:
        eta = None
        if self.running and self.started_at and self.done:
            rate = self.done / max(clock.monotonic() - self.started_at, 1e-3)
            eta = round((self.total - self.done) / rate) if rate else None
        return {"running": self.running, "inputs_hash": self.inputs_hash, "total": self.total, "done": self.done,
                "calls": self.calls, "cached": self.cached, "estimated": self.estimated, "skipped": self.skipped,
                "errors": self.errors, "last_error": self.last_error, "provider": self.provider, "eta_s": eta,
                "stopped": self.stopped}


JOB = JobState()


async def _existing(conn, h: str, real_only: bool) -> set[tuple]:
    """Pairs already computed; with a real provider, estimates do not count (they get replaced)."""
    rows = await (await conn.execute(
        "SELECT zone_id, point_id, direction, day_type, window_label FROM zone_commute WHERE inputs_hash = %s"
        + (" AND NOT estimate" if real_only else ""), (h,))).fetchall()
    return {(r["zone_id"], r["point_id"], r["direction"], r["day_type"], r["window_label"]) for r in rows}


async def run(pool, registry, bundle: ConfigBundle, zones: ZoneSet, point_coords: dict[str, LatLon],
              max_calls: int, today=None) -> None:
    """Background job; one at a time (the caller checks JOB.running). Commits after every zone."""
    h = inputs_hash(bundle)
    reqs = plan(bundle, zones, point_coords)
    tz = ZoneInfo(bundle.time_model.timezone)
    today = today or datetime.now(tz).date()
    skip = set(bundle.time_model.skip_dates)
    refs = {n: reference_date(dt.days, dt.prefer, skip, today) for n, dt in bundle.time_model.day_types.items()}
    ttl = int(bundle.providers.cache.get("routing_ttl_days", 30))
    provider = registry.for_mode(MODE)
    JOB.reset(running=True, inputs_hash=h, total=len(reqs), provider=provider.name, started_at=clock.monotonic())
    failures = 0
    try:
        async with pool.connection() as conn:
            have = await _existing(conn, h, real_only=provider.name != "haversine")
        by_zone: dict[str, list[Request]] = {}
        for zid, r in reqs:
            by_zone.setdefault(zid, []).append(r)
        for zid, zreqs in by_zone.items():
            async with pool.connection() as conn:
                for r in zreqs:
                    JOB.done += 1
                    if (zid, r.point_id, r.direction, r.day_type, r.window_label) in have:
                        JOB.skipped += 1
                        continue
                    prov = registry.haversine if failures >= MAX_CONSECUTIVE_ERRORS else provider
                    key = cache_key(prov, r)
                    row = await (await conn.execute(
                        "SELECT minutes FROM routing_cache WHERE key = %s AND expires_at > now()", (key,))).fetchone()
                    est = prov.name == "haversine"
                    if row:
                        JOB.cached += 1
                        minutes = float(row["minutes"]) if row["minutes"] is not None else None
                    elif est:
                        JOB.estimated += 1
                        minutes = registry.haversine.estimate(r.origin, r.dest, MODE)
                    else:
                        if JOB.calls >= max_calls:
                            JOB.stopped = "budget"
                            return
                        when = datetime.combine(refs[r.day_type], time(0), tz) + timedelta(minutes=r.slot.minutes)
                        try:
                            res = await prov.travel(r.origin, r.dest, MODE, when, r.slot.kind)
                        except Exception as exc:  # noqa: BLE001 - provider errors must not stop the job
                            failures += 1
                            JOB.errors += 1
                            JOB.last_error = f"{prov.name}: {exc.__class__.__name__}: {exc}"[:300]
                            continue
                        failures = 0
                        JOB.calls += 1
                        minutes = res.minutes if res else None
                        await conn.execute(
                            """INSERT INTO routing_cache (key, provider, minutes, response, expires_at) VALUES (%s,%s,%s,%s,%s)
                               ON CONFLICT (key) DO UPDATE SET minutes = EXCLUDED.minutes, response = EXCLUDED.response,
                               created_at = now(), expires_at = EXCLUDED.expires_at""",
                            (key, prov.name, minutes, Jsonb({"minutes": minutes, "source": "connectivity"}),
                             datetime.now(UTC) + timedelta(days=ttl)))
                    await conn.execute(
                        """INSERT INTO zone_commute (inputs_hash, zone_id, point_id, direction, day_type, window_label,
                             window_weight, provider, minutes, estimate) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                           ON CONFLICT (inputs_hash, zone_id, point_id, direction, day_type, window_label) DO UPDATE SET
                             minutes = EXCLUDED.minutes, provider = EXCLUDED.provider, estimate = EXCLUDED.estimate,
                             computed_at = now()""",
                        (h, zid, r.point_id, r.direction, r.day_type, r.window_label, r.window_weight, prov.name,
                         None if minutes is None else round(minutes, 1), est))
    except asyncio.CancelledError:
        JOB.stopped = "cancelled"
        raise
    except Exception as exc:  # noqa: BLE001 - surface in status instead of a silent dead task
        JOB.stopped = "error"
        JOB.last_error = f"{exc.__class__.__name__}: {exc}"[:300]
        log.exception("connectivity job failed")
    finally:
        JOB.running = False
        JOB.finished_at = clock.monotonic()


def aggregate(rows: list[dict], bundle: ConfigBundle) -> dict[str, dict[str, Any]]:
    """Per zone: minutes per point (window-weighted mean over directions and windows) and the point-weighted mean,
    the same weights the commute score group uses."""
    per: dict[str, dict[str, list[tuple[float, float]]]] = {}
    est: dict[str, bool] = {}
    for r in rows:
        if r["minutes"] is None:
            continue
        per.setdefault(r["zone_id"], {}).setdefault(r["point_id"], []).append((float(r["minutes"]), float(r["window_weight"])))
        est[r["zone_id"]] = est.get(r["zone_id"], False) or bool(r["estimate"])
    weights = {p.id: bundle.locations.effective_weight(p) for p in bundle.locations.points}
    out: dict[str, dict[str, Any]] = {}
    for zid, pts in per.items():
        by_point = {pid: round(sum(m * w for m, w in v) / (sum(w for _, w in v) or 1), 1) for pid, v in pts.items()}
        tw = sum(weights.get(p, 0) for p in by_point)
        weighted = round(sum(m * weights.get(p, 0) for p, m in by_point.items()) / tw, 1) if tw else None
        out[zid] = {"by_point": by_point, "weighted": weighted, "estimate": est.get(zid, False)}
    return out
