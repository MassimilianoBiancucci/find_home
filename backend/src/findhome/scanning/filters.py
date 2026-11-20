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


# Never in a search URL, whatever a filter_map says: pets are decided in the database from the ads' own wording
# (a site-side pet filter hides every "ask" and unknown ad), and a date filter drops ads before your window, its
# slack or a later change of it can judge them (QA T9 R9: maximise volume, filter in the database).
NEVER_IN_URL = frozenset({"pets_allowed", "pet_status_exclude", "move_in_from", "move_in_to", "move_in_from_slack_days"})


def resolve(bundle: ConfigBundle, site: SiteConfig, kind: str = "rent") -> ResolvedFilters:
    """Query params for a site: its fixed_params, plus the profile's hard filters its filter_map sends. With
    fetch.url_filter_policy.mode `never` (the whole set fits the page cap) no filter goes in the URL; pet and date
    filters never do (NEVER_IN_URL)."""
    out = ResolvedFilters()
    out.params.update(site.fetch.get("fixed_params") or {})
    no_url = (site.fetch.get("url_filter_policy") or {}).get("mode") == "never"
    hard = set(bundle.profile.kinds[kind].hard_filters)
    for key, value in canonical_values(bundle, kind).items():
        if value in (None, [], {}, "", False) and key != "pets_allowed":
            continue
        rule = site.filter_map.get(key)
        if rule is None:
            out.unmapped.append(key)
            continue
        if no_url or key in NEVER_IN_URL or key not in hard or rule.get("local_only") or not rule.get("param"):
            out.local_only.append(key)
            continue
        vmap = rule.get("value_map") or {}
        if isinstance(value, list):
            value = ",".join(str(vmap.get(v, v)) for v in value)
        else:
            value = vmap.get(str(value).lower() if isinstance(value, bool) else value, value)
        if value is None or value is False:
            continue  # value_map can switch a filter off (e.g. pets_allowed false → no param)
        out.params[rule["param"]] = value
    return out
