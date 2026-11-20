"""Token usage of an agent run, counted from its stream-json output while it runs.

Each `assistant` event carries `message.id`, `message.model` and `message.usage` (input, output, cache read, cache
write split by TTL). One message comes as several events, so each message keeps its largest figures and the totals add
up messages, never events. Input and cache counts are exact live. The output count in these events is a placeholder
(the true total arrives only in the result event), so live output is estimated from the visible text and tool input
the events carry (CHARS_PER_TOKEN; hidden thinking is not visible, so it is a lower bound). The final `result` event's
`modelUsage` (per model, with Claude Code's own `costUSD`) replaces the live totals when it arrives; a run that never
sends one (cancelled, timed out, orphaned) keeps its live totals and a cost estimated from config/agent.yaml `prices`.
"""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

KINDS = ("input", "output", "cache_read", "cache_write_5m", "cache_write_1h")
CHARS_PER_TOKEN = 3                 # visible text and tool JSON; a lower bound for output while the run streams


def _zero() -> dict[str, int]:
    return dict.fromkeys(KINDS, 0)


def _visible_chars(msg: dict) -> int:
    n = 0
    for b in msg.get("content") or []:
        if b.get("type") == "text":
            n += len(b.get("text") or "")
        elif b.get("type") == "tool_use":
            n += len(json.dumps(b.get("input") or {}, ensure_ascii=False))
        elif b.get("type") == "thinking":
            n += len(b.get("thinking") or "")
    return n


def parse_assistant(line: str) -> tuple[str, str, dict] | None:
    """(message id, model, usage) of an assistant event, else None (a cheap prefix test first). The usage carries
    `_visible_chars`, the size of the event's text and tool input."""
    if '"assistant"' not in line[:200] or '"usage"' not in line:
        return None
    try:
        ev = json.loads(line)
    except json.JSONDecodeError:
        return None
    msg = ev.get("message") or {}
    if ev.get("type") != "assistant" or not msg.get("id") or not isinstance(msg.get("usage"), dict):
        return None
    return msg["id"], msg.get("model") or "unknown", {**msg["usage"], "_visible_chars": _visible_chars(msg)}


def _split(usage: dict) -> dict[str, int]:
    cc = usage.get("cache_creation") or {}
    one_h = int(cc.get("ephemeral_1h_input_tokens") or 0)
    total_write = int(usage.get("cache_creation_input_tokens") or 0)
    return {"input": int(usage.get("input_tokens") or 0), "output": int(usage.get("output_tokens") or 0),
            "cache_read": int(usage.get("cache_read_input_tokens") or 0),
            "cache_write_5m": max(total_write - one_h, 0), "cache_write_1h": one_h}


class Usage:
    """Live totals per model."""

    def __init__(self) -> None:
        self._messages: dict[str, tuple[str, dict[str, int]]] = {}     # message id → (model, its largest usage)
        self._chars: dict[str, int] = {}                               # message id → visible characters so far
        self._flushed = 0.0

    def add_line(self, line: str) -> bool:
        ev = parse_assistant(line)
        if ev is None:
            return False
        mid, model, raw = ev
        new = _split(raw)
        chars = self._chars.get(mid, 0) + int(raw.get("_visible_chars") or 0)   # each event carries its own blocks
        self._chars[mid] = chars
        new["output"] = max(new["output"], chars // CHARS_PER_TOKEN)
        old = self._messages.get(mid, (model, _zero()))[1]
        self._messages[mid] = (model, {k: max(old[k], new[k]) for k in KINDS})
        return True

    @property
    def by_model(self) -> dict[str, dict[str, int]]:
        out: dict[str, dict[str, int]] = {}
        for model, t in self._messages.values():
            acc = out.setdefault(model, _zero())
            for k in KINDS:
                acc[k] += t[k]
        return out

    def due(self, seconds: float) -> bool:
        now = time.monotonic()
        if now - self._flushed >= seconds:
            self._flushed = now
            return True
        return False

    def totals(self) -> dict[str, dict[str, int]]:
        return self.by_model

    @classmethod
    def from_stream(cls, path: Path, until: int | None = None) -> Usage:
        u = cls()
        if path.exists():
            with path.open("rb") as fh:
                data = fh.read() if until is None else fh.read(until)
            for line in data.decode(errors="replace").splitlines():
                u.add_line(line)
        return u


def from_model_usage(model_usage: dict[str, Any]) -> tuple[dict[str, dict[str, int]], float | None]:
    """The result event's modelUsage as totals per model, and Claude Code's own cost."""
    out, cost = {}, 0.0
    for model, u in (model_usage or {}).items():
        one_h = int(u.get("cacheCreationEphemeral1hInputTokens") or 0)
        out[model] = {"input": int(u.get("inputTokens") or 0), "output": int(u.get("outputTokens") or 0),
                      "cache_read": int(u.get("cacheReadInputTokens") or 0),
                      "cache_write_5m": max(int(u.get("cacheCreationInputTokens") or 0) - one_h, 0),
                      "cache_write_1h": one_h}
        cost += float(u.get("costUSD") or 0)
    return out, (round(cost, 6) if out else None)


def estimate_cost(totals: dict[str, dict[str, int]], prices: dict[str, dict[str, float]]) -> float | None:
    """$ from the price table (per million tokens). None when a model has no price: no guess."""
    cost = 0.0
    for model, t in totals.items():
        p = prices.get(model)
        if p is None:
            return None
        cost += sum(t.get(k, 0) * float(p.get(k, 0)) for k in KINDS) / 1_000_000
    return round(cost, 6)


def delta(now: dict[str, dict[str, int]], before: dict[str, dict[str, int]] | None) -> dict[str, dict[str, int]]:
    """What was used between two snapshots, per model (models with no change are left out)."""
    out = {}
    for model, t in now.items():
        b = (before or {}).get(model, {})
        d = {k: t.get(k, 0) - b.get(k, 0) for k in KINDS}
        if any(d.values()):
            out[model] = d
    return out


def short(totals: dict[str, dict[str, int]], cost: float | None = None) -> str:
    """'41k cache read, 1.2k out · ≈$0.05' for a log line."""
    sums = {k: sum(t.get(k, 0) for t in totals.values()) for k in KINDS}

    def k(n: int) -> str:
        return f"{n / 1000:.1f}k" if n >= 1000 else str(n)

    parts = [f"{k(sums['input'])} in", f"{k(sums['output'])} out", f"{k(sums['cache_read'])} cache read",
             f"{k(sums['cache_write_5m'] + sums['cache_write_1h'])} cache write"]
    return ", ".join(parts) + (f" · ≈${cost:.2f}" if cost is not None else "")
