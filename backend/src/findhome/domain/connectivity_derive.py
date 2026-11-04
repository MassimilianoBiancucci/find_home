"""Zone commutes from station commutes (connectivity.origin: stations): the comparison pass after the matrix.

For every zone and route (point, direction, day type, window), each home takes its best start among the zone's
stations: walk (from data/geo/centroids/) + transit (centroid_commute). The zone value is the home-weighted mean of
those bests; the pattern records which stations and which group (rail, bus) the best routes start from, so a bus that
beats a nearby metro shows up. Pure: rows in, rows out.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from findhome.db.connectivity_repo import PairKey, StoredRow
from findhome.zone.heatmap import weighted_quantile

Route = tuple[str, str, str, str]                  # point_id, direction, day_type, window_label


@dataclass
class ZoneRoute:
    zone_id: str
    route: Route
    window_weight: float
    minutes: float | None
    status: str                                    # ok | estimated | failed
    error: str | None
    pattern: dict[str, Any]


def routes_of(reqs) -> dict[Route, float]:
    """The distinct routes of a station plan and their window weights."""
    return {(r.point_id, r.direction, r.day_type, r.window_label): r.window_weight for _, r in reqs}


def derive(centroids: dict[str, Any], rows: dict[PairKey, StoredRow], routes: dict[Route, float]) -> list[ZoneRoute]:
    out: list[ZoneRoute] = []
    for zid, z in centroids["zones"].items():
        keys = [c["key"] for c in z["centroids"]]
        groups = [c["group"] for c in z["centroids"]]
        homes = z["homes"]
        total = sum(w for w, _ in homes) or 1.0
        for route, weight in routes.items():
            transit: dict[int, tuple[float, bool]] = {}
            for i, k in enumerate(keys):
                row = rows.get((k, *route))
                if row and row.status in ("ok", "estimated") and row.minutes is not None:
                    transit[i] = (row.minutes, row.status == "estimated")
            best: list[tuple[float, float, float, int]] = []          # (total min, weight, walk min, station)
            for w, walks in homes:
                cands = [(s / 60 + transit[int(i)][0], s / 60, int(i)) for i, s in walks.items() if int(i) in transit]
                if cands:
                    t, walk, i = min(cands)
                    best.append((t, w, walk, i))
            if not best:
                reason = "no station of the zone has an answer yet" if not transit else "no home within walking reach of a station with an answer"
                out.append(ZoneRoute(zid, route, weight, None, "failed", reason, {"reached": 0.0}))
                continue
            wsum = sum(w for _, w, _, _ in best)
            minutes = round(sum(t * w for t, w, _, _ in best) / wsum, 1)
            winners: dict[str, float] = {}
            by_group: dict[str, float] = {}
            for _, w, _, i in best:
                winners[keys[i]] = winners.get(keys[i], 0.0) + w / wsum
                by_group[groups[i]] = by_group.get(groups[i], 0.0) + w / wsum
            estimated = sum(w for _, w, _, i in best if transit[i][1]) / wsum > 0.5
            pattern = {
                "minutes": minutes, "reached": round(wsum / total, 3),
                "median": weighted_quantile([(t, w) for t, w, _, _ in best], 0.5),
                "walk_median": weighted_quantile([(walk, w) for _, w, walk, _ in best], 0.5),
                "transit_median": weighted_quantile([(transit[i][0], w) for _, w, _, i in best], 0.5),
                "groups": {g: round(v, 3) for g, v in by_group.items()},
                "winners": {k: round(v, 3) for k, v in sorted(winners.items(), key=lambda kv: -kv[1])},
            }
            for key in ("median", "walk_median", "transit_median"):
                pattern[key] = None if pattern[key] is None else round(pattern[key], 1)
            out.append(ZoneRoute(zid, route, weight, minutes, "estimated" if estimated else "ok", None, pattern))
    return out
