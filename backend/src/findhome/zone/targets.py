"""Target points of a target set (zone.yaml target_sets) inside an area: stops by transit mode, POIs by category."""
from __future__ import annotations

from collections.abc import Callable

from shapely.geometry import Point
from shapely.geometry.base import BaseGeometry

from findhome.config.models import TargetSet
from findhome.geo.store import PoiIndex, TimetableIndex


def stop_modes(timetable: TimetableIndex, stop_id: str) -> set[str]:
    return {ln["mode"] for ln in timetable.lines_at(stop_id)}


def target_points(ts: TargetSet, geom: BaseGeometry, timetable: TimetableIndex | None,
                  load_poi: Callable[[str], PoiIndex | None]) -> list[tuple[Point, str]]:
    """(point in EPSG:3006, label) of every target of the set inside geom."""
    out: list[tuple[Point, str]] = []
    if ts.stops and timetable is not None:
        wanted = set(ts.stops)
        for i in timetable.tree.query(geom, predicate="intersects"):
            sid = timetable.ids[int(i)]
            if stop_modes(timetable, sid) & wanted:
                out.append((timetable.points[int(i)], timetable.stops[sid].get("name") or sid))
    for cat in ts.poi:
        idx = load_poi(cat)
        if idx is None:
            continue
        for i in idx.tree.query(geom, predicate="intersects"):
            props = idx.features[int(i)].get("properties") or {}
            out.append((idx.points[int(i)], props.get("name") or cat))
    return out
