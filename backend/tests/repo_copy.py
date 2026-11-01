"""A disposable copy of config/ and sites/ that never contains the user's personal files.

Personal config files (config/locations.yaml, profile.yaml, search_area.yaml and the *.env files) are gitignored and
exist only on the owner's machine. Tests build their config from the committed *.example.yaml templates, then swap in
the frozen locations fixture, so they pass on a fresh clone and never read or geocode anyone's real data.
"""
from __future__ import annotations

import shutil
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
FIXTURES = Path(__file__).resolve().parent / "fixtures"


def personal_yaml_names(config_dir: Path = REPO / "config") -> set[str]:
    """Real file names that have a committed example sibling (locations.example.yaml -> locations.yaml)."""
    return {p.name.replace(".example.yaml", ".yaml") for p in config_dir.glob("*.example.yaml")}


def build_test_repo(dest: Path) -> Path:
    cfg = REPO / "config"
    shutil.copytree(cfg, dest / "config", ignore=shutil.ignore_patterns("*.env", *personal_yaml_names(cfg)))
    for example in cfg.glob("*.example.yaml"):
        shutil.copy(example, dest / "config" / example.name.replace(".example.yaml", ".yaml"))
    shutil.copy(FIXTURES / "locations.yaml", dest / "config" / "locations.yaml")
    if (REPO / "sites").exists():
        shutil.copytree(REPO / "sites", dest / "sites")
    else:
        (dest / "sites").mkdir()
    return dest
