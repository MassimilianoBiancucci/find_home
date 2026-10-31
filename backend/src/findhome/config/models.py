"""Typed views of the YAML configs.

The JSON Schemas in config/schemas/ are the source of truth and are applied first by the
loader; these models only give the code typed access. A test checks every YAML file
parses into its model.
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

Mode = Literal["transit", "walk", "bike", "drive"]
PetStatus = Literal["yes", "no", "ask", "unknown"]
ListingKind = Literal["rent", "buy"]


class _Base(BaseModel):
    model_config = ConfigDict(extra="allow", populate_by_name=True)


# ── profile ─────────────────────────────────────────────────
class PreferenceGroup(_Base):
    enabled: bool
    weight: float
    params: dict[str, Any] = Field(default_factory=dict)


class KindProfile(_Base):
    enabled: bool
    hard_filters: dict[str, Any]
    preferences: dict[str, PreferenceGroup] = Field(default_factory=dict)


class Profile(_Base):
    kinds: dict[ListingKind, KindProfile]


# ── filters catalog ─────────────────────────────────────────
class FilterDef(_Base):
    type: str
    kinds: list[ListingKind]
    description: str
    unit: str | None = None
    values: list[Any] | None = None
    derived_from: str | None = None


class FiltersCatalog(_Base):
    filters: dict[str, FilterDef]


# ── locations & time model ──────────────────────────────────
class Window(_Base):
    type: Literal["arrive_by", "depart_at"]
    from_: str = Field(alias="from")
    to: str
    weight: float = 1.0
    step_min: int = 60
    label: str | None = None


class Trip(_Base):
    direction: Literal["to_point", "from_point", "both"]
    day_types: list[str]
    windows: list[Window] = Field(default_factory=list)
    use_default_grid: bool = False
    modes: list[Mode] | None = None


class Category(_Base):
    label: str
    default_weight: float
    color: str | None = None
    icon: str | None = None


class Point(_Base):
    id: str
    category: str
    label: str
    address: str | None = None
    coords: tuple[float, float] | None = None
    weight: float | None = None
    notes: str = ""
    modes: list[Mode]
    trips: list[Trip]
    enabled: bool = True


class Locations(_Base):
    categories: dict[str, Category]
    points: list[Point]

    def effective_weight(self, point: Point) -> float:
        return point.weight if point.weight is not None else self.categories[point.category].default_weight


class DayType(_Base):
    days: list[str]
    prefer: str | None = None


class TimeModel(_Base):
    timezone: str
    day_types: dict[str, DayType]
    skip_dates: list[str] = Field(default_factory=list)
    default_grid: dict[str, Any]
    reliability: dict[str, Any] = Field(default_factory=dict)


# ── poi, tags, providers, agent ─────────────────────────────
class PoiCategory(_Base):
    label: str
    osm_tags: list[str]
    radius_m: int
    weight: float
    provider: Literal["overpass", "google_places"]
    max_walk_min: float | None = None
    icon: str | None = None
    color: str | None = None


class Poi(_Base):
    categories: dict[str, PoiCategory]
    fetch: dict[str, Any] = Field(default_factory=dict)


class Tags(_Base):
    statuses: dict[str, Any]
    terminal_statuses: list[str] = Field(default_factory=list)
    tags: dict[Literal["positive", "negative"], dict[str, dict[str, Any]]]

    def statuses_for(self, kind: str) -> list[str]:
        return list(self.statuses.get("by_kind", {}).get(kind) or self.statuses["default"])

    def all_tags(self) -> dict[str, str]:
        return {k: pol for pol, group in self.tags.items() for k in group}


class Providers(_Base):
    routing: dict[str, dict[str, Any]]
    mode_priority: dict[str, list[str]]
    geocoding: dict[str, Any] = Field(default_factory=dict)
    poi: dict[str, Any] = Field(default_factory=dict)
    budget: dict[str, Any]
    cache: dict[str, Any]
    prefilter: dict[str, Any] = Field(default_factory=dict)
    map: dict[str, Any]


class AgentProfile(_Base):
    label: str | None = None
    command: str
    args: list[str]
    prompt_file: str
    timeout_min: int
    env_passthrough: list[str] = Field(default_factory=list)


class AgentConfig(_Base):
    profiles: dict[str, AgentProfile]


# ── geo, search area ─────────────────────────────────────────
class GeoConfig(_Base):
    region: dict[str, Any]
    datasets: dict[str, dict[str, Any]]
    attribution: list[str] = Field(default_factory=list)


class AreaPiece(_Base):
    id: str
    kind: Literal["zones", "shape", "eraser"]
    label: str | None = None
    weight: float = 1.0
    source: str | None = None
    zones: list[str] = Field(default_factory=list)
    geometry: dict[str, Any] | None = None
    visible: bool = True


class SearchArea(_Base):
    buffer_m: float
    pieces: list[AreaPiece]


class AreaAliases(_Base):
    aliases: dict[str, list[str]]


# ── sites ───────────────────────────────────────────────────
class SiteConfig(_Base):
    slug: str
    name: str
    url: str
    kinds: list[ListingKind]
    status: Literal["unverified", "active", "broken", "disabled"]
    fetch: dict[str, Any]
    filter_map: dict[str, dict[str, Any]]
    field_map: dict[str, Any] = Field(default_factory=dict)
    pets: dict[str, Any] = Field(default_factory=dict)
    auth: dict[str, Any]
    politeness: dict[str, Any]
    schedule: dict[str, Any] = Field(default_factory=dict)
    notes: str = ""
    last_verified: str | None = None
