"""Generic scanner driven entirely by sites/<slug>/site.yaml.

http:  list_url_template + selectors (CSS, `selector@attr` for attributes, `@attr` on the item)
api:   api.endpoint (+ body) + api.items_path (dot path) + field_map (json path → ListingIn field)
Field parsers are chosen by target field name (rent → int, rooms → rok + sovalkov, pets → status).
"""
from __future__ import annotations

import string
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlencode, urljoin

import httpx
from selectolax.lexbor import LexborHTMLParser as HTMLParser
from selectolax.lexbor import LexborNode as Node

from findhome.config.models import SiteConfig
from findhome.core.paths import data_dir
from findhome.domain.models import ListingIn, SourceIn
from findhome.domain.normalize import contract_type_from_text, parse_int, parse_number, parse_rooms
from findhome.scanning.base import Query, RawItem

INT_FIELDS = {"rent_sek", "deposit_sek", "floor", "build_year", "price_sek", "avgift_sek", "drift_sek",
              "max_duration_months"}
NUM_FIELDS = {"size_m2", "lat", "lon"}
LIST_FIELDS = {"photo_urls", "floorplan_urls"}


def dig(data: Any, path: str | None) -> Any:
    if not path:
        return data
    for part in path.split("."):
        if data is None:
            return None
        data = data[int(part)] if isinstance(data, list) and part.isdigit() else (data or {}).get(part)
    return data


def select(node: Node, spec: str | None) -> str | None:
    if not spec:
        return None
    css, _, attr = spec.partition("@")
    target = node.css_first(css) if css else node
    if target is None:
        return None
    return (target.attributes.get(attr) if attr else target.text(strip=True)) or None


def build_listing(site: SiteConfig, values: dict[str, Any], page_url: str, snapshot: str | None) -> ListingIn:
    fields: dict[str, Any] = {}
    for key, raw in values.items():
        if raw in (None, ""):
            continue
        if key in INT_FIELDS:
            fields[key] = parse_int(raw)
        elif key in NUM_FIELDS:
            fields[key] = parse_number(raw)
        elif key in ("rooms", "rooms_rok"):
            fields["rooms_rok"], sov = parse_rooms(str(raw))
            if sov:
                fields["has_sovalkov"] = True
        elif key in ("pets", "pet_text"):      # the site's own pet wording; judged at ingest (findhome.pets)
            fields.setdefault("attributes", {})["pets_text"] = str(raw)
        elif key in ("contract", "contract_text"):
            fields["contract_type"] = contract_type_from_text(str(raw)) or "unknown"
        elif key in LIST_FIELDS:
            fields[key] = raw if isinstance(raw, list) else [raw]
        elif key in ("external_id", "url"):
            continue
        else:
            fields[key] = raw
    fields = {k: v for k, v in fields.items() if v is not None}
    url = values.get("url")
    if url:
        url = urljoin(page_url, str(url))
    ext = str(values.get("external_id") or url or "")
    if not ext:
        raise ValueError("item has neither external_id nor url")
    if "description_excerpt" in fields:
        fields["description_excerpt"] = str(fields["description_excerpt"])[:1200]
    kind = site.kinds[0]
    return ListingIn(source=SourceIn(site_slug=site.slug, external_id=ext, url=url, method="script",
                                     raw_snapshot_path=snapshot), listing_kind=kind, **fields)


class HttpListScanner:
    def __init__(self, site: SiteConfig, client: httpx.AsyncClient | None = None, save_raw: bool = True):
        self.site = site
        self.slug = site.slug
        self.method = site.fetch.get("method") or "http"
        ua = site.politeness.get("user_agent") or "findhome/0.1 (personal use)"
        self.client = client or httpx.AsyncClient(timeout=30, follow_redirects=True, headers={"User-Agent": ua})
        self.save_raw = save_raw
        self.stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")

    def build_queries(self, params: dict[str, Any], max_pages: int) -> list[Query]:
        f = self.site.fetch
        pag = f.get("pagination") or {"type": "none"}
        pages = max(1, min(max_pages, pag.get("max_pages") or 1)) if pag.get("type") != "none" else 1
        queries = []
        for page in range(1, pages + 1):
            p = dict(params)
            if pag.get("type") == "page_param" and pag.get("param"):
                p[pag["param"]] = page
            elif pag.get("type") == "offset_param" and pag.get("param"):
                p[pag["param"]] = (page - 1) * int(pag.get("page_size", 20))
            if self.method == "api":
                api = f.get("api") or {}
                base = api.get("endpoint")
                if api.get("method") == "POST":
                    queries.append(Query(base, page, "POST", {**(api.get("body") or {}), **p}))
                else:
                    queries.append(Query(f"{base}?{urlencode(p)}" if p else base, page))
            else:
                tmpl = f.get("list_url_template")
                if not tmpl:
                    raise ValueError(f"{self.slug}: fetch.list_url_template is not set")
                names = {n for _, n, _, _ in string.Formatter().parse(tmpl) if n}
                if names:
                    url = tmpl.format(**{n: p.pop(n, "") for n in names})
                    url = f"{url}{'&' if '?' in url else '?'}{urlencode(p)}" if p else url
                else:
                    url = f"{tmpl}{'&' if '?' in tmpl else '?'}{urlencode(p)}" if p else tmpl
                queries.append(Query(url, page))
        return queries

    def _snapshot(self, page: int, text: str, ext: str) -> str | None:
        if not self.save_raw:
            return None
        path: Path = data_dir() / "raw" / self.slug / self.stamp / f"page-{page}.{ext}"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return str(path.relative_to(data_dir().parent))

    async def fetch(self, q: Query) -> list[RawItem]:
        resp = await (self.client.post(q.url, json=q.body) if q.method == "POST" else self.client.get(q.url))
        resp.raise_for_status()
        if self.method == "api":
            snap = self._snapshot(q.page, resp.text, "json")
            items = dig(resp.json(), (self.site.fetch.get("api") or {}).get("items_path")) or []
            return [RawItem(it, q.url, snap) for it in items]
        snap = self._snapshot(q.page, resp.text, "html")
        sel = (self.site.fetch.get("selectors") or {}).get("item")
        if not sel:
            raise ValueError(f"{self.slug}: fetch.selectors.item is not set")
        return [RawItem(n, q.url, snap) for n in HTMLParser(resp.text).css(sel)]

    def parse(self, raw: RawItem) -> ListingIn:
        if self.method == "api":
            fmap = self.site.field_map or {}
            values = {target: dig(raw.data, src if isinstance(src, str) else src.get("from"))
                      for target, src in fmap.items()}
        else:
            values = {k: select(raw.data, v) for k, v in (self.site.fetch.get("selectors") or {}).items() if k != "item"}
        return build_listing(self.site, values, raw.page_url, raw.snapshot_path)
