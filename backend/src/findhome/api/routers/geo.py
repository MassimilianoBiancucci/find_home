"""Zones, the search area and its function: data for the Area mode, the inspector and the CLI."""
from __future__ import annotations

from typing import Any

import shapely
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from shapely.geometry import LineString, mapping, shape
from shapely.ops import unary_union

from findhome.api.state import bundle
from findhome.core.db import get_conn
from findhome.geo.area import area_eval, compiled_for, outline_geojson
from findhome.geo.crs import to_metric, to_wgs84
from findhome.geo.store import load_zones, zones_path

router = APIRouter(prefix="/api", tags=["geo & area"])


class LatLonIn(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


class EvalBody(BaseModel):
    points: list[LatLonIn] = Field(max_length=500)


class BrushBody(BaseModel):
    stroke: list[tuple[float, float]] = Field(min_length=1, max_length=5000)   # [lon, lat]
    radius_m: float = Field(gt=5, le=5000)
    base: dict[str, Any] | None = None          # GeoJSON polygon to add to / erase from
    mode: str = Field(default="add", pattern="^(add|erase)$")


def _zones_or_404():
    zones = load_zones()
    if zones is None:
        raise HTTPException(404, "zones not built yet: run `findhome geo fetch zones`")
    return zones


@router.get("/geo/zones")
async def zones(request: Request):
    zs = _zones_or_404()
    etag = f'"{int(zs.mtime)}"'
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304)
    return Response(zones_path().read_bytes(), media_type="application/geo+json", headers={"ETag": etag})


@router.get("/geo/attribution")
async def attribution():
    return {"items": bundle().geo.attribution}


def _area():
    return compiled_for(bundle().raw.get("search_area"))


@router.get("/area")
async def area(conn=Depends(get_conn)):
    """Pieces, the compiled outline and how many listings fall inside, near (within the buffer) or outside."""
    b, a = bundle(), _area()
    stats = {"inside": 0, "near": 0, "outside": 0, "unknown": 0}
    if a.defined:
        rows = await (await conn.execute(
            "SELECT lat, lon FROM listings WHERE status <> 'archived'")).fetchall()
        for r in rows:
            if r["lat"] is None:
                stats["unknown"] += 1
                continue
            res = area_eval(a, float(r["lat"]), float(r["lon"]))
            stats["inside" if res.inside else "near" if res.score > 0 else "outside"] += 1
    return {"config_hash": b.config_hash, "buffer_m": a.buffer_m, "pieces": b.raw["search_area"].get("pieces") or [],
            "defined": a.defined, "outline": outline_geojson(a), "missing_zones": a.missing_zones,
            "area_km2": round(a.union.area / 1e6, 2) if a.union is not None else 0, "listings": stats}


@router.get("/area/summary")
async def summary():
    """What an agent needs to stay inside the search area."""
    b, a = bundle(), _area()
    if not a.defined:
        return {"defined": False}
    zones = load_zones()
    pieces = []
    zone_ids: set[str] = set()
    for p in a.pieces:
        ids = p.zones or ([z.id for z in zones.zones.values() if z.geom.intersection(p.geom).area > 0.25 * z.geom.area]
                          if zones else [])
        zone_ids.update(ids)
        pieces.append({"id": p.id, "label": p.label, "weight": p.weight, "kind": p.kind,
                       "zones": [{"id": z, "name": zones.zones[z].name} for z in ids if zones and z in zones.zones]})
    minx, miny, maxx, maxy = to_wgs84(a.union).bounds
    c = to_wgs84(a.union.centroid)
    kommuner = sorted({zones.zones[z].kommun for z in zone_ids if zones and z in zones.zones})
    aliases = sorted(n for n, zs in b.area_aliases.aliases.items() if zs and set(zs) <= zone_ids)
    return {"defined": True, "buffer_m": a.buffer_m, "area_km2": round(a.union.area / 1e6, 2),
            "bbox": [round(minx, 4), round(miny, 4), round(maxx, 4), round(maxy, 4)],
            "centre": [round(c.y, 5), round(c.x, 5)], "pieces": pieces, "kommuner": kommuner, "aliases": aliases}


@router.post("/area/eval")
async def evaluate(body: EvalBody):
    a = _area()
    if not a.defined:
        return {"defined": False, "items": [{"inside": None, "score": None, "distance_m": None, "best_piece": None,
                                              "contributions": [], "zone": None} for _ in body.points]}
    return {"defined": True, "items": [area_eval(a, p.lat, p.lon).as_dict() for p in body.points]}


@router.post("/area/brush")
async def brush(body: BrushBody):
    """A painted stroke as a polygon (buffered in metres), optionally merged into or cut from `base`."""
    line = to_metric(LineString(body.stroke) if len(body.stroke) > 1 else shape({"type": "Point", "coordinates": body.stroke[0]}))
    stroke = line.buffer(body.radius_m, quad_segs=6)
    if body.base:
        base = to_metric(shape(body.base))
        geom = base.difference(stroke) if body.mode == "erase" else unary_union([base, stroke])
    else:
        geom = stroke
    geom = geom.simplify(3)
    if geom.is_empty:
        return {"geometry": None, "area_km2": 0}
    return {"geometry": mapping(shapely.set_precision(to_wgs84(geom), 1e-6)), "area_km2": round(geom.area / 1e6, 3)}
