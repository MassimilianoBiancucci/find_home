"""GeoJSON for the map: configured points (geocoded, cached) and scored listings."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from findhome.api.state import bundle, registry
from findhome.core.db import get_conn
from findhome.domain.commute import resolve_point_coords

router = APIRouter(prefix="/api/map", tags=["map"])


@router.get("/settings")
async def settings():
    return bundle().providers.map


@router.get("/points")
async def points(conn=Depends(get_conn)):
    b = bundle()
    coords = await resolve_point_coords(conn, registry(), b.locations.points)
    feats = []
    for p in b.locations.points:
        c = coords.get(p.id)
        cat = b.locations.categories.get(p.category)
        props = {"id": p.id, "label": p.label, "category": p.category, "color": cat.color if cat else None,
                 "icon": cat.icon if cat else None, "weight": b.locations.effective_weight(p), "notes": p.notes,
                 "geocoded": c is not None}
        feats.append({"type": "Feature", "properties": props,
                      "geometry": {"type": "Point", "coordinates": [c.lon, c.lat]} if c else None})
    return {"type": "FeatureCollection", "features": feats}


@router.get("/listings")
async def listings(conn=Depends(get_conn)):
    b = bundle()
    rows = await (await conn.execute(
        """SELECT l.short_id, l.lat, l.lon, l.status, l.rent_sek, l.rooms_rok, l.size_m2, l.pet_status, l.area,
                  s.total AS score, s.rejected_by
           FROM listings l LEFT JOIN scores s ON s.listing_id = l.id AND s.config_hash = %s
           WHERE l.lat IS NOT NULL AND l.status <> 'archived'""", (b.config_hash,))).fetchall()
    feats = [{"type": "Feature", "geometry": {"type": "Point", "coordinates": [r["lon"], r["lat"]]},
              "properties": {k: (float(v) if k in ("score", "rooms_rok", "size_m2") and v is not None else v)
                             for k, v in r.items() if k not in ("lat", "lon")}} for r in rows]
    return {"type": "FeatureCollection", "features": feats}
