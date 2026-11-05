"""Compiled pet wording rules from config/pet_rules.yaml (reloaded with the config bundle)."""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from ruamel.yaml import YAML

log = logging.getLogger(__name__)
CLASSES = ("no", "ask", "yes")
FOLD = str.maketrans({"å": "a", "ä": "a", "ö": "o", "é": "e", "è": "e", "ü": "u"})


@dataclass(frozen=True)
class Rule:
    id: str            # "sv.no.0"
    status: str        # no | ask | yes
    pattern: re.Pattern


@dataclass(frozen=True)
class RuleSet:
    rules: tuple[Rule, ...]
    exceptions: tuple[re.Pattern, ...]
    max_chars: int = 160


def normalise(text: str) -> str:
    """Lower-case and fold å/ä/ö, keeping one character per input character so match offsets index the original."""
    return "".join((c.lower()[:1] or c).translate(FOLD) for c in text)


def compile_rules(data: dict) -> RuleSet:
    rules, exceptions = [], []
    for lang, pack in (data.get("languages") or {}).items():
        for cls in CLASSES:
            for i, pat in enumerate(pack.get(cls) or []):
                rules.append(Rule(f"{lang}.{cls}.{i}", cls, re.compile(pat)))
        exceptions += [re.compile(p) for p in pack.get("exceptions") or []]
    return RuleSet(tuple(rules), tuple(exceptions), int((data.get("evidence") or {}).get("max_chars", 160)))


@lru_cache(maxsize=4)
def _from_file(path: str, mtime: float) -> RuleSet:
    return compile_rules(YAML(typ="safe").load(Path(path).read_text(encoding="utf-8")) or {})


def current() -> RuleSet:
    """Rules of the loaded config bundle, else config/pet_rules.yaml read directly (CLI, tests)."""
    try:
        from findhome.config.store import get_store

        bundle = get_store().bundle
        if bundle is not None:
            return _from_bundle(id(bundle), bundle.pet_rules.model_dump())
    except Exception:  # noqa: BLE001 - no config store (CLI, tests): fall back to the file
        log.debug("pet rules: no loaded config bundle, reading config/pet_rules.yaml")
    from findhome.core.paths import config_dir

    path = config_dir() / "pet_rules.yaml"
    return _from_file(str(path), path.stat().st_mtime) if path.exists() else RuleSet((), ())


_bundle_cache: dict[int, RuleSet] = {}


def _from_bundle(key: int, data: dict) -> RuleSet:
    if key not in _bundle_cache:
        _bundle_cache.clear()
        _bundle_cache[key] = compile_rules(data)
    return _bundle_cache[key]
