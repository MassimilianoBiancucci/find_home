"""Samtrygg (sites/samtrygg): browser-only (listings are rendered by JavaScript), so no HTTP scanner: the agent
runs extract.js on the loaded results in the user's Chrome (the city page, or the results of "Sök bostad" for a
move-in date) and the output goes through `to_listing` (findhome ingest --parser samtrygg / the inbox).

Cards carry no published date. The browser tool may mask values that look like tokens ("[BLOCKED: ...]"): the id
is re-derived from the listing URL and masked image links are dropped. A card's period has no year when the start
is this season ("1 dec – Tillsvidare"): the start then takes the next occurrence on or after the day the card was
seen (`_seen`, set by the inbox from the file's timestamp).

The object page (/object/<id>/...) is read by the details job with detail_extract.js: its RealEstateListing
JSON-LD gives the exact start (availabilityStarts), end, price, address with postcode, coordinates, every photo, the
description and amenities; the facts block gives floor, furnishing and housing type. `detail_to_listing` maps it.
"""
from __future__ import annotations

import re
from datetime import date
from typing import Any

from findhome.domain.models import DESCRIPTION_MAX, ListingIn, SourceIn

BASE = "https://www.samtrygg.se"
PETS_OK = re.compile(r"^\s*husdjur\s+(ok|tillåtna|tillåtet)\s*$", re.IGNORECASE)
OBJECT_ID = re.compile(r"/object/([^/?#]+)/")
STREET_NUMBER = re.compile(r"^(.*?\D)\s+(\d+\s*[A-Za-z]?(?:-\d+)?)$")
PETS_ROW = "Husdjur tillåtet"
MONTHS = {"JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAJ": 5, "JUN": 6, "JUL": 7, "AUG": 8, "SEP": 9, "OKT": 10,
          "NOV": 11, "DEC": 12}


def _parse_period(period: str | None, seen: date | None = None) -> tuple[date | None, date | None, bool]:
    """'1 JAN 2027 – 1 JAN 2029' / 'NU – TILLSVIDARE' / '29 NOV – 14 FEB 2027' -> (start, end, open_ended).
    'NU' (available now) gives start None. A start without a year takes the year of a dated end (minus one if
    later); with an open end, the next occurrence on or after `seen` (the day the card was seen, default today)."""
    if not period:
        return None, None, False
    parts = [p.strip().upper() for p in re.split(r"\s[–-]\s", period)]
    if len(parts) != 2:
        return None, None, False

    def one(s: str, year: int | None = None) -> date | None:
        m = re.match(r"(\d{1,2})\s+([A-ZÅÄÖ]{3})\.?(?:\s+(\d{4}))?$", s)
        if not m or m.group(2) not in MONTHS:
            return None
        y = int(m.group(3)) if m.group(3) else year
        if y is None:
            return None
        try:
            return date(y, MONTHS[m.group(2)], int(m.group(1)))
        except ValueError:
            return None

    open_ended = parts[1].startswith("TILLSVIDARE")
    end = None if open_ended else one(parts[1])
    if end:
        start = one(parts[0], end.year)
        if start and start > end:
            start = start.replace(year=start.year - 1)
        return start, end, open_ended
    start = one(parts[0])                              # a year of its own
    if start is None:
        seen = seen or date.today()
        start = one(parts[0], seen.year)
        if start and start < seen:
            start = one(parts[0], seen.year + 1)
    return start, end, open_ended


def _clean(v):
    return None if isinstance(v, str) and v.startswith("[BLOCKED") else v


def listing_id(raw: dict) -> str:
    """The card's id, or the /object/<id>/ segment of its URL when the id was masked."""
    rid = _clean(raw.get("id"))
    if rid:
        return str(rid)
    m = OBJECT_ID.search(str(_clean(raw.get("url")) or ""))
    if not m or m.group(1).startswith("[BLOCKED"):
        raise ValueError("no listing id: both the id and the URL are missing or masked")
    return m.group(1)


def _seen(raw: dict) -> date | None:
    try:
        return date.fromisoformat(str(raw.get("_seen"))[:10]) if raw.get("_seen") else None
    except ValueError:
        return None


def address_parts(street_line: str | None, locality: str | None = None, postcode: str | None = None) -> dict:
    """The parts the source gave: the number only when the street line has one, never invented."""
    m = STREET_NUMBER.match((street_line or "").strip())
    street, number = (m.group(1).strip(), m.group(2).replace(" ", "")) if m else ((street_line or "").strip() or None, None)
    return {k: v for k, v in {"street": street, "number": number, "locality": locality, "postcode": postcode}.items()
            if v}


def to_listing(raw: dict) -> ListingIn:
    """Entry point for `findhome ingest listings --parser samtrygg` (raw docs from extract.js)."""
    ext = listing_id(raw)
    start, end, open_ended = _parse_period(raw.get("period"), _seen(raw))
    address = raw.get("address")
    area = raw.get("area")
    attrs: dict = {"period_raw": raw.get("period"), "tags": raw.get("tags") or [], "badges": raw.get("badges") or []}
    if open_ended:
        attrs["open_ended"] = True
    first = re.split(r"\s[–-]\s", raw.get("period") or "")[0].strip()
    if first:
        attrs["move_in_raw"] = first                 # "Nu", "1 dec", "1 jan 2027": the card's own wording
    parts = address_parts(address, area)
    if parts:
        attrs["address_parts"] = parts
    pets = raw.get("pets")
    if pets and PETS_OK.search(pets):
        # The card's "Husdjur ok" tag is the site's own answer; its absence is not a "no", so only this is a flag.
        attrs["pets_flag"] = {"value": True, "evidence": pets}
    elif pets:
        attrs["pets_text"] = pets           # any other pet wording: judged by the pet rules at ingest
    tags = " ".join(raw.get("tags") or []).lower()
    photos = [u for u in (raw.get("images") or []) if isinstance(u, str) and u.startswith("http")]
    if not photos and isinstance(raw.get("image"), str) and raw["image"].startswith("http"):
        photos = [raw["image"]]
    return ListingIn(
        source=SourceIn(site_slug="samtrygg", external_id=ext, url=_clean(raw.get("url")), method="agent_browser"),
        listing_kind="rent",
        title=address,
        address_raw=", ".join(x for x in (address, area) if x) or None,
        area=area,
        size_m2=raw.get("size_m2"),
        rooms_rok=raw.get("rooms"),
        furnished=raw.get("furnished"),
        rent_sek=raw.get("rent_sek"),
        contract_type="second_hand",       # Samtrygg is andrahandsuthyrning
        contract_start=start,
        contract_end=end,
        available_from=start,
        has_balcony=True if "balkong" in tags else None,
        has_elevator=True if "hiss" in tags else None,
        photo_urls=photos,
        attributes=attrs,
    )


def _facts_int(v: Any) -> int | None:
    m = re.search(r"-?\d+", str(v or ""))
    return int(m.group(0)) if m else None


def detail_to_listing(doc: dict, ext: str | None = None) -> dict[str, Any]:
    """The object page (detail_extract.js output) as the fields it has, for the details job: only what the page
    showed, so a missing value never overwrites a stored one. Start and end come from the JSON-LD (FRÅN shows today's
    date once the start has passed); floor and furnishing from the facts block; pets from the amenity row."""
    out: dict[str, Any] = {}
    attrs: dict[str, Any] = {}
    start, end = doc.get("start"), doc.get("end")
    if start:
        out["available_from"] = out["contract_start"] = str(start)[:10]
    if end:
        out["contract_end"] = str(end)[:10]
    elif start:
        attrs["open_ended"] = True
    if isinstance(doc.get("price"), (int, float)) or str(doc.get("price") or "").isdigit():
        out["rent_sek"] = int(float(doc["price"]))
    if doc.get("rooms") is not None:
        out["rooms_rok"] = float(doc["rooms"])
    if doc.get("size") is not None:
        out["size_m2"] = float(doc["size"])
    facts = {str(k).upper(): v for k, v in (doc.get("facts") or {}).items()}
    if _facts_int(facts.get("VÅNING")) is not None:
        out["floor"] = _facts_int(facts.get("VÅNING"))
    furn = str(facts.get("MÖBLERING") or "").lower()
    if furn:                                          # "Delvis möblerad" / "Flexibelt" stay raw only
        if furn.startswith(("möblerad", "omöblerad")):
            out["furnished"] = furn.startswith("möblerad")
        attrs["furnishing_raw"] = facts.get("MÖBLERING")
    if facts.get("BOENDEFORM"):
        attrs["housing_type"] = facts["BOENDEFORM"]
    geo = doc.get("geo") or {}
    if geo.get("latitude") is not None and geo.get("longitude") is not None:
        out["lat"], out["lon"] = float(geo["latitude"]), float(geo["longitude"])
    adr = doc.get("address") or {}
    parts = address_parts(adr.get("streetAddress"), adr.get("addressLocality"), adr.get("postalCode"))
    if parts:
        attrs["address_parts"] = parts
    photos = [u for u in (doc.get("photos") or []) if isinstance(u, str) and u.startswith("http")]
    if photos:
        out["photo_urls"] = photos
        attrs["photo_count"] = len(photos)
    if doc.get("description"):
        out["description_excerpt"] = str(doc["description"])[:DESCRIPTION_MAX]
    if doc.get("amenities"):
        attrs["amenities"] = [str(a) for a in doc["amenities"]]
    if doc.get("price_note"):
        attrs["price_note"] = doc["price_note"]
    if doc.get("pets") in ("yes", "ask"):
        # the amenity row: ticked = the landlord allows pets; "— saknas" = not ticked, and the site says to ask
        attrs["pets_flag"] = {"value": True if doc["pets"] == "yes" else "ask",
                              "evidence": doc.get("pets_evidence") or PETS_ROW}
    if attrs:
        out["attributes"] = attrs
    return out
