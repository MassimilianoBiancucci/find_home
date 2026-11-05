"""Measure a zone's index components: walking access to rail, bus and services (heatmap summaries), coverage,
and the lines and departures at the stops within a short walk of the zone's homes, per time window."""
from __future__ import annotations

from typing import Any

from findhome.config.loader import ConfigBundle
from findhome.geo.store import TimetableIndex
from findhome.zone.extent import Extent
from findhome.zone.heatmap import ExtentGraph, HeatmapParams, compute, weighted_quantile
from findhome.zone.indices import Components, choice_cfg
from findhome.zone.targets import stop_modes

RAIL = {"metro", "commuter_rail", "local_rail", "tram", "train"}
RAIL_WEIGHT = 3                    # a rail line counts as three bus lines in the lines component


def reachable_stops(eg: ExtentGraph, tt: TimetableIndex, minutes: float) -> list[tuple[str, float]]:
    """(stop id, seconds) of the stops within `minutes` walk of any of the zone's homes."""
    starts: dict[int, float] = {}
    for (n, d), _ in eg.homes:
        starts[n] = min(starts.get(n, float("inf")), d / eg.p.speed_mps)
    times = eg.times_from(starts, minutes * 60)
    out = []
    for i in tt.tree.query(eg.ext.search, predicate="intersects"):
        s = eg.snap(tt.points[int(i)])
        if s and s[0] in times:
            out.append((tt.ids[int(i)], times[s[0]] + s[1] / eg.p.speed_mps))
    return out


def window_counts(tt: TimetableIndex, stops: list[str], hours: tuple[int, int]) -> tuple[float | None, float | None]:
    """(weighted distinct lines with a departure in the window, departures per hour at the 3 busiest stops)."""
    if tt.source != "gtfs":
        lines = {lid for s in stops for lid in tt.stops[s].get("lines", [])}
        return (float(sum(RAIL_WEIGHT if tt.lines[lid]["mode"] in RAIL else 1 for lid in lines if lid in tt.lines)), None)
    h0, h1 = hours
    span = max(h1 - h0, 1)
    lines: set[str] = set()
    per_stop: list[float] = []
    for s in stops:
        by_line = tt.departures_by_line(s, "weekday") or {}
        n = 0
        for lid, counts in by_line.items():
            k = sum(counts[h0:h1])
            if k:
                lines.add(lid)
                n += k
        per_stop.append(n / span)
    weighted = sum(RAIL_WEIGHT if tt.lines.get(lid, {}).get("mode") in RAIL else 1 for lid in lines)
    return float(weighted), round(sum(sorted(per_stop, reverse=True)[:3]), 1)


def choice_median(eg: ExtentGraph, pts: list, within_min: float) -> float | None:
    """Home-weighted median number of targets within `within_min` walk (the homes' street nodes); None without homes."""
    if not eg.homes:
        return None
    counts = eg.counts_within(pts, within_min * 60) if pts else {}
    med = weighted_quantile([(float(counts.get(n, 0)), w) for (n, _), w in eg.homes], 0.5)
    return None if med is None else round(med, 1)


def measure(bundle: ConfigBundle, ext: Extent, eg: ExtentGraph, tt: TimetableIndex | None,
            targets: dict[str, list], p: HeatmapParams) -> tuple[Components, dict[str, Any]]:
    """targets: points per target set (rail, bus and the services sets). Returns the components and the summary."""
    cfg = bundle.zone.indices
    transit = {sid: pts for sid, pts in targets.items() if bundle.zone.target_sets[sid].stops}
    others = {sid: pts for sid, pts in targets.items() if sid not in transit}
    t_sum = compute(eg.net, ext, transit, p, [], eg=eg).summary if transit else {}     # "any" = nearest stop
    o_sum = compute(eg.net, ext, others, p, [], eg=eg).summary if others else {}
    summ = {**o_sum, **t_sum}

    def med(sid: str) -> float | None:
        v = summ.get(sid, {}).get("median_s")
        return None if v is None else round(v / 60, 1)

    cov = t_sum.get("any", {}).get("share_le_5min")
    service_sets = [s for s in cfg["services"]["sets"] if s in targets]
    c = Components(rail_access_min=med("rail"), bus_access_min=med("bus"), coverage=cov,
                   services_min={s: med(s) for s in service_sets},
                   services_choice={s: choice_median(eg, targets[s], choice_cfg(cfg)["within_min"]) for s in service_sets})
    if tt is not None:
        stops = [s for s, _ in reachable_stops(eg, tt, cfg["access_min"])]
        for w, spec in cfg["windows"].items():
            c.lines[w], c.frequency[w] = window_counts(tt, stops, tuple(spec["hours"]))
        detail = {"reachable_stops": len(stops),
                  "modes": sorted({m for s in stops for m in stop_modes(tt, s)})}
    else:
        detail = {"reachable_stops": None, "modes": []}
    return c, {**detail, "homes": len(eg.homes)}
