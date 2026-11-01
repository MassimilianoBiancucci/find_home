"""Load, validate and cross-check every YAML config into one ConfigBundle.

Order: parse YAML → validate against config/schemas/<name>.schema.json → cross-file checks
→ typed models → config_hash. Errors are collected (not raised one by one) so
`findhome config validate` can report everything at once.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker
from ruamel.yaml import YAML

from findhome.config import models as m
from findhome.config.timegrid import parse_hhmm
from findhome.core.paths import config_dir as default_config_dir
from findhome.core.paths import sites_dir as default_sites_dir

# file stem -> model; order matters only for error readability
CONFIG_FILES: dict[str, type[m._Base]] = {
    "profile": m.Profile,
    "filters_catalog": m.FiltersCatalog,
    "locations": m.Locations,
    "time_model": m.TimeModel,
    "poi": m.Poi,
    "tags": m.Tags,
    "providers": m.Providers,
    "agent": m.AgentConfig,
    "geo": m.GeoConfig,
    "search_area": m.SearchArea,
    "area_aliases": m.AreaAliases,
    "transit_colours": m.TransitColours,
}
# files whose content changes scores; their canonical JSON makes the config hash
SCORING_FILES = ("profile", "locations", "time_model", "poi", "tags", "search_area")


class ConfigError(Exception):
    def __init__(self, errors: list[str]):
        super().__init__("\n".join(errors))
        self.errors = errors


@dataclass
class ConfigBundle:
    profile: m.Profile
    filters_catalog: m.FiltersCatalog
    locations: m.Locations
    time_model: m.TimeModel
    poi: m.Poi
    tags: m.Tags
    providers: m.Providers
    agent: m.AgentConfig
    geo: m.GeoConfig
    search_area: m.SearchArea
    area_aliases: m.AreaAliases
    transit_colours: m.TransitColours
    sites: dict[str, m.SiteConfig]
    raw: dict[str, Any] = field(repr=False)
    config_hash: str = ""
    site_hashes: dict[str, str] = field(default_factory=dict)


def _yaml() -> YAML:
    y = YAML(typ="safe", pure=True)
    return y


def read_yaml(path: Path) -> Any:
    with path.open(encoding="utf-8") as fh:
        return _yaml().load(fh)


def _jsonable(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {str(k): _jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_jsonable(v) for v in obj]
    if isinstance(obj, date):
        return obj.isoformat()
    return obj


def canonical_hash(*docs: Any) -> str:
    payload = json.dumps([_jsonable(d) for d in docs], sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


def _validator(schemas_dir: Path, name: str) -> Draft202012Validator:
    schema = json.loads((schemas_dir / f"{name}.schema.json").read_text(encoding="utf-8"))
    return Draft202012Validator(schema, format_checker=FormatChecker())


def schema_errors(schemas_dir: Path, name: str, data: Any, label: str) -> list[str]:
    errs = sorted(_validator(schemas_dir, name).iter_errors(_jsonable(data)), key=lambda e: list(e.path))
    return [f"{label}: /{'/'.join(map(str, e.path))}: {e.message}" for e in errs]


def _cross_checks(raw: dict[str, Any], sites: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    catalog = raw["filters_catalog"]["filters"]
    for kind, prof in raw["profile"]["kinds"].items():
        for key in prof.get("hard_filters", {}):
            if key not in catalog:
                errors.append(f"profile.yaml: kinds/{kind}/hard_filters/{key}: not in filters_catalog.yaml")
            elif kind not in catalog[key]["kinds"]:
                errors.append(f"profile.yaml: kinds/{kind}/hard_filters/{key}: filter not defined for kind '{kind}'")
    cats = raw["locations"]["categories"]
    day_types = raw["time_model"]["day_types"]
    seen_ids: set[str] = set()
    for i, p in enumerate(raw["locations"]["points"]):
        where = f"locations.yaml: points/{i} ({p.get('id')})"
        if p["id"] in seen_ids:
            errors.append(f"{where}: duplicate id")
        seen_ids.add(p["id"])
        if p["category"] not in cats:
            errors.append(f"{where}: category '{p['category']}' not in categories")
        for j, t in enumerate(p["trips"]):
            for dt in t["day_types"]:
                if dt not in day_types:
                    errors.append(f"{where}: trips/{j}: day_type '{dt}' not in time_model.yaml day_types")
            if not t.get("windows") and not t.get("use_default_grid"):
                errors.append(f"{where}: trips/{j}: needs windows or use_default_grid: true")
            for k, w in enumerate(t.get("windows", [])):
                if parse_hhmm(w["from"]) == parse_hhmm(w["to"]) and w.get("step_min", 60) <= 0:
                    errors.append(f"{where}: trips/{j}/windows/{k}: empty window")
    prio = raw["providers"]["mode_priority"]
    routing = raw["providers"]["routing"]
    for mode, names in prio.items():
        for n in names:
            if n not in routing:
                errors.append(f"providers.yaml: mode_priority/{mode}: unknown provider '{n}'")
    for slug, site in sites.items():
        for key in site.get("filter_map", {}):
            if key not in catalog:
                errors.append(f"sites/{slug}/site.yaml: filter_map/{key}: not in filters_catalog.yaml")
        if site.get("slug") != slug:
            errors.append(f"sites/{slug}/site.yaml: slug '{site.get('slug')}' does not match folder name")
    errors += _area_checks(raw)
    return errors


def _area_checks(raw: dict[str, Any]) -> list[str]:
    from shapely.geometry import shape

    from findhome.geo.store import load_zones

    errors: list[str] = []
    pieces = raw["search_area"].get("pieces") or []
    ids = [p["id"] for p in pieces]
    for dup in sorted({i for i in ids if ids.count(i) > 1}):
        errors.append(f"search_area.yaml: pieces: duplicate id '{dup}'")
    zones = load_zones()
    for i, p in enumerate(pieces):
        where = f"search_area.yaml: pieces/{i} ({p['id']})"
        if p.get("geometry"):
            try:
                if not shape(p["geometry"]).is_valid:
                    errors.append(f"{where}: geometry is not a valid polygon")
            except Exception as exc:  # noqa: BLE001 - any GeoJSON problem
                errors.append(f"{where}: geometry: {exc}")
        if zones is not None:
            unknown = [z for z in p.get("zones") or [] if z not in zones.zones]
            if unknown:
                errors.append(f"{where}: unknown zone ids {unknown[:5]} (rebuild with: findhome geo fetch zones)")
    known = zones.zones if zones is not None else None
    for name, zs in (raw["area_aliases"].get("aliases") or {}).items():
        if known is not None and any(z not in known for z in zs):
            errors.append(f"area_aliases.yaml: aliases/{name}: unknown zone ids")
    return errors


def load_sites(sites_dir: Path, schemas_dir: Path) -> tuple[dict[str, Any], list[str]]:
    raw_sites: dict[str, Any] = {}
    errors: list[str] = []
    if not sites_dir.exists():
        return raw_sites, errors
    for path in sorted(sites_dir.glob("*/site.yaml")):
        slug = path.parent.name
        if slug.startswith("_"):
            continue  # templates
        try:
            data = read_yaml(path)
        except Exception as exc:  # noqa: BLE001 - report any YAML error
            errors.append(f"sites/{slug}/site.yaml: YAML error: {exc}")
            continue
        errors += schema_errors(schemas_dir, "site", data, f"sites/{slug}/site.yaml")
        raw_sites[slug] = data
    return raw_sites, errors


def load_all(config_dir: Path | None = None, sites_dir: Path | None = None) -> ConfigBundle:
    """Load everything or raise ConfigError with the full list of problems."""
    cdir = Path(config_dir or default_config_dir())
    sdir = Path(sites_dir or default_sites_dir())
    schemas = cdir / "schemas"
    raw: dict[str, Any] = {}
    errors: list[str] = []
    for name in CONFIG_FILES:
        path = cdir / f"{name}.yaml"
        if not path.exists():
            example = cdir / f"{name}.example.yaml"
            hint = f" (personal file: copy {example.name} to {path.name}, or run scripts/ensure-env.sh)" if example.exists() else ""
            errors.append(f"{name}.yaml: missing{hint}")
            continue
        try:
            raw[name] = read_yaml(path)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{name}.yaml: YAML error: {exc}")
            continue
        errors += schema_errors(schemas, name, raw[name], f"{name}.yaml")
    raw_sites, site_errors = load_sites(sdir, schemas)
    errors += site_errors
    if errors:
        raise ConfigError(errors)
    errors += _cross_checks(raw, raw_sites)
    if errors:
        raise ConfigError(errors)
    parsed = {name: model.model_validate(_jsonable(raw[name])) for name, model in CONFIG_FILES.items()}
    sites = {slug: m.SiteConfig.model_validate(_jsonable(d)) for slug, d in raw_sites.items()}
    return ConfigBundle(
        **parsed,
        sites=sites,
        raw=raw,
        config_hash=canonical_hash(*(raw[n] for n in SCORING_FILES)),
        site_hashes={slug: canonical_hash(d) for slug, d in raw_sites.items()},
    )


def validate_all(config_dir: Path | None = None, sites_dir: Path | None = None) -> list[str]:
    try:
        load_all(config_dir, sites_dir)
    except ConfigError as exc:
        return exc.errors
    return []
