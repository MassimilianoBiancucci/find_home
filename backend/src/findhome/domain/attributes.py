"""The fixed keys of `listings.attributes`: what scanners, inbox files and jobs write, and what the issues and the
listing page read. Each parsed value keeps its raw wording next to it. Other keys (a site's own, such as `type_flags`,
`platform`, `pets_flag`) stay free; only these are checked, at ingest (ListingIn) and in the generated data contract."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, TypeAdapter, ValidationError


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ContractTerms(_Strict):
    """Contract terms as the ad states them. Display-only: not scored."""
    guaranteed_months: int | None = None      # "Garanterad boendetid: 2 månader" -> 2
    guaranteed_raw: str | None = None
    notice_months: int | None = None          # "Uppsägningstid: 1 månad" -> 1
    notice_raw: str | None = None
    extension_raw: str | None = None          # "Möjlighet till förlängning: Ja ... Dock max 4 år"
    max_total_months: int | None = None       # 48
    estimated_months: int | None = None       # "Beräknad boendetid: 5 månader" (an estimate, not guaranteed) -> 5
    estimated_raw: str | None = None
    short_term: bool | None = None            # a short-term contract (no security of tenure)


class Requirements(_Strict):
    min_income_sek: int | None = None
    max_household: int | None = None
    residual_income_sek: int | None = None    # money left after rent, one adult ("ska ha ett bestämt belopp kvar")
    residual_income_couple_sek: int | None = None
    raw: list[str] | None = None


class FloorPlan(_Strict):
    url: str
    kind: Literal["image", "pdf", "viewer"]
    preview: str | None = None                # cached PNG of a PDF's first page
    unit: str | None = None                   # project ads: the flat this plan belongs to


class Unit(_Strict):
    """One flat of a project ad (several flats in one ad)."""
    label: str | None = None                  # e.g. the flat number
    rent_sek: int | None = None
    floor: int | None = None
    rooms_rok: float | None = None
    size_m2: float | None = None
    available_from: str | None = None         # ISO date
    floorplan_url: str | None = None


class AddressParts(_Strict):
    """The address parts the source gave; null for what it lacks. Numbers are never invented."""
    street: str | None = None
    number: str | None = None
    locality: str | None = None
    postcode: str | None = None


class Price(_Strict):
    """A rent split as the site shows it (Qasa: rent + tenant fee = monthly cost)."""
    rent: int | None = None
    tenant_base_fee: int | None = None
    monthly_cost: int | None = None


ATTRIBUTE_KEYS: dict[str, Any] = {
    "contract_terms": ContractTerms,
    "requirements": Requirements,
    "amenities": list[str],
    "utilities": list[str],                   # what the rent includes or how it is metered ("El ingår i hyran")
    "floorplans": list[FloorPlan],
    "units": list[Unit],
    "ranges": dict[str, Any],                 # project ads: {"rent": [lo, hi], "size_m2": [lo, hi], ...}
    "address_parts": AddressParts,
    "price": Price,
    "move_in_raw": str,                       # the ad's own move-in wording, e.g. "Nu", "enligt överenskommelse"
    "details_checked_at": str,                # ISO timestamp of the last listing-page read
}

_ADAPTERS = {k: TypeAdapter(t) for k, t in ATTRIBUTE_KEYS.items()}


def validate_attributes(attrs: dict[str, Any]) -> dict[str, Any]:
    """Check the fixed keys (others pass as they are). Returns the attributes with the fixed keys normalised;
    raises ValueError naming the key on a wrong shape."""
    out = dict(attrs)
    for key, adapter in _ADAPTERS.items():
        if key not in attrs or attrs[key] is None:
            continue
        try:
            value = adapter.validate_python(attrs[key])
        except ValidationError as e:
            raise ValueError(f"attributes.{key}: {e.errors()[0]['msg']} ({e.errors()[0]['loc']})") from None
        out[key] = adapter.dump_python(value, mode="json", exclude_none=True)
    return out


def attribute_schema() -> dict[str, Any]:
    """JSON Schema of the fixed keys."""
    return {k: a.json_schema() for k, a in _ADAPTERS.items()}


def _short(t: Any) -> str:
    if isinstance(t, type) and issubclass(t, BaseModel):
        return "{" + ", ".join(f"{n}: {_short(f.annotation)}" for n, f in t.model_fields.items()) + "}"
    text = str(t).replace("typing.", "").replace(" | None", "?").replace("NoneType", "null")
    for name in ("FloorPlan", "Unit"):
        if f"findhome.domain.attributes.{name}" in text:
            text = text.replace(f"findhome.domain.attributes.{name}", _short(globals()[name]))
    return text.replace("<class '", "").replace("'>", "")


def attribute_summary() -> dict[str, str]:
    """One compact line per fixed key (field: type), for the generated data contract."""
    return {k: _short(t) for k, t in ATTRIBUTE_KEYS.items()}
