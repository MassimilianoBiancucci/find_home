"""Connectivity centroids: the stations a zone's commutes start from. Pure selection, no I/O.

Candidates are stations (stops grouped by parent station) in and around the zone, split into groups by mode (rail,
bus). Per group, a greedy cover picks the fewest stations that put `coverage` of the zone's homes within `walk_min`,
each one adding at least `min_gain` of the homes; stations with more lines win near ties. The union of the groups is
the zone's centroid set, so a rail start and a bus start can be compared for the same homes. A group whose cover
picks nothing keeps one reference station: the one most homes reach within max_walk_min.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from shapely.geometry import Point

from findhome.geo.store import TimetableIndex
from findhome.zone.measure import RAIL, RAIL_WEIGHT


@dataclass
class Candidate:
    key: str                       # parent station id, else stop id
    name: str
    group: str                     # rail | bus (zone.yaml centroids.groups)
    point: Point                   # EPSG:3006, the first stop of the station
    points: list[Point]            # every stop (platform) of the station
    lines_w: int                   # distinct lines, rail weighted


def candidates(tt: TimetableIndex, geom, groups: dict[str, list[str]]) -> list[Candidate]:
    """Stations inside geom, one candidate per group they serve (a station with metro and buses is in both)."""
    by_key: dict[str, list[int]] = {}
    for i in tt.tree.query(geom, predicate="intersects"):
        sid = tt.ids[int(i)]
        by_key.setdefault(tt.stops[sid].get("parent") or sid, []).append(int(i))
    out = []
    for key, idx in by_key.items():
        lines = {lid for i in idx for lid in tt.stops[tt.ids[i]].get("lines", []) if lid in tt.lines}
        for group, modes in groups.items():
            mine = {lid for lid in lines if tt.lines[lid]["mode"] in modes}
            if not mine:
                continue
            pts = [tt.points[i] for i in idx if any(tt.lines.get(lid, {}).get("mode") in modes
                                                    for lid in tt.stops[tt.ids[i]].get("lines", []))]
            w = sum(RAIL_WEIGHT if tt.lines[lid]["mode"] in RAIL else 1 for lid in mine)
            out.append(Candidate(key, tt.stops[tt.ids[idx[0]]].get("name") or key, group, pts[0], pts, w))
    return out


def cover(walk: list[dict[int, float]], weights: list[float], cands: list[Candidate], members: list[int],
          walk_s: float, coverage: float, min_gain: float) -> tuple[list[int], float]:
    """Greedy cover of the homes by the candidates `members` (indices into cands). Returns (chosen, share covered)."""
    total = sum(weights) or 1.0
    covered = [False] * len(weights)
    share, chosen = 0.0, []
    left = set(members)
    while left and share < coverage:
        best, best_gain, best_score = None, 0.0, 0.0
        for j in left:
            gain = sum(w for h, w in enumerate(weights) if not covered[h] and walk[h].get(j, 1e9) <= walk_s)
            score = gain * (1 + 0.05 * cands[j].lines_w)
            if score > best_score:
                best, best_gain, best_score = j, gain, score
        if best is None or best_gain / total < min_gain:
            break
        chosen.append(best)
        left.discard(best)
        for h in range(len(weights)):
            if walk[h].get(best, 1e9) <= walk_s:
                covered[h] = True
        share += best_gain / total
    return chosen, round(min(share, 1.0), 3)


def select(walk: list[dict[int, float]], weights: list[float], cands: list[Candidate], cfg: dict[str, Any]) -> dict[str, Any]:
    """Per group cover, then the union. walk[h][j]: seconds from home h to candidate j (absent beyond max_walk_min)."""
    chosen: list[int] = []
    shares = {}
    for group in cfg["groups"]:
        members = [j for j, c in enumerate(cands) if c.group == group]
        picked, share = cover(walk, weights, cands, members, cfg["walk_min"] * 60, cfg["coverage"], cfg["min_gain"])
        if not picked and members and cfg.get("reference", True):
            # no station of this group is close enough: keep the one most homes reach within max_walk_min anyway,
            # so a farther metro can still be compared with a closer bus
            reach = {j: sum(w for h, w in enumerate(weights) if j in walk[h]) for j in members}
            best = max(members, key=lambda j: (reach[j], cands[j].lines_w))
            if reach[best] > 0:
                picked = [best]
        chosen += picked
        shares[group] = share
    return {"chosen": chosen, "coverage": shares}


def stop_cover(stops: list[tuple[float, float]], radius: float) -> list[tuple[float, float, list[int]]]:
    """Fewest circles of `radius` (metres, EPSG:3006) whose union covers every stop; centres are free points.

    Candidates are every stop and, for each pair of stops closer than 2 × radius, the two centres of the circles
    through both (an optimal circle can be moved until two stops sit on its edge, or it sits on one). A greedy pass
    takes the candidate covering most uncovered stops (lazy heap); each circle is then re-centred on the minimum
    enclosing circle of the stops it took. Returns (x, y, stop indices) per circle; every stop is in exactly one.
    """
    import heapq

    import numpy as np
    import shapely
    from shapely import STRtree

    if not stops:
        return []
    xy = np.asarray(stops, dtype=float)
    pts = shapely.points(xy)
    tree = STRtree(pts)
    a, b = tree.query(pts, predicate="dwithin", distance=2 * radius)
    keep = a < b
    a, b = a[keep], b[keep]
    mid = (xy[a] + xy[b]) / 2
    d = np.linalg.norm(xy[b] - xy[a], axis=1)
    h = np.sqrt(np.maximum(radius ** 2 - (d / 2) ** 2, 0))
    perp = np.stack([-(xy[b] - xy[a])[:, 1], (xy[b] - xy[a])[:, 0]], axis=1) / np.maximum(d, 1e-9)[:, None]
    cand = np.vstack([xy, mid + perp * h[:, None], mid - perp * h[:, None]])
    ci, si = STRtree(pts).query(shapely.points(cand), predicate="dwithin", distance=radius + 1e-6)
    order = np.argsort(ci, kind="stable")
    ci, si = ci[order], si[order]
    starts = np.searchsorted(ci, np.arange(len(cand)))
    ends = np.searchsorted(ci, np.arange(len(cand)), side="right")
    members = [si[s:e] for s, e in zip(starts, ends, strict=True)]
    covered = np.zeros(len(xy), dtype=bool)
    heap = [(-len(m), j) for j, m in enumerate(members) if len(m)]
    heapq.heapify(heap)
    chosen: list[tuple[int, np.ndarray]] = []
    while heap and not covered.all():
        neg, j = heapq.heappop(heap)
        gain = members[j][~covered[members[j]]]
        if len(gain) < -neg:                                  # stale count: push back with the current one
            if len(gain):
                heapq.heappush(heap, (-len(gain), j))
            continue
        covered[gain] = True
        chosen.append((j, gain))
    out = []
    for j, got in chosen:
        circle = shapely.minimum_bounding_circle(shapely.multipoints(xy[got]))
        c = circle.centroid if not circle.is_empty and shapely.minimum_bounding_radius(shapely.multipoints(xy[got])) <= radius else None
        x, y = (c.x, c.y) if c is not None else (float(cand[j][0]), float(cand[j][1]))
        out.append((round(x, 1), round(y, 1), [int(i) for i in got]))
    return out
