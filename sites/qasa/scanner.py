"""Qasa scanner (sites/qasa). Loaded by findhome.scanning.runner.make_scanner and by
`findhome ingest listings --parser qasa` (to_listing).

NOTE: qasa.com answers scripted HTTP clients with 429 (bot protection), so site.yaml uses
fetch.method agent_browser: the agent opens result pages in the user's browser, runs
extract.js on the loaded page and ingests the output through to_listing(). The HTTP scanner
below is kept for the day scripted access works (or is permitted) again.

Qasa (qasa.com, which also carries Blocket Bostad listings) renders its search pages on the
server. Each result page embeds the search result as Apollo SSR data:

    <script>(window[Symbol.for("ApolloSSRDataTransport")] ??= []).push({"rehydrate": {...}})</script>

where one entry holds data.homeIndexSearch.documents = {nodes: [HomeDocument...], totalCount,
pagesCount, hasNextPage}. The argument is a JS object literal (it contains `undefined`), so we
turn `:undefined` into `:null` before json.loads. One request gives ~59 fully structured
listings: no HTML selectors, no browser.

Listing detail pages (/se/sv/home/<id>) carry floor, building floors, build year and traits
(balcony, elevator, pets ...) in the Next.js flight data; `enrich` reads them for NEW listings
only, capped by fetch.details.max_per_run in site.yaml.
"""
from __future__ import annotations

import json
import re
from typing import Any

from findhome.config.models import SiteConfig
from findhome.domain.models import ListingIn, SourceIn
from findhome.scanning.base import Query, RawItem
from findhome.scanning.generic import HttpListScanner

BASE = "https://qasa.com"
APOLLO_RE = re.compile(r'<script>(\(window\[Symbol\.for\("ApolloSSRDataTransport"\)\][\s\S]*?)</script>')
MAX_UPLOADS = 40                   # per type; search results carry the whole gallery (extract.js keeps the same cap)
HOME_TYPES = {"apartment": "Lägenhet", "terrace_house": "Radhus", "house": "Villa", "villa": "Villa",
              "cottage": "Stuga", "duplex": "Parhus", "corridor": "Korridorsrum", "loft": "Loft"}


def apollo_payloads(html: str) -> list[dict]:
    out = []
    for m in APOLLO_RE.finditer(html):
        body = m.group(1)
        start, end = body.find(".push(") + len(".push("), body.rfind(")")
        if start < len(".push(") or end <= start:
            continue
        try:
            out.append(json.loads(re.sub(r":\s*undefined\b", ":null", body[start:end])))
        except json.JSONDecodeError:
            continue
    return out


def search_documents(html: str) -> tuple[list[dict], dict]:
    """All HomeDocument nodes on a search page plus paging meta (totalCount, pagesCount, hasNextPage)."""
    nodes, meta, seen = [], {}, set()
    for payload in apollo_payloads(html):
        for entry in (payload.get("rehydrate") or {}).values():
            docs = ((entry or {}).get("data") or {}).get("homeIndexSearch", {}) or {}
            docs = docs.get("documents") if isinstance(docs, dict) else None
            if not docs:
                continue
            meta = {k: docs.get(k) for k in ("totalCount", "pagesCount", "hasNextPage")}
            for node in docs.get("nodes") or []:
                if node.get("id") not in seen:
                    seen.add(node.get("id"))
                    nodes.append(node)
    return nodes, meta


def _date(value: str | None) -> str | None:
    return value[:10] if value else None


def document_to_listing(doc: dict, site_slug: str = "qasa") -> ListingIn:
    loc = doc.get("location") or {}
    point = loc.get("point") or {}
    street = " ".join(str(x) for x in (loc.get("route"), loc.get("streetNumber")) if x)
    address = ", ".join(x for x in (street, loc.get("locality")) if x) or None
    uploads = sorted(doc.get("uploads") or [], key=lambda u: u.get("order") or 0)
    photos = [u["url"] for u in uploads if u.get("type") == "home_picture" and u.get("url")][:MAX_UPLOADS]
    plans = [u["url"] for u in uploads if u.get("type") == "home_layout_picture" and u.get("url")][:MAX_UPLOADS]
    pets = doc.get("petsAllowed")
    if doc.get("shared"):
        contract = "sublet"
    else:
        contract = "first_hand" if doc.get("firstHand") else "second_hand"
    home_type = doc.get("homeType")
    title = doc.get("title") or f"{HOME_TYPES.get(home_type, home_type or 'Bostad')} - {address or ''}".strip(" -")
    attrs = {k: doc.get(k) for k in ("rent", "tenantBaseFee", "bedroomCount", "homeType", "platform", "householdSize",
                                    "smokingAllowed", "wheelchairAccessible", "studentHome", "seniorHome",
                                    "corporateHome", "instantSign", "publishedAt") if doc.get(k) is not None}
    attrs["qasa_pets_allowed"] = pets
    attrs["photo_count"] = len(photos)     # tells the UI the gallery is complete (older scans kept only 6)
    if doc.get("endDate") is None:
        attrs["open_ended"] = True     # "Tillsvidare"
    return ListingIn(
        source=SourceIn(site_slug=site_slug, external_id=str(doc["id"]), url=f"{BASE}/se/sv/home/{doc['id']}",
                        method="script"),
        listing_kind="rent",
        title=title,
        address_raw=address,
        area=loc.get("locality"),
        lat=point.get("lat"),
        lon=point.get("lon"),
        size_m2=doc.get("squareMeters"),
        rooms_rok=doc.get("roomCount"),
        furnished=doc.get("furnished"),
        rent_sek=doc.get("monthlyCost") or doc.get("rent"),
        contract_type=contract,
        contract_start=_date(doc.get("startDate")),
        contract_end=_date(doc.get("endDate")),
        available_from=_date(doc.get("startDate")),
        # Qasa sets petsAllowed from the landlord's house rules. False is not proof of "no pets"
        # (it is also the default), so it stays "unknown" and the agent asks.
        pet_status="yes" if pets is True else "unknown",
        pet_evidence="Qasa house rules: pets allowed (petsAllowed=true)" if pets is True else None,
        description_excerpt=(doc.get("description") or "")[:1200] or None,
        photo_urls=photos,
        floorplan_urls=plans,
        attributes=attrs,
    )


def detail_facts(html: str, home_id: str) -> dict[str, Any]:
    """floor, building floors, build year and trait list of one listing from its detail page."""
    text = html.replace('\\"', '"')
    start = text.find(f'"__typename":"Home","id":"{home_id}"')
    if start < 0:
        return {}
    nxt = text.find('"__typename":"Home","id":"', start + 30)
    block = text[start: nxt if nxt > 0 else start + 60000]
    facts: dict[str, Any] = {}
    for key in ("floor", "buildingFloors", "buildYear"):
        m = re.search(rf'"{key}":(\d+)', block)
        if m:
            facts[key] = int(m.group(1))
    traits = sorted(set(re.findall(r'"__typename":"Trait","id":"\d+","detail":(?:null|"[^"]*"),"type":"(\w+)"', block)))
    if traits:
        facts["traits"] = traits
    return facts


class QasaScanner(HttpListScanner):
    """Search pages → HomeDocument dicts → ListingIn. Detail pages only for enrichment."""

    def __init__(self, site: SiteConfig, client=None, save_raw: bool = True):
        super().__init__(site, client=client, save_raw=save_raw)
        self.method = "http"

    async def fetch(self, q: Query) -> list[RawItem]:
        resp = await self.client.get(q.url)
        resp.raise_for_status()
        snap = self._snapshot(q.page, resp.text, "html")
        nodes, _meta = search_documents(resp.text)
        return [RawItem(n, q.url, snap) for n in nodes]

    def parse(self, raw: RawItem) -> ListingIn:
        item = document_to_listing(raw.data, self.site.slug)
        item.source.raw_snapshot_path = raw.snapshot_path
        return item

    async def enrich(self, item: ListingIn) -> ListingIn:
        resp = await self.client.get(item.source.url)
        resp.raise_for_status()
        facts = detail_facts(resp.text, item.source.external_id)
        traits = set(facts.get("traits", []))
        update: dict[str, Any] = {"attributes": {**item.attributes, "qasa_traits": sorted(traits)}}
        if "floor" in facts:
            update["floor"] = facts["floor"]
        if "buildYear" in facts:
            update["build_year"] = facts["buildYear"]
        if "buildingFloors" in facts:
            update["attributes"]["building_floors"] = facts["buildingFloors"]
        update["has_balcony"] = bool(traits & {"balcony", "french_balcony", "patio"}) if traits else None
        update["has_elevator"] = ("elevator" in traits) if traits else None
        if "pets" in traits and item.pet_status != "yes":
            update["pet_status"], update["pet_evidence"] = "yes", "Qasa listing traits include 'pets'"
        return item.model_copy(update=update)


def to_listing(raw: dict) -> ListingIn:
    """Entry point for `findhome ingest listings --parser qasa` (raw docs from extract.js)."""
    item = document_to_listing(raw)
    item.source.method = "agent_browser"
    return item


def make_scanner(site: SiteConfig) -> QasaScanner:
    return QasaScanner(site)
