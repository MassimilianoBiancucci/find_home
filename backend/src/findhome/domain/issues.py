"""Listing issues (sub-plan #7): what a listing is missing, and whether the ad lacks it or the extraction should be
checked. Computed from the listing row on every request, never stored, so they are true after any scan, job or edit.

Not issues by design: the ad status (its own pill and "hide closed", jobs.md § Ad status), pets (their own precedence
and badge, pets.md), the contract type and its other terms. One contract fact is: a set end date (`contract_end`),
class `attention` (nothing is missing, but you would have to move again).
"""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from typing import Any, Literal

Cls = Literal["not_in_source", "check_extraction", "attention"]


@dataclass(frozen=True)
class Issue:
    code: str
    label: str
    cls: Cls
    hint: str

    def as_dict(self) -> dict[str, str]:
        return asdict(self)


READ = "Its page was read and does not give it: ask the landlord if it matters."
UNREAD = "Its page was never read: run Complete details (the details job) for this listing."


def _attrs(L: dict[str, Any]) -> dict[str, Any]:
    return L.get("attributes") or {}


def listing_issues(L: dict[str, Any]) -> list[Issue]:
    """The issues of one listing row (listings.* plus the optional `last_read_translated`)."""
    a = _attrs(L)
    read = bool(a.get("details_checked_at"))
    page: Cls = "not_in_source" if read else "check_extraction"
    hint = READ if read else UNREAD
    out: list[Issue] = []
    if not L.get("available_from"):
        if a.get("move_in_raw"):
            out.append(Issue("move_in_missing", f"No move-in date (the ad says “{a['move_in_raw']}”)",
                             "not_in_source", "The ad gives words, not a date: ask the landlord when you can move in."))
        else:
            out.append(Issue("move_in_missing", "No move-in date", page, hint))
    if not L.get("photo_urls"):
        out.append(Issue("photos_missing", "No photos", page, hint))
    if not L.get("floorplan_urls") and not a.get("floorplans"):
        out.append(Issue("floorplan_missing", "No floor plan", page, hint))
    if not L.get("description_excerpt"):
        out.append(Issue("description_missing", "No description", page, hint))
    parts = a.get("address_parts") or {}
    partial = ("street" in parts and not parts.get("number")) or not re.search(r"\d", L.get("address_raw") or "")
    if partial:
        out.append(Issue("address_partial", "No street number", "not_in_source",
                         "The ad hides the exact address: the map point is the street or the area."))
    if L.get("lat") is None or L.get("lon") is None:
        out.append(Issue("coords_missing", "Not on the map", "check_extraction",
                         "No coordinates: geocoding failed or the ad gives no address."))
    elif partial:
        out.append(Issue("coords_approximate", "Approximate map point", "not_in_source",
                         "Placed on the street or the area, not the building: commute times are approximate."))
    for col, code, label in (("rent_sek", "rent_missing", "No rent"), ("size_m2", "size_missing", "No size"),
                             ("rooms_rok", "rooms_missing", "No room count")):
        if L.get(col) is None:
            out.append(Issue(code, label, "check_extraction", "Every ad on this site gives it: the parser missed it."))
    if L.get("contract_end"):
        end = L["contract_end"]
        end = end.isoformat() if hasattr(end, "isoformat") else str(end)
        terms = a.get("contract_terms") or {}
        no_ext = "false" in str(terms.get("extension_raw") or "").lower()
        out.append(Issue("contract_fixed_term", f"Fixed-term contract: ends {end}", "attention",
                         "The contract ends on a set date: you would have to move again then"
                         + (" (the ad says it cannot be extended)." if no_ext else ".")))
    if L.get("last_read_translated"):
        out.append(Issue("page_translated", "Last page read stopped: Chrome had translated it", "check_extraction",
                         "Turn off Chrome translation for Swedish, then run Complete details again."))
    return out


def issue_codes(L: dict[str, Any]) -> list[str]:
    return [i.code for i in listing_issues(L)]
