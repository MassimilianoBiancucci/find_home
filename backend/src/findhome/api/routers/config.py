"""Config files: read, patch (comment-preserving), replace text, validate, schemas."""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from findhome.config import writer
from findhome.config.loader import CONFIG_FILES, read_yaml, validate_all
from findhome.config.store import get_store

router = APIRouter(prefix="/api/config", tags=["config"])


class PatchBody(BaseModel):
    ops: list[dict[str, Any]]


class TextBody(BaseModel):
    text: str


def _check(name: str) -> None:
    if name not in CONFIG_FILES:
        raise HTTPException(404, f"unknown config '{name}'")


@router.get("")
async def status():
    store = get_store()
    b = store.bundle
    return {"files": list(CONFIG_FILES), "config_hash": b.config_hash if b else None,
            "errors": store.last_errors, "sites": sorted(b.sites) if b else []}


@router.post("/validate")
async def validate():
    errors = validate_all(get_store().cdir, get_store().sdir)
    return {"valid": not errors, "errors": errors}


@router.get("/schemas/{name}")
async def schema(name: str):
    path = get_store().cdir / "schemas" / f"{name}.schema.json"
    if not path.exists():
        raise HTTPException(404, f"no schema '{name}'")
    return json.loads(path.read_text(encoding="utf-8"))


@router.get("/{name}")
async def read(name: str):
    _check(name)
    path = get_store().cdir / f"{name}.yaml"
    return {"name": name, "data": read_yaml(path), "text": path.read_text(encoding="utf-8")}


@router.patch("/{name}")
async def patch(name: str, body: PatchBody):
    _check(name)
    text = writer.apply_ops(name, body.ops, get_store().cdir, get_store().sdir)
    get_store().reload()
    return {"name": name, "text": text, "config_hash": get_store().get().config_hash}


@router.put("/{name}")
async def replace(name: str, body: TextBody):
    _check(name)
    writer.write_text(name, body.text, get_store().cdir, get_store().sdir)
    get_store().reload()
    return {"name": name, "config_hash": get_store().get().config_hash}
