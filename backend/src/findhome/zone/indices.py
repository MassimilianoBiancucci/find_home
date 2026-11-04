"""Mobility indices of a zone from measured components. Pure: numbers in, numbers out.

Each component maps a measured value linearly from `zero` (score 0) to `full` (score 1), clipped; that works both
for "lower is better" (minutes: zero > full) and "higher is better" (lines: zero < full). Missing components (no
timetable, no stop of that kind reachable) are left out and the weights renormalise.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

TRANSPORT = ("rail_access", "bus_access", "coverage", "lines", "frequency")
PER_WINDOW = ("lines", "frequency")


def score(value: float | None, zero: float, full: float) -> float | None:
    if value is None or zero == full:
        return None
    return max(0.0, min(1.0, (value - zero) / (full - zero)))


@dataclass
class Components:
    """Measured values. Minutes for access, a share for coverage, counts per window for lines and frequency."""
    rail_access_min: float | None
    bus_access_min: float | None
    coverage: float | None
    lines: dict[str, float | None] = field(default_factory=dict)        # window → distinct lines (rail weighted)
    frequency: dict[str, float | None] = field(default_factory=dict)    # window → departures per hour
    services_min: dict[str, float | None] = field(default_factory=dict) # target set → median walk minutes


def _weighted(scores: dict[str, float | None], weights: dict[str, float]) -> float | None:
    have = [(s, weights[k]) for k, s in scores.items() if s is not None and weights.get(k, 0) > 0]
    total = sum(w for _, w in have)
    return round(100 * sum(s * w for s, w in have) / total, 1) if total else None


def component_scores(c: Components, cfg: dict[str, Any], window: str) -> dict[str, float | None]:
    comp = cfg["components"]
    raw = {"rail_access": c.rail_access_min, "bus_access": c.bus_access_min, "coverage": c.coverage,
           "lines": c.lines.get(window), "frequency": c.frequency.get(window)}
    return {k: score(v, comp[k]["zero"], comp[k]["full"]) for k, v in raw.items() if k in comp}


def services_score(c: Components, cfg: dict[str, Any]) -> float | None:
    s = cfg["services"]
    vals = [score(m, s["zero"], s["full"]) for m in c.services_min.values()]
    vals = [v for v in vals if v is not None]
    return sum(vals) / len(vals) if vals else None


def indices(c: Components, cfg: dict[str, Any]) -> dict[str, Any]:
    """Per window and window-weighted average: transport and transport + services (0-100), plus component scores."""
    weights = {k: v["weight"] for k, v in cfg["components"].items()}
    sw = float(cfg["services"]["weight"])
    serv = services_score(c, cfg)
    per: dict[str, dict[str, Any]] = {}
    for w in cfg["windows"]:
        comps = component_scores(c, cfg, w)
        t = _weighted(comps, weights)
        ts = None if t is None else round(t * (1 - sw) + 100 * serv * sw, 1) if serv is not None else t
        per[w] = {"transport": t, "transport_services": ts,
                  "components": {k: None if v is None else round(v, 3) for k, v in comps.items()}}
    ww = {w: float(v["weight"]) for w, v in cfg["windows"].items()}

    def avg(key: str) -> float | None:
        have = [(per[w][key], ww[w]) for w in per if per[w][key] is not None and ww[w] > 0]
        total = sum(x for _, x in have)
        return round(sum(v * x for v, x in have) / total, 1) if total else None

    return {"transport": avg("transport"), "transport_services": avg("transport_services"),
            "services": None if serv is None else round(100 * serv, 1), "windows": per}
