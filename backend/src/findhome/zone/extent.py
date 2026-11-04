"""Which part of the map one zone analysis looks at: the focus (the zone, optionally with its neighbours) and the
search area around it (focus buffered by the farthest reachable distance, so a station just over the border counts)."""
from __future__ import annotations

from dataclasses import dataclass

from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union

from findhome.geo.store import ZoneSet


@dataclass(frozen=True)
class Extent:
    zone_id: str
    zone_ids: tuple[str, ...]          # the focus zones: the zone first, then its neighbours when asked
    focus: BaseGeometry                # EPSG:3006
    search: BaseGeometry               # focus buffered by the reach
    kommuner: tuple[str, ...]          # municipalities whose network and homes are needed


def neighbours(zones: ZoneSet, zone_id: str) -> list[str]:
    """Zones that touch this one (shared border or a gap under 5 m from simplification)."""
    geom = zones.zones[zone_id].geom
    hits = zones.tree.query(geom.buffer(5), predicate="intersects")
    return [zones.order[int(i)] for i in hits if zones.order[int(i)] != zone_id]


def extent(zones: ZoneSet, zone_id: str, with_neighbours: bool, reach_m: float) -> Extent:
    ids = [zone_id] + (neighbours(zones, zone_id) if with_neighbours else [])
    focus = unary_union([zones.zones[z].geom for z in ids])
    search = focus.buffer(reach_m)
    kommuner = sorted({zones.zones[zones.order[int(i)]].kommun_code for i in zones.tree.query(search, predicate="intersects")})
    return Extent(zone_id, tuple(ids), focus, search, tuple(kommuner))
