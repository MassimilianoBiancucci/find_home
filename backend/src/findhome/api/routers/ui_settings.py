"""UI preferences stored in the database (e.g. `candidates.columns`, `candidates.views`): survive clearing the
browser. A plain key → JSON store; the keys and shapes are the frontend's (pages/candidate-columns.ts)."""
from __future__ import annotations

import json
import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from psycopg.types.json import Jsonb

from findhome.core.db import get_conn

router = APIRouter(prefix="/api/ui-settings", tags=["ui"])
KEY = re.compile(r"^[a-z][a-z0-9_.-]{1,80}$")
MAX_BYTES = 200_000


def _key(key: str) -> str:
    if not KEY.match(key):
        raise HTTPException(422, "key: lowercase letters, digits, '.', '_' or '-', at most 80 characters")
    return key


@router.get("/{key}")
async def get_setting(key: str, conn=Depends(get_conn)):
    row = await (await conn.execute("SELECT value, updated_at FROM ui_settings WHERE key = %s", (_key(key),))).fetchone()
    return {"key": key, "value": row["value"] if row else None, "updated_at": row["updated_at"] if row else None}


@router.put("/{key}")
async def put_setting(key: str, body: dict[str, Any], conn=Depends(get_conn)):
    """Body: {"value": <any JSON>}; a null value deletes the key."""
    _key(key)
    value = body.get("value")
    if value is None:
        await conn.execute("DELETE FROM ui_settings WHERE key = %s", (key,))
        return {"key": key, "value": None}
    if len(json.dumps(value)) > MAX_BYTES:
        raise HTTPException(413, "value too large")
    await conn.execute("""INSERT INTO ui_settings (key, value) VALUES (%s, %s)
                          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()""",
                       (key, Jsonb(value)))
    return {"key": key, "value": value}
