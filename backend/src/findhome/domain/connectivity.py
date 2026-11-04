"""Connectivity: how long it takes from each zone to each of your points, for the map's Connectivity mode.

One request per zone × enabled point × trip direction × window (its middle slot, the trip's first day type), from a
point inside the zone, through the commute providers (ResRobot for transit; haversine estimate without a key).
Answers go through routing_cache like listing commutes and land in zone_commute under `inputs_hash`
(locations + time_model) with a status (ok, estimated, failed), so a refresh resumes where it stopped, survives
unrelated config edits and only recomputes the routes its scope names (`decide`).
"""
from __future__ import annotations

import asyncio
import functools
import logging
import time as clock
from dataclasses import dataclass, field
from datetime import UTC, datetime, time, timedelta
from typing import Any, Literal
from zoneinfo import ZoneInfo

from findhome.config.loader import ConfigBundle, canonical_hash
from findhome.config.timegrid import Slot, grid_slots, window_slots
from findhome.db.connectivity_repo import CacheHit, ConnectivityStore, RowWrite, StoredRow
from findhome.domain.commute import MAX_CONSECUTIVE_ERRORS, Request, cache_key, reference_date
from findhome.geo.crs import to_wgs84
from findhome.geo.store import ZoneSet
from findhome.providers.base import LatLon, LocationNotFound

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


def plan_origins(bundle: ConfigBundle, origins: list[tuple[str, LatLon]],
                 point_coords: dict[str, LatLon]) -> list[tuple[str, Request]]:
    """One transit request per origin × enabled point × trip direction × window (its middle slot, the trip's first
    day type). An origin is a zone (its inside point) or a connectivity centroid (a station)."""
    out: list[tuple[str, Request]] = []
    points = [p for p in bundle.locations.points if p.enabled and p.id in point_coords]
    for uid, origin in origins:
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
                        out.append((uid, Request(p.id, d, day, s.window_label, s.weight, MODE, s, a, b)))
    return out


def plan(bundle: ConfigBundle, zones: ZoneSet, point_coords: dict[str, LatLon],
         zone_ids: list[str] | None = None) -> list[tuple[str, Request]]:
    """Origin = one point inside each zone (connectivity.origin: zone)."""
    return plan_origins(bundle, [(z, zone_origin(zones.zones[z])) for z in zone_ids or list(zones.zones)], point_coords)


def plan_stations(bundle: ConfigBundle, stations: dict[str, dict[str, Any]],
                  point_coords: dict[str, LatLon]) -> list[tuple[str, Request]]:
    """Origin = every connectivity centroid (station) once, shared by the zones that use it (connectivity.origin:
    stations). Routed from the station's own coordinate, so the provider always finds a stop."""
    return plan_origins(bundle, [(k, LatLon(round(v["lat"], 5), round(v["lon"], 5))) for k, v in sorted(stations.items())],
                        point_coords)


SCOPES = ("missing", "estimates", "failed", "stale")
DEFAULT_SCOPE = ("missing", "estimates")
POLICIES = ("ask", "continue", "estimate")
Action = Literal["skip", "fail", "cache", "call", "estimate"]


def parse_scope(scope: list[str] | str | None) -> tuple[str, ...]:
    """Which stored routes a refresh recomputes: missing (no row), estimates, failed, stale (older than the TTL)."""
    items = [scope] if isinstance(scope, str) else list(scope or DEFAULT_SCOPE)
    if "all" in items:
        return SCOPES
    bad = [s for s in items if s not in SCOPES]
    if bad:
        raise ValueError(f"unknown scope {bad} (use {', '.join(SCOPES)} or all)")
    return tuple(s for s in SCOPES if s in items)


def is_stale(when: datetime | None, ttl_days: int, now: datetime) -> bool:
    return when is not None and now - when > timedelta(days=ttl_days)


def zone_side(r: Request) -> LatLon:
    """The zone's end of a request: ResRobot's SVC_LOC is about this coordinate (points answer for other zones)."""
    return r.origin if r.direction == "to_point" else r.dest


def decide(row: StoredRow | None, failed_coord: bool, cache: CacheHit | None, scope: tuple[str, ...],
           real: bool, ttl_days: int, now: datetime) -> Action:
    """What the job does with one planned route. Shared by the job and the cost estimate of a refresh."""
    if not real:                                    # no real provider: estimate what is missing, keep the rest
        return "skip" if row else "estimate"
    if row is None:
        if "missing" not in scope:
            return "skip"
    elif row.status == "ok":
        return "call" if "stale" in scope and is_stale(row.fetched_at, ttl_days, now) else "skip"
    elif (row.status == "estimated" and "estimates" not in scope) or (row.status == "failed" and "failed" not in scope):
        return "skip"
    if failed_coord:
        return "fail"
    if cache and not ("stale" in scope and is_stale(cache.created_at, ttl_days, now)):
        return "cache"
    return "call"


@dataclass
class JobState:
    running: bool = False
    state: str = "idle"                  # idle | running | paused | done | stopped
    inputs_hash: str | None = None
    scope: tuple[str, ...] = DEFAULT_SCOPE
    policy: str = "ask"
    estimating: bool = False             # after an "estimate" decision: remaining calls become estimates
    total: int = 0
    done: int = 0
    calls: int = 0
    cached: int = 0
    estimated: int = 0
    skipped: int = 0
    failed: int = 0                      # routes marked failed in this run (location or provider error)
    errors: int = 0                      # provider errors other than an unroutable location
    last_error: str | None = None
    pause_reason: str | None = None
    failed_coords: list[dict[str, Any]] = field(default_factory=list)   # up to 20, for the decision dialog
    provider: str | None = None
    started_at: float | None = None
    finished_at: float | None = None
    stopped: str | None = None           # budget | cancelled | decision | error
    _task: asyncio.Task | None = field(default=None, repr=False)
    _decision: asyncio.Future | None = field(default=None, repr=False)

    def reset(self, **values: Any) -> None:
        """Fresh counters for a new run; the task handle stays so cancel keeps working."""
        task = self._task
        self.__init__(**values)
        self._task = task

    def decide(self, action: str) -> bool:
        """Answer a paused job: continue | estimate | stop. False when nothing is waiting."""
        if self._decision is None or self._decision.done():
            return False
        self._decision.set_result(action)
        return True

    async def ask(self, reason: str) -> str:
        self.state, self.pause_reason = "paused", reason
        self._decision = asyncio.get_running_loop().create_future()
        try:
            return await self._decision
        finally:
            self._decision = None
            self.state, self.pause_reason = "running", None

    def note_failed_coord(self, zone_id: str, at: LatLon, code: str) -> None:
        if len(self.failed_coords) < 20 and all(c["zone_id"] != zone_id for c in self.failed_coords):
            self.failed_coords.append({"zone_id": zone_id, "lat": at.lat, "lon": at.lon, "code": code})

    def public(self) -> dict[str, Any]:
        eta = None
        if self.state == "running" and self.started_at and self.done:
            rate = self.done / max(clock.monotonic() - self.started_at, 1e-3)
            eta = round((self.total - self.done) / rate) if rate else None
        return {"running": self.running, "state": self.state, "inputs_hash": self.inputs_hash, "scope": list(self.scope),
                "policy": self.policy, "estimating": self.estimating, "total": self.total, "done": self.done,
                "calls": self.calls, "cached": self.cached, "estimated": self.estimated, "skipped": self.skipped,
                "failed": self.failed, "errors": self.errors, "last_error": self.last_error,
                "pause_reason": self.pause_reason, "failed_coords": self.failed_coords, "provider": self.provider,
                "eta_s": eta, "stopped": self.stopped}


JOB = JobState()


async def run(store: ConnectivityStore, registry, bundle: ConfigBundle, zones: ZoneSet,
              point_coords: dict[str, LatLon], max_calls: int, scope: list[str] | str | None = None,
              policy: str = "ask", today=None, reqs: list[tuple[str, Request]] | None = None) -> None:
    """Background job; one at a time (the caller checks JOB.running). Every route is written as soon as it is known.

    A coordinate the provider cannot route is remembered and its other routes are marked failed without a call.
    Three provider errors in a row pause the job (policy `ask`) or follow `continue` / `estimate`; it never falls
    back to estimates on its own.
    """
    h = inputs_hash(bundle)
    sc = parse_scope(scope)
    reqs = reqs if reqs is not None else plan(bundle, zones, point_coords)
    tz = ZoneInfo(bundle.time_model.timezone)
    today = today or datetime.now(tz).date()
    skip = set(bundle.time_model.skip_dates)
    refs = {n: reference_date(dt.days, dt.prefer, skip, today) for n, dt in bundle.time_model.day_types.items()}
    ttl = int(bundle.providers.cache.get("routing_ttl_days", 30))
    provider = registry.for_mode(MODE)
    real = provider.name != "haversine"
    JOB.reset(running=True, state="running", inputs_hash=h, scope=sc, policy=policy, total=len(reqs),
              provider=provider.name, started_at=clock.monotonic())
    consecutive = 0
    try:
        if real and "failed" in sc:
            await store.clear_failures(provider.name)
        have = await store.rows(h)
        failures = await store.failures(provider.name) if real else {}
        for zid, r in reqs:
            JOB.done += 1
            pk = (zid, r.point_id, r.direction, r.day_type, r.window_label)
            coord = zone_side(r).key()
            key = cache_key(provider, r)
            row = have.get(pk)
            pre = decide(row, coord in failures, None, sc, real, ttl, datetime.now(UTC))
            if pre == "skip":
                JOB.skipped += 1
                continue
            hit = await store.cache_get(key) if pre == "call" else None
            act = decide(row, coord in failures, hit, sc, real, ttl, datetime.now(UTC)) if hit else pre
            if act == "call" and JOB.estimating:
                act = "estimate"
            write = functools.partial(RowWrite, h, pk, r.window_weight)
            if act == "fail":
                JOB.failed += 1
                if not (row and row.status == "failed"):
                    await store.write(write(provider.name, None, "failed", f"{failures[coord]}: no stop near the zone point"))
                continue
            if act == "cache":
                JOB.cached += 1
                await store.write(write(provider.name, hit.minutes, "ok", None, hit.created_at, hit.zone_mode))
                continue
            if act == "estimate":
                JOB.estimated += 1
                await store.write(write("haversine", registry.haversine.estimate(r.origin, r.dest, MODE), "estimated"))
                continue
            if JOB.calls >= max_calls:
                JOB.stopped = "budget"
                return
            when = datetime.combine(refs[r.day_type], time(0), tz) + timedelta(minutes=r.slot.minutes)
            JOB.calls += 1
            try:
                res = await provider.travel(r.origin, r.dest, MODE, when, r.slot.kind)
            except LocationNotFound as exc:
                failures[coord] = exc.code
                JOB.failed += 1
                JOB.note_failed_coord(zid, zone_side(r), exc.code)
                await store.record_failure(provider.name, coord, exc.code, exc.message)
                await store.write(write(provider.name, None, "failed", f"{exc.code}: {exc.message}"[:300]))
                continue
            except Exception as exc:  # noqa: BLE001 - provider errors must not stop the job
                consecutive += 1
                JOB.errors += 1
                JOB.failed += 1
                JOB.last_error = f"{provider.name}: {exc.__class__.__name__}: {exc}"[:300]
                await store.write(write(provider.name, None, "failed", JOB.last_error))
                if consecutive >= MAX_CONSECUTIVE_ERRORS:
                    consecutive = 0
                    reason = f"{MAX_CONSECUTIVE_ERRORS} {provider.name} errors in a row; last: {JOB.last_error}"
                    action = JOB.policy if JOB.policy != "ask" else await JOB.ask(reason)   # "don't ask again" sets it
                    if action == "stop":
                        JOB.stopped = "decision"
                        return
                    JOB.estimating = JOB.estimating or action == "estimate"
                continue
            consecutive = 0
            minutes = res.minutes if res else None
            # the ride at the zone's end: the first one outbound, the last one on the way back
            first = (res.raw or {}).get("first_mode" if r.direction == "to_point" else "last_mode") if res else None
            fetched = await store.cache_put(key, provider.name, minutes, ttl, first)
            await store.write(write(provider.name, minutes, "ok", None if res else "no connection found", fetched, first))
    except asyncio.CancelledError:
        JOB.stopped = "cancelled"
        raise
    except Exception as exc:  # noqa: BLE001 - surface in status instead of a silent dead task
        JOB.stopped = "error"
        JOB.last_error = f"{exc.__class__.__name__}: {exc}"[:300]
        log.exception("connectivity job failed")
    finally:
        JOB.running = False
        JOB.state = "stopped" if JOB.stopped else "done"
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
