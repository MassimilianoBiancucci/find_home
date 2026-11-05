"""Zone indices from measured components. Pure: numbers in, numbers out.

Each component maps a measured value linearly from `zero` (score 0) to `full` (score 1), clipped; that works both
for "lower is better" (minutes: zero > full) and "higher is better" (lines: zero < full). Missing components (no
timetable, no stop of that kind reachable) are left out and the weights renormalise.

Three indices, 0-100:
- transport: walking access to rail and bus, coverage, lines and departures, per time window and window-weighted;
- services: per service set, proximity (walk to the nearest) and choice (how many within a short walk), weighted
  by the set's weight from poi.yaml; no transit;
- combined: a weighted mean of named parts (zone.yaml `combined.parts`), today transport and services.

The same functions score one house (zone/house.py): the inputs then come from one point instead of the zone's homes.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

TRANSPORT = ("rail_access", "bus_access", "coverage", "lines", "frequency")
PER_WINDOW = ("lines", "frequency")
CHOICE_DEFAULT = {"within_min": 10, "full": 3, "weight": 0.4}
COMBINED_DEFAULT = {"transport": 0.5, "services": 0.5}
COMPONENT_LABELS = {"rail_access": "Walk to rail", "bus_access": "Walk to bus", "coverage": "Homes near a stop",
                    "lines": "Lines", "frequency": "Departures"}


def score(value: float | None, zero: float, full: float) -> float | None:
    if value is None or zero == full:
        return None
    return max(0.0, min(1.0, (value - zero) / (full - zero)))


@dataclass
class Components:
    """Measured values. Minutes for access, a share for coverage, counts per window for lines and frequency;
    per service set, the median walk in minutes and the median number of targets within `choice.within_min`."""
    rail_access_min: float | None
    bus_access_min: float | None
    coverage: float | None
    lines: dict[str, float | None] = field(default_factory=dict)        # window → distinct lines (rail weighted)
    frequency: dict[str, float | None] = field(default_factory=dict)    # window → departures per hour
    services_min: dict[str, float | None] = field(default_factory=dict) # target set → median walk minutes
    services_choice: dict[str, float | None] = field(default_factory=dict)  # target set → median count within reach


@dataclass
class ServiceInput:
    """One service set as measured. walk_min None with a choice count means nothing within the cut-off."""
    walk_min: float | None
    choice: float | None = None


def _weighted(scores: dict[str, float | None], weights: dict[str, float]) -> float | None:
    have = [(s, weights[k]) for k, s in scores.items() if s is not None and weights.get(k, 0) > 0]
    total = sum(w for _, w in have)
    return round(100 * sum(s * w for s, w in have) / total, 1) if total else None


def component_scores(c: Components, cfg: dict[str, Any], window: str) -> dict[str, float | None]:
    comp = cfg["components"]
    raw = {"rail_access": c.rail_access_min, "bus_access": c.bus_access_min, "coverage": c.coverage,
           "lines": c.lines.get(window), "frequency": c.frequency.get(window)}
    return {k: score(v, comp[k]["zero"], comp[k]["full"]) for k, v in raw.items() if k in comp}


def choice_cfg(cfg: dict[str, Any]) -> dict[str, float]:
    return {**CHOICE_DEFAULT, **(cfg["services"].get("choice") or {})}


def service_set_score(x: ServiceInput, cfg: dict[str, Any]) -> float | None:
    """0..1 = proximity × (1 − choice.weight) + choice × choice.weight; a missing part renormalises.

    Proximity maps the walk from services.zero to services.full minutes. When the walk is unknown but a count was
    taken (nothing reached within the cut-off), proximity is 0: the service is missing, not unmeasured."""
    s, ch = cfg["services"], choice_cfg(cfg)
    prox = score(x.walk_min, s["zero"], s["full"])
    if prox is None and x.walk_min is None and x.choice is not None:
        prox = 0.0
    cho = score(x.choice, 0, ch["full"]) if x.choice is not None else None
    parts = [(prox, 1 - ch["weight"]), (cho, ch["weight"])]
    have = [(v, w) for v, w in parts if v is not None and w > 0]
    total = sum(w for _, w in have)
    return sum(v * w for v, w in have) / total if total else None


def services_score(per_set: dict[str, ServiceInput], set_weights: dict[str, float],
                   cfg: dict[str, Any]) -> tuple[float | None, list[dict[str, Any]]]:
    """(0-100 or None, derivation rows): Σ wᵢ · set_scoreᵢ / Σ wᵢ over the sets with data."""
    ch = choice_cfg(cfg)
    rows, num, den = [], 0.0, 0.0
    for sid, x in per_set.items():
        s = service_set_score(x, cfg)
        w = float(set_weights.get(sid, 1.0))
        walk = "none within reach" if x.walk_min is None else f"{x.walk_min:g} min walk"
        count = "" if x.choice is None else f", {x.choice:g} within {ch['within_min']:g} min"
        rows.append({"name": sid, "input": walk + count, "score": None if s is None else round(s, 3), "weight": w})
        if s is not None and w > 0:
            num, den = num + s * w, den + w
    return (round(100 * num / den, 1) if den else None), rows


def combined(parts: dict[str, float | None], weights: dict[str, float]) -> float | None:
    """Weighted mean of the available 0..100 parts; renormalises when one is missing."""
    have = [(v, float(weights[k])) for k, v in parts.items() if v is not None and float(weights.get(k, 0)) > 0]
    total = sum(w for _, w in have)
    return round(sum(v * w for v, w in have) / total, 1) if total else None


def _combined_rows(parts: dict[str, float | None], weights: dict[str, float]) -> list[dict[str, Any]]:
    return [{"name": k, "input": "no value" if v is None else f"{v:g} / 100", "score": None if v is None else round(v / 100, 3),
             "weight": float(weights.get(k, 0))} for k, v in parts.items()]


def indices(c: Components, cfg: dict[str, Any], set_weights: dict[str, float] | None = None,
            combined_parts: dict[str, float] | None = None) -> dict[str, Any]:
    """Per window and window-weighted average: transport and combined (0-100); services (0-100, no window);
    component scores per window; a derivation (rows of input → score × weight) for each index."""
    weights = {k: v["weight"] for k, v in cfg["components"].items()}
    cw = combined_parts or COMBINED_DEFAULT
    sets = {sid: ServiceInput(c.services_min.get(sid), c.services_choice.get(sid))
            for sid in cfg["services"]["sets"] if sid in c.services_min or sid in c.services_choice}
    serv, serv_rows = services_score(sets, set_weights or {}, cfg)
    per: dict[str, dict[str, Any]] = {}
    for w in cfg["windows"]:
        comps = component_scores(c, cfg, w)
        t = _weighted(comps, weights)
        per[w] = {"transport": t, "combined": combined({"transport": t, "services": serv}, cw),
                  "components": {k: None if v is None else round(v, 3) for k, v in comps.items()}}
    ww = {w: float(v["weight"]) for w, v in cfg["windows"].items()}

    def avg(get) -> float | None:
        have = [(get(per[w]), ww[w]) for w in per if get(per[w]) is not None and ww[w] > 0]
        total = sum(x for _, x in have)
        return round(sum(v * x for v, x in have) / total, 1) if total else None

    transport = avg(lambda p: p["transport"])
    comp_avg = {k: avg(lambda p, k=k: p["components"].get(k)) for k in cfg["components"]}
    raw = {"rail_access": c.rail_access_min, "bus_access": c.bus_access_min, "coverage": c.coverage}
    t_rows = [{"name": COMPONENT_LABELS.get(k, k), "input": _measured(k, raw.get(k), c),
               "score": comp_avg[k], "weight": float(weights[k])} for k in cfg["components"]]
    parts = {"transport": transport, "services": serv}
    return {"transport": transport, "services": serv, "combined": avg(lambda p: p["combined"]), "windows": per,
            "derivation": {
                "transport": {"label": "Component (day average)", "rows": t_rows, "total": transport, "scale": 100},
                "services": {"label": "Service set", "rows": serv_rows, "total": serv, "scale": 100},
                "combined": {"label": "Part", "rows": _combined_rows(parts, cw),
                             "total": combined(parts, cw), "scale": 100}}}


def _measured(key: str, value: float | None, c: Components) -> str:
    if key in PER_WINDOW:
        vals = [v for v in (c.lines if key == "lines" else c.frequency).values() if v is not None]
        if not vals:
            return "no timetable" if key == "frequency" else "–"
        return f"{min(vals):g}-{max(vals):g}{'/h' if key == 'frequency' else ''} across windows"
    if value is None:
        return "none reachable"
    return f"{round(value * 100)}% of homes" if key == "coverage" else f"{value:g} min"
