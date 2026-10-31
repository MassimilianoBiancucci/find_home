"""Time windows and sampling grids.

A window is HH:MM..HH:MM with a step; when `to` is earlier than `from` the window crosses
midnight (e.g. 18:00..03:00). Both ends are included when they fall on the step.
Slots are returned as minutes since 00:00 of the window's start day, so 01:00 after midnight
is 25*60 = 1500. That keeps ordering and day offsets explicit.
"""
from __future__ import annotations

from dataclasses import dataclass


def parse_hhmm(value: str) -> int:
    h, m = value.split(":")
    return int(h) * 60 + int(m)


def fmt_minutes(minutes: int) -> str:
    day, rest = divmod(minutes, 24 * 60)
    text = f"{rest // 60:02d}:{rest % 60:02d}"
    return f"{text}+{day}d" if day else text


def expand(start: str, end: str, step_min: int) -> list[int]:
    a, b = parse_hhmm(start), parse_hhmm(end)
    if b < a:
        b += 24 * 60
    if step_min <= 0:
        raise ValueError("step_min must be positive")
    return list(range(a, b + 1, step_min))


@dataclass(frozen=True)
class Slot:
    minutes: int          # since 00:00 of the reference day (may exceed 1440)
    weight: float
    kind: str             # arrive_by | depart_at
    window_label: str

    @property
    def label(self) -> str:
        return fmt_minutes(self.minutes)


def grid_slots(default_grid: dict, kind: str = "depart_at", weight: float = 1.0) -> list[Slot]:
    """Default grid plus its dense sub-windows, de-duplicated and ordered."""
    label = f"grid {default_grid['from']}-{default_grid['to']}"
    base = expand(default_grid["from"], default_grid["to"], default_grid["step_min"])
    start = parse_hhmm(default_grid["from"])
    extra: list[int] = []
    for dense in default_grid.get("dense", []):
        for m in expand(dense["from"], dense["to"], dense["step_min"]):
            extra.append(m if m >= start else m + 24 * 60)
    minutes = sorted(set(base) | set(extra))
    return [Slot(m, weight, kind, label) for m in minutes]


def window_slots(window: dict) -> list[Slot]:
    label = window.get("label") or f"{window['type']} {window['from']}-{window['to']}"
    return [
        Slot(m, float(window.get("weight", 1.0)), window["type"], label)
        for m in expand(window["from"], window["to"], int(window.get("step_min", 60)))
    ]
