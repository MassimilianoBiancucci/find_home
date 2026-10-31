"""POIs for the map and the test point (probe) inspector; saved test points are an alpha feature."""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from findhome.api.state import bundle, registry
from findhome.core.db import get_conn
from findhome.domain.commute import resolve_point_coords
from findhome.domain.probe import probe
from findhome.geo.build_poi import poi_dir
from findhome.geo.store import read_geojson

router = APIRouter(prefix="/api", tags=["poi & test points"])


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


class ProbeIn(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    trips: bool = True


@router.post("/probe")
async def run_probe(body: ProbeIn, conn=Depends(get_conn)):
    b, reg = bundle(), registry()
    coords = await resolve_point_coords(conn, reg, b.locations.points, int(b.providers.cache.get("geocode_ttl_days", 365)))
    return await probe(conn, reg, b, body.lat, body.lon, coords, with_trips=body.trips)


# ── alpha: saved test points ────────────────────────────────
class SavedProbeIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    note: str | None = Field(default=None, max_length=500)


class SavedProbePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    note: str | None = Field(default=None, max_length=500)


@router.get("/probes")
async def list_probes(conn=Depends(get_conn)):
    rows = await (await conn.execute("SELECT id, name, lat, lon, note, created_at FROM probes ORDER BY created_at")).fetchall()
    return [{**r, "id": str(r["id"])} for r in rows]


@router.post("/probes", status_code=201)
async def save_probe(body: SavedProbeIn, conn=Depends(get_conn)):
    row = await (await conn.execute(
        "INSERT INTO probes (name, lat, lon, note) VALUES (%s, %s, %s, %s) RETURNING id, name, lat, lon, note, created_at",
        (body.name, body.lat, body.lon, body.note))).fetchone()
    return {**row, "id": str(row["id"])}


@router.patch("/probes/{probe_id}")
async def update_probe(probe_id: UUID, body: SavedProbePatch, conn=Depends(get_conn)):
    row = await (await conn.execute(
        """UPDATE probes SET name = COALESCE(%s, name), note = COALESCE(%s, note) WHERE id = %s
           RETURNING id, name, lat, lon, note, created_at""", (body.name, body.note, probe_id))).fetchone()
    if row is None:
        raise HTTPException(404, "test point not found")
    return {**row, "id": str(row["id"])}


@router.delete("/probes/{probe_id}", status_code=204)
async def delete_probe(probe_id: UUID, conn=Depends(get_conn)):
    cur = await conn.execute("DELETE FROM probes WHERE id = %s", (probe_id,))
    if cur.rowcount == 0:
        raise HTTPException(404, "test point not found")
