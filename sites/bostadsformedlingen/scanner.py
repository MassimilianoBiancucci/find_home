"""Bostadsförmedlingen Stockholm scanner (sites/bostadsformedlingen). Loaded by findhome.scanning.runner.

The public list of available apartments (https://bostad.stockholm.se/bostad/) is filled in the browser from one
JSON feed, GET /AllaAnnonser/: the whole region in one response (a few hundred listings), no pagination. So a scan
is ONE request; filters are applied locally (site.yaml `local_filter`, then the score's hard filters).

The feed carries no description and no pet information. For NEW listings that pass the local filter, `enrich`
reads the listing page (/bostad/<id>/), capped by fetch.details.max_per_run with the politeness delay, and keeps
the description text so findhome.pets can judge the pet wording at ingest.
"""
from __future__ import annotations

from typing import Any

from selectolax.lexbor import LexborHTMLParser as HTMLParser

from findhome.config.models import SiteConfig
from findhome.domain.models import ListingIn, SourceIn
from findhome.scanning.base import Query, RawItem
from findhome.scanning.generic import HttpListScanner

BASE = "https://bostad.stockholm.se"
FEED = f"{BASE}/AllaAnnonser/"
TYPE_FLAGS = ("Vanlig", "Nyproduktion", "Korttid", "Student", "Ungdom", "Senior", "BostadSnabbt", "KortKotid",
              "Familjelagenhet", "Hyresradhus", "KompisUngdom")
MAX_DESCRIPTION = 1200


def _num(v: Any) -> float | None:
    try:
        return float(v) if v not in (None, "") else None
    except (TypeError, ValueError):
        return None


def excluded(doc: dict, local_filter: dict) -> str | None:
    """Why a feed item is dropped before ingest (None = keep)."""
    for flag in local_filter.get("exclude_flags") or []:
        if doc.get(flag):
            return f"type {flag}"
    kommuner = local_filter.get("kommuner")
    if kommuner and doc.get("Kommun") not in kommuner:
        return f"kommun {doc.get('Kommun')}"
    return None


def to_listing(doc: dict, site_slug: str = "bostadsformedlingen") -> ListingIn:
    ext = doc.get("LagenhetId") or doc.get("AnnonsId")
    if ext in (None, ""):
        raise ValueError("feed item has no LagenhetId/AnnonsId")
    url = f"{BASE}{doc['Url']}" if doc.get("Url") else None
    street = doc.get("Gatuadress")
    kommun = doc.get("Kommun")
    flags = [f for f in TYPE_FLAGS if doc.get(f)]
    rooms = _num(doc.get("AntalRum"))
    attrs: dict[str, Any] = {k: doc.get(k) for k in ("Kommun", "Stadsdel", "Lagenhetstyp", "AnnonsId", "Ko", "KoNamn")
                             if doc.get(k) not in (None, "")}
    attrs["type_flags"] = flags
    if doc.get("AnnonseradFran"):
        attrs["publishedAt"] = doc["AnnonseradFran"]
    if doc.get("AnnonseradTill"):
        attrs["apply_by"] = doc["AnnonseradTill"]
    if doc.get("LiknadeLagenhetStatistik"):
        attrs["queue_hint"] = doc["LiknadeLagenhetStatistik"]
    title_bits = [f"{int(rooms)} rum" if rooms else None, street, doc.get("Stadsdel")]
    return ListingIn(
        source=SourceIn(site_slug=site_slug, external_id=str(ext), url=url, method="script"),
        listing_kind="rent",
        title=" · ".join(b for b in title_bits if b) or None,
        address_raw=", ".join(x for x in (street, kommun) if x) or None,
        area=doc.get("Stadsdel") or kommun,
        lat=_num(doc.get("KoordinatLatitud")),
        lon=_num(doc.get("KoordinatLongitud")),
        size_m2=_num(doc.get("Yta")),
        rooms_rok=rooms,
        floor=int(doc["Vaning"]) if isinstance(doc.get("Vaning"), (int, float)) else None,
        has_elevator=doc.get("Hiss") if isinstance(doc.get("Hiss"), bool) else None,
        has_balcony=doc.get("Balkong") if isinstance(doc.get("Balkong"), bool) else None,
        rent_sek=int(doc["Hyra"]) if isinstance(doc.get("Hyra"), (int, float)) else None,
        contract_type="first_hand",
        attributes=attrs,
    )


def description_text(html: str) -> str | None:
    node = HTMLParser(html).css_first(".main-body__content")
    if node is None:
        return None
    text = " ".join(node.text(separator=" ").split())
    return text[:MAX_DESCRIPTION] or None


class BostadsformedlingenScanner(HttpListScanner):
    def __init__(self, site: SiteConfig, client=None, save_raw: bool = True):
        super().__init__(site, client=client, save_raw=save_raw)
        self.method = "api"
        self.filtered: dict[str, int] = {}

    def build_queries(self, params: dict[str, Any], max_pages: int) -> list[Query]:
        return [Query(FEED, 1)]                  # the feed is the whole region; filters are local

    async def fetch(self, q: Query) -> list[RawItem]:
        resp = await self.client.get(q.url, headers={"Accept": "application/json"})
        resp.raise_for_status()
        data = resp.json()
        if not isinstance(data, list):
            raise ValueError("AllaAnnonser did not return a JSON list: the feed changed (follow site_repair.md)")
        snap = self._snapshot(q.page, resp.text, "json")
        keep = []
        for doc in data:
            why = excluded(doc, self.site.local_filter or {})
            if why:
                self.filtered[why] = self.filtered.get(why, 0) + 1
            else:
                keep.append(RawItem(doc, q.url, snap))
        return keep

    def parse(self, raw: RawItem) -> ListingIn:
        item = to_listing(raw.data, self.site.slug)
        item.source.raw_snapshot_path = raw.snapshot_path
        return item

    async def enrich(self, item: ListingIn) -> ListingIn:
        if not item.source.url:
            return item
        resp = await self.client.get(item.source.url)
        resp.raise_for_status()
        text = description_text(resp.text)
        return item.model_copy(update={"description_excerpt": text}) if text else item


def make_scanner(site: SiteConfig) -> BostadsformedlingenScanner:
    return BostadsformedlingenScanner(site)
