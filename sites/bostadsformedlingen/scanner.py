"""Bostadsförmedlingen Stockholm scanner (sites/bostadsformedlingen). Loaded by findhome.scanning.runner.

The public list of available apartments (https://bostad.stockholm.se/bostad/) is filled in the browser from one
JSON feed, GET /AllaAnnonser/: the whole region in one response (a few hundred listings), no pagination. So a scan
is ONE request; filters are applied locally (site.yaml `local_filter`, then the score's hard filters).

The feed carries no move-in date, photos, floor plans, contract terms or description. `enrich` reads the listing
page (/bostad/<id>/) of every listing that passes the hard filters and lacks page data (the runner decides which,
fetch.details), with the politeness delay, and `parse_page` takes from it: move-in ("Inflytt"), contract start and
terms (short-term ads), photos, floor plans (links whose text says "planritning"), amenities, requirements, the
description, and on a project ad (several flats in one ad) one unit per flat. The page is the server's Swedish HTML.
"""
from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urljoin

from selectolax.lexbor import LexborHTMLParser as HTMLParser

from findhome.config.models import SiteConfig
from findhome.domain.models import DESCRIPTION_MAX, ListingIn, SourceIn
from findhome.scanning.base import Query, RawItem
from findhome.scanning.floorplans import classify_floorplan
from findhome.scanning.generic import HttpListScanner

BASE = "https://bostad.stockholm.se"
FEED = f"{BASE}/AllaAnnonser/"
TYPE_FLAGS = ("Vanlig", "Nyproduktion", "Korttid", "Student", "Ungdom", "Senior", "BostadSnabbt", "KortKotid",
              "Familjelagenhet", "Hyresradhus", "KompisUngdom")
DATE = re.compile(r"\d{4}-\d{2}-\d{2}")
MONTHS = re.compile(r"(\d+)\s*(månader|månad|mån|år)", re.IGNORECASE)
LABELLED = re.compile(r"([A-ZÅÄÖ][\wåäö ]{2,40}):\s*(.+?)(?=\s[A-ZÅÄÖ][\wåäö ]{2,40}:|$)")
PLAN = re.compile(r"planritning", re.IGNORECASE)
FLOOR = re.compile(r"^(-?\d+)\s*tr", re.IGNORECASE)


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
    rooms = _num(doc.get("AntalRum")) or _num(doc.get("LagstaAntalRum"))
    attrs: dict[str, Any] = {k: doc.get(k) for k in ("Kommun", "Stadsdel", "Lagenhetstyp", "AnnonsId", "Ko", "KoNamn")
                             if doc.get(k) not in (None, "")}
    attrs["type_flags"] = flags
    if doc.get("AnnonseradFran"):
        attrs["publishedAt"] = doc["AnnonseradFran"]
    if doc.get("AnnonseradTill"):
        attrs["apply_by"] = doc["AnnonseradTill"]
    if doc.get("LiknadeLagenhetStatistik"):
        attrs["queue_hint"] = doc["LiknadeLagenhetStatistik"]
    # a project ad (several flats in one ad) gives ranges instead of Hyra / Yta: keep the lowest, so the hard filters
    # let the cheapest flat through, and the ranges for the page
    if (doc.get("Antal") or 1) > 1:
        attrs["ranges"] = {k: [_num(doc.get(f"Lagsta{f}")), _num(doc.get(f"Hogsta{f}"))]
                           for k, f in (("rent", "Hyran"), ("size_m2", "Ytan"), ("rooms", "AntalRum"))}
        attrs["ranges"]["units"] = doc["Antal"]
    rent = _num(doc.get("Hyra")) or _num(doc.get("LagstaHyran"))
    title_bits = [f"{int(rooms)} rum" if rooms else None, street, doc.get("Stadsdel")]
    return ListingIn(
        source=SourceIn(site_slug=site_slug, external_id=str(ext), url=url, method="script"),
        listing_kind="rent",
        title=" · ".join(b for b in title_bits if b) or None,
        address_raw=", ".join(x for x in (street, kommun) if x) or None,
        area=doc.get("Stadsdel") or kommun,
        lat=_num(doc.get("KoordinatLatitud")),
        lon=_num(doc.get("KoordinatLongitud")),
        size_m2=_num(doc.get("Yta")) or _num(doc.get("LagstaYtan")),
        rooms_rok=rooms,
        floor=int(doc["Vaning"]) if isinstance(doc.get("Vaning"), (int, float)) else None,
        has_elevator=doc.get("Hiss") if isinstance(doc.get("Hiss"), bool) else None,
        has_balcony=doc.get("Balkong") if isinstance(doc.get("Balkong"), bool) else None,
        rent_sek=int(rent) if rent is not None else None,
        contract_type="first_hand",
        attributes=attrs,
    )


def _clean(s: str | None) -> str | None:
    s = " ".join((s or "").split())
    return s or None


def _months(text: str | None) -> int | None:
    """'2 månader ...' -> 2, 'max 4 år' -> 48 (the first number and unit found)."""
    m = MONTHS.search(text or "")
    if not m:
        return None
    n = int(m.group(1))
    return n * 12 if m.group(2).lower() == "år" else n


def _int(text: str | None) -> int | None:
    digits = re.sub(r"\D", "", text or "")
    return int(digits) if digits else None


def _floor(text: str | None) -> int | None:
    """'1tr' -> 1, 'BV' / 'bottenvåning' -> 0."""
    t = (_clean(text) or "").lower()
    if t.startswith(("bv", "botten")):
        return 0
    m = FLOOR.match(t)
    return int(m.group(1)) if m else None


def description_text(html: str) -> str | None:
    node = HTMLParser(html).css_first(".main-body__content")
    if node is None:
        return None
    text = " ".join(node.text(separator=" ").split())
    return text[:DESCRIPTION_MAX] or None


def _units(t: HTMLParser) -> list[dict[str, Any]]:
    """One unit per flat of a project ad (.listing-on-project rows). A row holds the title with the flat number, four
    <strong> without labels (rent, floor, rooms, size), the plan link and "Inflytt: <date>"."""
    units = []
    for row in t.css(".listing-on-project .apartments-of-interest"):
        title = _clean(row.css_first(".apartments-of-interest__title").text()) if row.css_first(
            ".apartments-of-interest__title") else None
        data = [_clean(x.text()) for x in row.css(".apartments-of-interest__data > strong")]
        data += [None] * (4 - len(data))
        link = next((a.attributes.get("href") for a in row.css("a")
                     if a.attributes.get("href") and PLAN.search(a.text() or "")), None)
        state = _clean(row.css_first(".apartment-listing__item__state").text(separator=" ")) if row.css_first(
            ".apartment-listing__item__state") else ""
        move_in = re.search(r"Inflytt:\s*(\d{4}-\d{2}-\d{2})", state or "")
        rooms = re.search(r"(\d+(?:[.,]\d+)?)", data[2] or "")
        size = re.search(r"(\d+(?:[.,]\d+)?)", data[3] or "")
        units.append({k: v for k, v in {
            "label": (title.split("lgh nr:")[-1].strip() if title and "lgh nr:" in title else title),
            "rent_sek": _int(data[0]), "floor": _floor(data[1]),
            "rooms_rok": float(rooms.group(1).replace(",", ".")) if rooms else None,
            "size_m2": float(size.group(1).replace(",", ".")) if size else None,
            "available_from": move_in.group(1) if move_in else None,
            "floorplan_url": urljoin(BASE, link) if link else None}.items() if v is not None})
    return units


def parse_page(html: str) -> dict[str, Any]:
    """The listing page's data. Selectors proven on 35 pages (tasks/improve-site-extraction, note 04) and on a project
    ad (note 07). Keys follow ListingIn and the fixed attribute keys; values the page lacks are left out."""
    t = HTMLParser(html)
    facts: dict[str, str | None] = {}
    for box in t.css(".apartment-facts__text"):
        head = box.next
        while head is not None and (head.tag != "span" or "apartment-facts__heading" not in (head.attributes.get("class") or "")):
            head = head.next
        if head is not None:
            facts[_clean(box.text()) or ""] = _clean(head.text())

    body = t.css_first(".main-body__content")
    labelled: dict[str, str] = {}
    if body is not None:
        for p in body.css("p"):
            for m in LABELLED.finditer(_clean(p.text(separator=" ")) or ""):
                labelled.setdefault(m.group(1).strip(), m.group(2).strip())
    body_text = (_clean(body.text(separator=" ")) or "") if body is not None else ""

    photos: list[str] = []
    for img in t.css(".custom-modal__content img, picture img"):
        src = img.attributes.get("src") or ""
        if src.startswith("/uploads/") and "logotyp" not in src.lower() and urljoin(BASE, src) not in photos:
            photos.append(urljoin(BASE, src))

    units = _units(t)
    plans: list[tuple[str, str | None]] = []
    if units:                                   # a project ad: one plan per flat, tied through its row
        plans = [(u["floorplan_url"], u.get("label")) for u in units if u.get("floorplan_url")]
    else:                                       # links whose own text says so; an example image is not a plan
        for a in t.css("a"):
            href = a.attributes.get("href")
            if href and PLAN.search(f"{a.text() or ''} {a.attributes.get('aria-label') or ''}"):
                url = urljoin(BASE, href)
                if url not in [p for p, _ in plans]:
                    plans.append((url, None))

    amenities: list[str] = []
    for box in t.css(".tag-list"):
        h = box.css_first("h2")
        if h is not None and _clean(h.text()) == "Egenskaper":
            amenities = [x for x in (_clean(li.text()) for li in box.css("li")) if x]
    page_text = _clean(t.body.text(separator=" ")) if t.body else ""
    if re.search(r"\bRökfri(tt)?\b", page_text or "") and "Rökfritt" not in amenities:
        amenities.append("Rökfritt")
    income = re.search(r"Lägsta årsinkomst:\s*([\d\s]+)\s*kronor", page_text or "")
    household = re.search(r"Max antal hushållsmedlemmar:\s*(\d+)", page_text or "")

    move_in = facts.get("Inflytt")
    if not move_in and units:
        move_in = min((u["available_from"] for u in units if u.get("available_from")), default=None)
    guaranteed = labelled.get("Garanterad boendetid")
    notice = labelled.get("Uppsägningstid")
    extension = labelled.get("Möjlighet till förlängning")
    terms = {k: v for k, v in {
        "guaranteed_raw": guaranteed, "guaranteed_months": _months(guaranteed),
        "notice_raw": notice, "notice_months": _months(notice),
        "extension_raw": extension,
        "max_total_months": _months(extension.split("max")[-1]) if extension and "max" in extension else None,
        # only the listing's own text: the site menu also says "Korttidskontrakt"
        "short_term": True if "det här är ett korttidskontrakt" in body_text.lower() else None,
    }.items() if v is not None}
    start = re.search(r"\bFrån:\s*(\d{4}-\d{2}-\d{2})", body_text)    # "Boendetid: Från: 2027-01-18"
    requirements = {k: v for k, v in {
        "min_income_sek": _int(income.group(1)) if income else None,
        "max_household": int(household.group(1)) if household else None}.items() if v is not None}
    return {
        "available_from": move_in if move_in and DATE.fullmatch(move_in) else None,
        "move_in_raw": move_in,
        "contract_start": start.group(1) if start else None,
        "apply_by": facts.get("Anmälan senast"),
        "contract_terms": terms,
        "photo_urls": photos,
        "floorplans": plans,
        "amenities": amenities,
        "requirements": requirements,
        "description": body_text[:DESCRIPTION_MAX] or None,
        "units": units,
    }


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

    async def enrich(self, item: ListingIn, known_plans: list[dict[str, Any]] | None = None) -> ListingIn:
        """Read the listing page into the item. `known_plans` (the stored attributes.floorplans) keeps each floor plan
        link classified once."""
        if not item.source.url:
            return item
        resp = await self.client.get(item.source.url)
        resp.raise_for_status()
        self._save_page(item.source.external_id, resp.text)
        page = parse_page(resp.text)
        plans = [await classify_floorplan(self.client, url, known_plans, unit) for url, unit in page["floorplans"]]
        update: dict[str, Any] = {k: page[k] for k in ("available_from", "contract_start") if page[k]}
        if page["description"]:
            update["description_excerpt"] = page["description"]
        if page["photo_urls"]:
            update["photo_urls"] = page["photo_urls"]
        if plans:
            update["floorplan_urls"] = [p["url"] for p in plans]
        attrs = {**item.attributes, "details_checked_at": datetime.now(UTC).isoformat(timespec="seconds")}
        for key in ("contract_terms", "amenities", "requirements", "units"):
            if page[key]:
                attrs[key] = page[key]
        if plans:
            attrs["floorplans"] = plans
        if page["move_in_raw"]:
            attrs["move_in_raw"] = page["move_in_raw"]
        if page["apply_by"] and not attrs.get("apply_by"):
            attrs["apply_by"] = page["apply_by"]
        if page["photo_urls"]:
            attrs["photo_count"] = len(page["photo_urls"])
        update["attributes"] = attrs
        return ListingIn.model_validate({**item.model_dump(), **update})

    def _save_page(self, external_id: str, html: str) -> None:
        """Keep the page next to the feed snapshot, so an audit or a repair can re-parse it without a request."""
        if not self.save_raw:
            return
        # the base scanner's data_dir, where the feed snapshot goes too
        from findhome.scanning import generic

        path = generic.data_dir() / "raw" / self.slug / self.stamp / "pages" / f"{external_id}.html"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(html, encoding="utf-8")


def make_scanner(site: SiteConfig) -> BostadsformedlingenScanner:
    return BostadsformedlingenScanner(site)
