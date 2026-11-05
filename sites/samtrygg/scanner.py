"""Samtrygg (sites/samtrygg): browser-only (listings are rendered by JavaScript), so no HTTP scanner: the agent
runs extract.js on the loaded results in the user's Chrome (the city page, or the results of "Sök bostad" for a
move-in date) and the output goes through `to_listing` (findhome ingest --parser samtrygg / the inbox).

Cards carry no published date. The browser tool may mask values that look like tokens ("[BLOCKED: ...]"): the id
is re-derived from the listing URL and masked image links are dropped.
"""
from __future__ import annotations

import re
from datetime import date

from findhome.domain.models import ListingIn, SourceIn

BASE = "https://www.samtrygg.se"
PETS_OK = re.compile(r"^\s*husdjur\s+(ok|tillåtna|tillåtet)\s*$", re.IGNORECASE)
OBJECT_ID = re.compile(r"/object/([^/?#]+)/")
MONTHS = {"JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAJ": 5, "JUN": 6, "JUL": 7, "AUG": 8, "SEP": 9, "OKT": 10,
          "NOV": 11, "DEC": 12}


def _parse_period(period: str | None) -> tuple[date | None, date | None, bool]:
    """'1 JAN 2027 – 1 JAN 2029' / 'NU – TILLSVIDARE' / '29 NOV – 14 FEB 2027' -> (start, end, open_ended).
    'NU' (available now) gives start None; a start without a year takes the year of the end (minus one if later)."""
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
    start = one(parts[0], end.year if end else None)
    if start and end and start > end:
        start = start.replace(year=start.year - 1)
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


def to_listing(raw: dict) -> ListingIn:
    """Entry point for `findhome ingest listings --parser samtrygg` (raw docs from extract.js)."""
    ext = listing_id(raw)
    start, end, open_ended = _parse_period(raw.get("period"))
    address = raw.get("address")
    area = raw.get("area")
    attrs: dict = {"period_raw": raw.get("period"), "tags": raw.get("tags") or [], "badges": raw.get("badges") or []}
    if open_ended:
        attrs["open_ended"] = True
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
