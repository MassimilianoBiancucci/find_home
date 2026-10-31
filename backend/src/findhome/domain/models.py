"""API contract models. These are the agent ↔ app contract: the CLI and the skill's
references/data_contract.md are generated from them (`findhome config schema ingest`)."""
from __future__ import annotations

from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

PetStatus = Literal["yes", "no", "ask", "unknown"]
ContractType = Literal["first_hand", "second_hand", "sublet", "unknown"]
SourceMethod = Literal["script", "agent_browser", "manual"]


class SourceIn(BaseModel):
    site_slug: str = Field(description="sites/<slug> the listing was found on")
    external_id: str = Field(description="The site's own id for the listing (stable across scans)")
    url: str | None = None
    method: SourceMethod = "script"
    raw_snapshot_path: str | None = Field(None, description="Path of the saved raw page under data/raw/, never the content")


class ListingIn(BaseModel):
    """One listing as found on a site, already normalised. Unknown values stay null."""
    model_config = ConfigDict(extra="forbid")

    source: SourceIn
    listing_kind: Literal["rent", "buy"] = "rent"
    title: str | None = None
    address_raw: str | None = Field(None, description="Address as written on the site")
    area: str | None = Field(None, description="District / neighbourhood, e.g. Södermalm")
    lat: float | None = None
    lon: float | None = None
    size_m2: float | None = None
    rooms_rok: float | None = Field(None, description="Rooms as 'rum och kök' (2 rok ≈ 1 bedroom)")
    has_sovalkov: bool | None = None
    floor: int | None = None
    has_elevator: bool | None = None
    has_balcony: bool | None = None
    build_year: int | None = None
    furnished: bool | None = None
    rent_sek: int | None = Field(None, description="Monthly rent in SEK")
    deposit_sek: int | None = None
    contract_type: ContractType | None = None
    contract_start: date | None = None
    contract_end: date | None = None
    max_duration_months: int | None = None
    price_sek: int | None = None
    avgift_sek: int | None = None
    drift_sek: int | None = None
    pet_status: PetStatus = "unknown"
    pet_evidence: str | None = Field(None, description="Quoted text the pet_status is based on")
    available_from: date | None = None
    description_excerpt: str | None = Field(None, max_length=1200)
    photo_urls: list[str] = Field(default_factory=list)
    floorplan_urls: list[str] = Field(default_factory=list)
    attributes: dict[str, Any] = Field(default_factory=dict, description="Anything not yet a column")


class IngestRequest(BaseModel):
    listings: list[ListingIn]
    scan_run_id: str | None = None


class IngestItemResult(BaseModel):
    short_id: str
    outcome: Literal["created", "updated", "unchanged", "duplicate"]
    external_id: str


class IngestResult(BaseModel):
    created: int = 0
    updated: int = 0
    unchanged: int = 0
    duplicate: int = 0
    items: list[IngestItemResult] = Field(default_factory=list)


class EvaluationIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    short_id: str
    summary: str = Field(max_length=1500)
    pros: list[str] = Field(default_factory=list)
    cons: list[str] = Field(default_factory=list)
    questions_for_landlord: list[str] = Field(default_factory=list)
    extracted: dict[str, Any] = Field(default_factory=dict, description="Facts read from photos/floor plans/text")
    confidence: float | None = Field(None, ge=0, le=1)
    pet_status: PetStatus | None = Field(None, description="Only with pet_evidence")
    pet_evidence: str | None = None
    agent_run_id: str | None = None


class EvaluationsRequest(BaseModel):
    evaluations: list[EvaluationIn]


class StatusChange(BaseModel):
    status: str
    note: str | None = None
    actor: Literal["user", "agent", "system"] = "user"


class FeedbackIn(BaseModel):
    polarity: Literal["like", "dislike", "neutral"]
    tags: list[str] = Field(default_factory=list)
    note: str | None = None
    actor: Literal["user", "agent"] = "user"


class CommuteRequest(BaseModel):
    short_ids: list[str]
    budget: int | None = Field(None, description="Max provider calls (after cache); default from providers.yaml")
    dry_run: bool = False
    provider: str | None = Field(None, description="Force a provider for all modes it supports")


class AgentRunRequest(BaseModel):
    profile: str


class ScanRequest(BaseModel):
    site: str = Field(description="Site slug or 'all'")
    dry_run: bool = False
    max_pages: int | None = None
