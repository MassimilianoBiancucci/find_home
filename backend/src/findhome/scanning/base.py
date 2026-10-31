"""Scanner contract. A scanner turns a site config + resolved filters into ListingIn items.

Scripted methods only (api | http | playwright). `agent_browser` sites are scanned by the
agent following prompts/browser_scan.md and ingested with `findhome ingest --source agent_browser`.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

from findhome.domain.models import ListingIn


@dataclass
class Query:
    url: str
    page: int
    method: str = "GET"
    body: dict | None = None


@dataclass
class RawItem:
    data: Any                      # selectolax Node for html, dict for api
    page_url: str
    snapshot_path: str | None = None


@dataclass
class ScanStats:
    pages: int = 0
    items: int = 0
    parsed: int = 0
    parse_errors: int = 0
    errors: list[str] = field(default_factory=list)


class Scanner(Protocol):
    slug: str
    method: str

    def build_queries(self, params: dict[str, Any], max_pages: int) -> list[Query]: ...
    async def fetch(self, q: Query) -> list[RawItem]: ...
    def parse(self, raw: RawItem) -> ListingIn: ...
