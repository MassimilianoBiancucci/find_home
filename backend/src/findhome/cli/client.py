"""Tiny HTTP client for the local API with readable errors."""
from __future__ import annotations

from typing import Any

import httpx
import typer

from findhome.core.settings import get_settings


class Api:
    def __init__(self, base: str | None = None):
        self.base = (base or get_settings().api_base).rstrip("/")
        self.http = httpx.Client(base_url=self.base, timeout=httpx.Timeout(600, connect=5))

    def _do(self, method: str, path: str, **kw) -> Any:
        try:
            resp = self.http.request(method, path, **kw)
        except httpx.ConnectError:
            typer.secho(f"backend not running at {self.base}: start 'FH: Full Stack' in VS Code or run "
                        "'findhome serve' (Postgres must be up: docker compose up -d --wait)", fg="red", err=True)
            raise typer.Exit(2) from None
        if resp.status_code >= 400:
            try:
                detail = resp.json()
            except ValueError:
                detail = resp.text
            if isinstance(detail, dict) and "errors" in detail:
                detail = "\n  ".join([detail.get("detail", "")] + detail["errors"])
            elif isinstance(detail, dict):
                detail = detail.get("detail", detail)
            typer.secho(f"API {resp.status_code}: {detail}", fg="red", err=True)
            raise typer.Exit(1)
        if resp.headers.get("content-type", "").startswith("application/json"):
            return resp.json()
        return resp.text

    def get(self, path: str, **params) -> Any:
        return self._do("GET", path, params={k: v for k, v in params.items() if v is not None})

    def post(self, path: str, json: Any = None) -> Any:
        return self._do("POST", path, json=json)

    def patch(self, path: str, json: Any = None) -> Any:
        return self._do("PATCH", path, json=json)
