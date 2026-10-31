"""Resolve profile hard_filters into a site's query parameters through its filter_map.

Each canonical key maps to {param, value_map, local_only}. Mapped keys with a value become
query params; local_only or unmapped keys are reported so the runner (and the score's hard
filters) apply them after parsing.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from findhome.config.loader import ConfigBundle
from findhome.config.models import SiteConfig


@dataclass
class ResolvedFilters:
    params: dict[str, Any] = field(default_factory=dict)
    local_only: list[str] = field(default_factory=list)
    unmapped: list[str] = field(default_factory=list)


def canonical_values(bundle: ConfigBundle, kind: str) -> dict[str, Any]:
    hf = dict(bundle.profile.kinds[kind].hard_filters)
    hf["pets_allowed"] = "no" in (hf.get("pet_status_exclude") or [])
    return hf


def resolve(bundle: ConfigBundle, site: SiteConfig, kind: str = "rent") -> ResolvedFilters:
    out = ResolvedFilters()
    for key, value in canonical_values(bundle, kind).items():
        if value in (None, [], {}, "", False) and key != "pets_allowed":
            continue
        rule = site.filter_map.get(key)
        if rule is None:
            out.unmapped.append(key)
            continue
        if rule.get("local_only") or not rule.get("param"):
            out.local_only.append(key)
            continue
        vmap = rule.get("value_map") or {}
        if isinstance(value, list):
            value = ",".join(str(vmap.get(v, v)) for v in value)
        else:
            value = vmap.get(str(value).lower() if isinstance(value, bool) else value, value)
        out.params[rule["param"]] = value
    return out
