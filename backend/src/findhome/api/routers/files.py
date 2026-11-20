"""Files the app keeps for listings: the PNG previews of PDF floor plans (data/floorplans/)."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from findhome.scanning.floorplans import preview_path

router = APIRouter(prefix="/api", tags=["files"])


@router.get("/floorplans/{name}.png")
async def floorplan_preview(name: str):
    """The cached first page of a PDF floor plan; `name` is the sha1 stored in attributes.floorplans[].preview."""
    path = preview_path(name)
    if path is None or not path.is_file():
        raise HTTPException(404, "no such floor plan preview")
    return FileResponse(path, media_type="image/png", headers={"Cache-Control": "public, max-age=31536000, immutable"})
