"""Commute matrix: listing ↔ every configured point, per trip, day type, time window and mode.

Pipeline per listing:
  plan_requests()  expand points × trips × directions × day types × window slots × modes
  prefilter        skip points farther (straight line) than providers.yaml prefilter allows
  cache lookup     routing_cache keyed by provider|mode|origin|dest|day_type|slot|when_is
  provider call    respecting the per-run budget (max_routing_calls_per_run)
  aggregate        median / p90 / worst / spread per window → commute_results (with config_hash)
"""
from __future__ import annotations

import math
import statistics
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from psycopg.types.json import Jsonb

from findhome.config.loader import ConfigBundle
from findhome.config.models import Point
from findhome.config.timegrid import Slot, grid_slots, window_slots
from findhome.providers.base import LatLon, ProviderUnavailable, haversine_km

_WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
MAX_CONSECUTIVE_ERRORS = 3


def reference_date(days: list[str], prefer: str | None, skip: set[str], today: date) -> date:
    """Next date (from tomorrow) on one of `days`, the preferred weekday first, not in skip."""
    wanted = [prefer] if prefer else []
    wanted += [d for d in days if d not in wanted]
    for name in wanted:
        for offset in range(1, 30):
            d = today + timedelta(days=offset)
            if _WEEKDAYS[d.weekday()] == name and d.isoformat() not in skip:
                return d
    raise ValueError(f"no reference date for {days}")


@dataclass(frozen=True)
class Request:
    point_id: str
    direction: str            # to_point | from_point
    day_type: str
    window_label: str
    window_weight: float
    mode: str
    slot: Slot
    origin: LatLon
    dest: LatLon


@dataclass
class Plan:
    requests: list[Request] = field(default_factory=list)
    prefiltered: list[str] = field(default_factory=list)
    missing_coords: list[str] = field(default_factory=list)


def plan_requests(home: LatLon, bundle: ConfigBundle, point_coords: dict[str, LatLon]) -> Plan:
    plan = Plan()
    max_km = (bundle.providers.prefilter or {}).get("max_haversine_km_by_category", {})
    for point in bundle.locations.points:
        if not point.enabled:
            continue
        coords = point_coords.get(point.id)
        if coords is None:
            plan.missing_coords.append(point.id)
            continue
        limit = max_km.get(point.category)
        if limit is not None and haversine_km(home, coords) > limit:
            plan.prefiltered.append(point.id)
            continue
        for trip in point.trips:
            directions = ["to_point", "from_point"] if trip.direction == "both" else [trip.direction]
            modes = trip.modes or point.modes
            if trip.use_default_grid or not trip.windows:
                windows = [grid_slots(bundle.time_model.default_grid)]
            else:
                windows = [window_slots(w.model_dump(by_alias=True)) for w in trip.windows]
            for direction in directions:
                origin, dest = (home, coords) if direction == "to_point" else (coords, home)
                for day_type in trip.day_types:
                    for slots in windows:
                        for mode in modes:
                            for slot in slots:
                                plan.requests.append(Request(point.id, direction, day_type, slot.window_label,
                                                             slot.weight, mode, slot, origin, dest))
    return plan


def percentile(values: list[float], pct: float) -> float:
    """Nearest-rank percentile."""
    ordered = sorted(values)
    k = max(0, min(len(ordered) - 1, math.ceil(pct / 100 * len(ordered)) - 1))
    return ordered[k]


def stats(minutes: list[float]) -> dict[str, float | None]:
    if not minutes:
        return {"median_min": None, "p90_min": None, "worst_min": None, "spread_min": None}
    med, p90 = statistics.median(minutes), percentile(minutes, 90)
    return {"median_min": round(med, 1), "p90_min": round(p90, 1), "worst_min": round(max(minutes), 1),
            "spread_min": round(p90 - med, 1)}


def cache_key(provider, req: Request) -> str:
    base = f"{provider.name}|{req.mode}|{req.origin.key()}|{req.dest.key()}"
    if not provider.time_dependent:
        return base + "|*"
    return f"{base}|{req.day_type}|{req.slot.minutes}|{req.slot.kind}"


@dataclass
class RunBudget:
    max_calls: int
    used: int = 0

    def take(self) -> bool:
        if self.used >= self.max_calls:
            return False
        self.used += 1
        return True


async def compute_listing(conn, registry, bundle: ConfigBundle, listing: dict[str, Any],
                          point_coords: dict[str, LatLon], budget: RunBudget, dry_run: bool = False,
                          forced_provider: str | None = None, today: date | None = None) -> dict[str, Any]:
    home = LatLon(listing["lat"], listing["lon"])
    plan = plan_requests(home, bundle, point_coords)
    tz = ZoneInfo(bundle.time_model.timezone)
    today = today or datetime.now(tz).date()
    skip = set(bundle.time_model.skip_dates)
    ref_dates = {name: reference_date(dt.days, dt.prefer, skip, today) for name, dt in bundle.time_model.day_types.items()}
    ttl = int(bundle.providers.cache.get("routing_ttl_days", 30))
    counts: dict[str, Any] = {"requests": len(plan.requests), "cached": 0, "calls": 0, "estimated": 0,
                              "skipped_budget": 0, "errors": 0, "by_provider": defaultdict(int),
                              "prefiltered": plan.prefiltered, "missing_coords": plan.missing_coords}
    groups: dict[tuple, list[dict]] = defaultdict(list)
    seen_keys: dict[str, dict] = {}
    dry_keys: set[str] = set()
    failures: dict[str, int] = defaultdict(int)      # consecutive errors per provider (circuit breaker)
    for req in plan.requests:
        provider = registry.for_mode(req.mode, forced_provider)
        if failures[provider.name] >= MAX_CONSECUTIVE_ERRORS:
            provider = registry.haversine                # provider down for this run: estimate instead
            counts["fallback"] = counts.get("fallback", 0) + 1
        key = cache_key(provider, req)
        if key in seen_keys:
            sample = {**seen_keys[key], "slot": req.slot.label}
            groups[(req.point_id, req.direction, req.day_type, req.window_label, req.window_weight, req.mode,
                    provider.name)].append(sample)
            continue
        row = await (await conn.execute(
            "SELECT minutes, response FROM routing_cache WHERE key = %s AND expires_at > now()", (key,))).fetchone()
        sample: dict[str, Any] | None = None
        if row:
            counts["cached"] += 1
            sample = {"minutes": float(row["minutes"]) if row["minutes"] is not None else None,
                      **{k: row["response"].get(k) for k in ("depart", "arrive", "transfers")}, "cached": True}
        elif provider.name == "haversine":
            counts["estimated"] += 1
            sample = {"minutes": registry.haversine.estimate(req.origin, req.dest, req.mode), "estimate": True}
        elif dry_run:
            if key not in dry_keys:
                dry_keys.add(key)
                counts["calls"] += 1
                counts["by_provider"][provider.name] += 1
            continue
        elif not budget.take():
            counts["skipped_budget"] += 1
            continue
        else:
            when = datetime.combine(ref_dates[req.day_type], time(0), tz) + timedelta(minutes=req.slot.minutes)
            try:
                res = await provider.travel(req.origin, req.dest, req.mode, when, req.slot.kind)
            except (ProviderUnavailable, Exception) as exc:  # noqa: BLE001 - provider errors must not stop the run
                counts["errors"] += 1
                failures[provider.name] += 1
                counts["last_error"] = f"{provider.name}: {exc.__class__.__name__}: {exc}"[:300]
                seen_keys[key] = {"minutes": None, "error": True}   # do not retry the same key in this run
                continue
            failures[provider.name] = 0
            counts["calls"] += 1
            counts["by_provider"][provider.name] += 1
            sample = {"minutes": res.minutes if res else None, "depart": res.depart if res else None,
                      "arrive": res.arrive if res else None, "transfers": res.transfers if res else None}
            await conn.execute(
                """INSERT INTO routing_cache (key, provider, minutes, response, expires_at) VALUES (%s,%s,%s,%s,%s)
                   ON CONFLICT (key) DO UPDATE SET minutes = EXCLUDED.minutes, response = EXCLUDED.response,
                   created_at = now(), expires_at = EXCLUDED.expires_at""",
                (key, provider.name, sample["minutes"], Jsonb(sample), datetime.now(UTC) + timedelta(days=ttl)))
        seen_keys[key] = sample
        groups[(req.point_id, req.direction, req.day_type, req.window_label, req.window_weight, req.mode,
                provider.name)].append({**sample, "slot": req.slot.label})
    counts["by_provider"] = dict(counts["by_provider"])
    if dry_run:
        price = (bundle.providers.routing.get("google") or {}).get("price_per_1000_usd", 0)
        counts["estimated_cost_usd"] = round(counts["by_provider"].get("google", 0) * price / 1000, 2)
        return counts
    stored = 0
    for (point_id, direction, day_type, label, weight, mode, prov), samples in groups.items():
        values = [s["minutes"] for s in samples if s.get("minutes") is not None]
        st = stats(values)
        await conn.execute(
            """INSERT INTO commute_results (listing_id, config_hash, point_id, direction, day_type, window_label,
                   window_weight, mode, provider, samples, median_min, p90_min, worst_min, spread_min)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
               ON CONFLICT (listing_id, config_hash, point_id, direction, day_type, window_label, mode)
               DO UPDATE SET provider = EXCLUDED.provider, samples = EXCLUDED.samples,
                 median_min = EXCLUDED.median_min, p90_min = EXCLUDED.p90_min, worst_min = EXCLUDED.worst_min,
                 spread_min = EXCLUDED.spread_min, window_weight = EXCLUDED.window_weight, computed_at = now()""",
            (listing["id"], bundle.config_hash, point_id, direction, day_type, label, weight, mode, prov,
             Jsonb(samples), st["median_min"], st["p90_min"], st["worst_min"], st["spread_min"]))
        stored += 1
    counts["windows_stored"] = stored
    return counts


async def resolve_point_coords(conn, registry, points: list[Point], ttl_days: int = 365) -> dict[str, LatLon]:
    from findhome.providers.geocode import geocode

    out: dict[str, LatLon] = {}
    for p in points:
        if p.coords:
            out[p.id] = LatLon(*p.coords)
        elif p.address:
            try:
                hit = await geocode(conn, registry, p.address, ttl_days)
            except Exception:  # noqa: BLE001 - network problems leave the point without coords
                hit = None
            if hit:
                out[p.id] = hit
    return out
