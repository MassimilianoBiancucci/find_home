"""Value scale of the listing facts (rent, size, rooms, rent per m²) for colouring them in the UI: the values of the
listings still in the running (scored, not rejected by a hard filter or by you) and your targets from the profile.
It also carries your move-in window (`hard_filters.move_in_from` / `move_in_to`) for colouring the move-in date.

The UI rates a value from its percentile among those listings and, where you set one, its place between your limit
(hard filter) and your ideal (score parameter), with the same defaults as the cost and space score groups. Pure.
"""
from __future__ import annotations

from typing import Any

from findhome.config.models import KindProfile

FIELDS = ("rent_sek", "size_m2", "rooms_rok", "rent_per_m2")


def _params(prof: KindProfile, group: str) -> dict[str, Any]:
    g = prof.preferences.get(group)
    return dict(g.params) if g is not None else {}


def targets(prof: KindProfile | None) -> dict[str, dict[str, Any]]:
    """Per field: which way is better, your limit and your ideal (None when not set)."""
    hf = prof.hard_filters if prof else {}
    cost, space = (_params(prof, "cost"), _params(prof, "space")) if prof else ({}, {})
    mx, ideal = hf.get("max_rent_sek"), cost.get("ideal_rent_sek")
    if ideal is None and mx is not None:
        ideal = mx * 0.75                                   # as the cost group
    size_ideal = space.get("ideal_size_m2") or (55 if prof and "space" in prof.preferences else None)
    return {
        "rent_sek": {"better": "low", "limit": mx, "ideal": ideal, "limit_key": "hard_filters.max_rent_sek",
                     "ideal_key": "preferences.cost.params.ideal_rent_sek"},
        "size_m2": {"better": "high", "limit": hf.get("min_size_m2"), "ideal": size_ideal,
                    "limit_key": "hard_filters.min_size_m2", "ideal_key": "preferences.space.params.ideal_size_m2"},
        "rooms_rok": {"better": "high", "limit": hf.get("min_rooms_rok"), "ideal": None,
                      "limit_key": "hard_filters.min_rooms_rok", "ideal_key": None},
        "rent_per_m2": {"better": "low", "limit": None, "ideal": None, "limit_key": None, "ideal_key": None},
    }


def move_in(prof: KindProfile | None) -> dict[str, str | None]:
    """Your move-in window as ISO dates (None when not set): after `to` is a hard-filter rejection."""
    hf = prof.hard_filters if prof else {}
    iso = lambda v: None if v in (None, "") else str(v)[:10]          # YAML may give a date object
    return {"from": iso(hf.get("move_in_from")), "to": iso(hf.get("move_in_to"))}


def in_running(row: dict[str, Any]) -> bool:
    """Scored and not rejected: by a hard filter (no total) or by you (status rejected or archived)."""
    return row.get("score") is not None and not row.get("rejected_by") and row.get("status") not in ("rejected", "archived")


def value_scale(rows: list[dict[str, Any]], prof: KindProfile | None) -> dict[str, Any]:
    """Sorted values per field of the listings in the running, with the targets."""
    live = [r for r in rows if in_running(r)]
    out: dict[str, Any] = {}
    for f, t in targets(prof).items():
        if f == "rent_per_m2":
            vals = [float(r["rent_sek"]) / float(r["size_m2"]) for r in live if r.get("rent_sek") and r.get("size_m2")]
        else:
            vals = [float(r[f]) for r in live if r.get(f) is not None]
        out[f] = {**t, "values": sorted(round(v, 1) for v in vals)}
    return {"n": len(live), "fields": out, "move_in": move_in(prof)}
