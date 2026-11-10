"""Typed views of the YAML configs.

The JSON Schemas in config/schemas/ are the source of truth and are applied first by the
loader; these models only give the code typed access. A test checks every YAML file
parses into its model.
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

Mode = Literal["transit", "walk", "bike", "drive"]
PetStatus = Literal["yes", "no", "ask", "unknown", "conflict"]
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
    connectivity: dict[str, Any] = Field(default_factory=dict)
    cache: dict[str, Any]
    prefilter: dict[str, Any] = Field(default_factory=dict)
    map: dict[str, Any]


class PetRules(_Base):
    version: int
    evidence: dict[str, Any] = Field(default_factory=dict)
    languages: dict[str, dict[str, list[str]]]


class AgentProfile(_Base):
    label: str | None = None
    kind: Literal["scan", "job", "onboarding", "evaluate", "other"] = "other"
    command: str
    args: list[str]
    prompt_file: str | None = None
    prompt: str | None = None
    params: dict[str, dict[str, Any]] = Field(default_factory=dict)
    allowed_tools: list[str] = Field(default_factory=list)
    max_turns: int | None = None
    turns_per: dict[str, Any] = Field(default_factory=dict)
    launchers: list[Literal["cli", "vscode"]] = Field(default_factory=lambda: ["cli"])
    timeout_min: int
    env_passthrough: list[str] = Field(default_factory=list)


class AgentConfig(_Base):
    profiles: dict[str, AgentProfile]


# ── geo, search area ─────────────────────────────────────────
class GeoConfig(_Base):
    region: dict[str, Any]
    datasets: dict[str, dict[str, Any]]
    attribution: list[str] = Field(default_factory=list)


class AreaReach(_Base):
    """A reach piece's rule: the zones within max_min minutes from a point (or the weighted mix) in a travel period."""
    from_: str = Field("weighted", alias="from")        # "weighted" or a point id
    max_min: float = 40
    window: str | None = None                           # "day_type|window_label"; None = every period, weighted
    exclude_estimates: bool = False


class AreaPiece(_Base):
    id: str
    kind: Literal["zones", "shape", "eraser"]
    label: str | None = None
    weight: float = 1.0
    source: str | None = None
    zones: list[str] = Field(default_factory=list)
    geometry: dict[str, Any] | None = None
    visible: bool = True
    reach: AreaReach | None = None


class SearchArea(_Base):
    buffer_m: float
    pieces: list[AreaPiece]


class AreaAliases(_Base):
    aliases: dict[str, list[str]]


class ModeColours(_Base):
    label: str | None = None
    default: str
    lines: dict[str, str] = Field(default_factory=dict)


class TransitColours(_Base):
    modes: dict[str, ModeColours]

    def colour(self, mode: str, line: str | None) -> str:
        m = self.modes.get(mode)
        if m is None:
            return "#8a8aa0"
        return m.lines.get(line or "", m.default)


class TargetSet(_Base):
    label: str
    stops: list[str] = Field(default_factory=list)      # transit modes, matched on the lines serving a stop
    poi: list[str] = Field(default_factory=list)        # POI categories (data/geo/poi/<category>.geojson)


class ZoneConfig(_Base):
    speeds_mps: dict[str, float]
    factors: dict[str, float] = Field(default_factory=dict)
    cutoff_min: float
    bins_min: list[float]
    snap_max_m: float = 300
    target_sets: dict[str, TargetSet]
    homes: dict[str, Any] = Field(default_factory=dict)
    indices: dict[str, Any] = Field(default_factory=dict)
    combined: dict[str, Any] = Field(default_factory=dict)       # parts: {transport: 0.5, services: 0.5}
    density: dict[str, Any] = Field(default_factory=dict)        # per_homes: 1000
    house: dict[str, Any] = Field(default_factory=dict)          # house analysis: cutoff_min, sets, services_depart
    walk_colours: dict[str, float] = Field(default_factory=dict) # minutes: green up to, yellow up to; above: red
    centroids: dict[str, Any] = Field(default_factory=dict)


# ── sites ───────────────────────────────────────────────────
class SiteConfig(_Base):
    slug: str
    name: str
    url: str
    kinds: list[ListingKind]
    status: Literal["unverified", "active", "broken", "disabled"]
    role: Literal["scanned", "origin"] = "scanned"
    brand: dict[str, Any] = Field(default_factory=dict)
    scan: dict[str, Any] = Field(default_factory=dict)
    platforms: dict[str, str] = Field(default_factory=dict)
    risk_note: str | None = None
    local_filter: dict[str, Any] = Field(default_factory=dict)
    fetch: dict[str, Any]
    filter_map: dict[str, dict[str, Any]]
    field_map: dict[str, Any] = Field(default_factory=dict)
    pets: dict[str, Any] = Field(default_factory=dict)
    auth: dict[str, Any]
    politeness: dict[str, Any]
    schedule: dict[str, Any] = Field(default_factory=dict)
    notes: str = ""
    last_verified: str | None = None

    def script_scan(self) -> tuple[bool, str | None]:
        """Whether a scripted scanner may scan this site, and why not."""
        if self.role == "origin":
            return False, "origin-only site: its listings arrive through an aggregator; never scanned"
        cap = self.scan.get("script") or {}
        if cap.get("enabled") is False:
            return False, cap.get("reason") or "scripted scan disabled in site.yaml"
        method = self.fetch.get("method")
        if method == "agent_browser":
            return False, "browser-only site: scan it with the browser agent"
        if method not in ("api", "http", "playwright"):
            return False, f"fetch.method not set (status {self.status}): onboard the site first"
        return True, None

    def browser_scan(self) -> tuple[bool, str | None]:
        """Whether the browser agent may scan this site, and why not."""
        if self.role == "origin":
            return False, "origin-only site: never scanned"
        cap = self.scan.get("browser") or {}
        if cap.get("enabled") is False:
            return False, cap.get("reason") or "browser scan disabled in site.yaml"
        if cap.get("enabled") or self.fetch.get("method") == "agent_browser":
            return True, None
        return False, "no browser extractor configured (scan.browser)"

    def browser_pages(self) -> tuple[int, int]:
        """(default, max) result pages for a browser scan."""
        cap = self.scan.get("browser") or {}
        mx = int(cap.get("max_pages") or self.politeness.get("max_pages_per_run") or 5)
        return min(int(cap.get("default_pages") or mx), mx), mx
