"""POIs for the map (categories and features). The test points (probe) that used to live here were removed."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from findhome.api.state import bundle
from findhome.geo.build_poi import poi_dir
from findhome.geo.store import read_geojson

router = APIRouter(prefix="/api", tags=["poi"])


@router.get("/geo/poi/categories")
async def poi_categories():
    b = bundle()
    return [{"key": k, "label": c.label, "icon": c.icon, "color": c.color, "max_walk_min": c.max_walk_min,
             "fetched": (poi_dir() / f"{k}.geojson").exists()} for k, c in b.poi.categories.items()]


@router.get("/geo/poi")
async def poi(categories: str = Query(..., description="comma separated poi.yaml keys")):
    b = bundle()
    feats = []
    for key in [c for c in categories.split(",") if c]:
        if key not in b.poi.categories:
            raise HTTPException(404, f"unknown POI category '{key}'")
        p = poi_dir() / f"{key}.geojson"
        if p.exists():
            feats += read_geojson(p)["features"]
    return {"type": "FeatureCollection", "features": feats}
