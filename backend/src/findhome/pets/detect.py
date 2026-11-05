"""Find a listing's pet policy in its text with the strict rules (no guessing: no explicit phrase → unknown)."""
from __future__ import annotations

import re
from dataclasses import dataclass

from findhome.pets.rules import RuleSet, current, normalise

_SENTENCE_END = re.compile(r"[.!?\n;]")


@dataclass(frozen=True)
class PetFinding:
    status: str                     # yes | no | ask | conflict | unknown
    evidence: str | None = None     # quoted sentence(s) from the original text
    rule: str | None = None         # rule id(s), e.g. "sv.no.0"


def _sentence(text: str, start: int, end: int, max_chars: int) -> str:
    left = max((m.end() for m in _SENTENCE_END.finditer(text, 0, start)), default=0)
    right_m = _SENTENCE_END.search(text, end)
    right = right_m.start() + 1 if right_m else len(text)
    quote = " ".join(text[left:right].split())
    if len(quote) > max_chars:                      # keep the match in view
        mid = (start + end) // 2 - left
        a = max(0, mid - max_chars // 2)
        quote = ("…" if a else "") + quote[a:a + max_chars].strip() + "…"
    return quote


def detect(text: str | None, rules: RuleSet | None = None) -> PetFinding:
    if not text or not text.strip():
        return PetFinding("unknown")
    rs = rules or current()
    norm = normalise(text)
    for exc in rs.exceptions:                       # blank phrases that only look like a rule
        norm = exc.sub(lambda m: " " * len(m.group(0)), norm)
    hits: dict[str, tuple[str, int, int]] = {}
    for rule in rs.rules:
        if rule.status in hits:
            continue
        m = rule.pattern.search(norm)
        if m:
            hits[rule.status] = (rule.id, m.start(), m.end())

    def quote(cls: str) -> str:
        _, a, b = hits[cls]
        return _sentence(text, a, b, rs.max_chars)

    if "no" in hits and "yes" in hits:
        return PetFinding("conflict", f'"{quote("no")}" / "{quote("yes")}"', f'{hits["no"][0]},{hits["yes"][0]}')
    for cls in ("no", "ask", "yes"):
        if cls in hits:
            return PetFinding(cls, quote(cls), hits[cls][0])
    return PetFinding("unknown")
