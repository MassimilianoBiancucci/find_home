"""Comment-preserving config edits (used by the API / UI).

Two entry points:
  apply_ops(name, ops)   JSON-Patch-like ops (add | replace | remove) on one YAML file
  write_text(name, text) replace a whole file with user-edited text (Settings editor)

Both validate the WHOLE config set against a temporary copy before touching the real file,
then write atomically (temp file + rename). Comments and key order survive because the
file is round-tripped with ruamel.yaml.
"""
from __future__ import annotations

import io
import os
import shutil
import tempfile
from pathlib import Path
from typing import Any

from ruamel.yaml import YAML

from findhome.config.loader import CONFIG_FILES, ConfigError, validate_all
from findhome.core.paths import config_dir as default_config_dir
from findhome.core.paths import sites_dir as default_sites_dir


def _rt_yaml() -> YAML:
    y = YAML()  # round-trip
    y.preserve_quotes = True
    y.width = 120
    y.indent(mapping=2, sequence=4, offset=2)
    # write explicit `null` (ruamel would leave the value empty, which reads like a mistake)
    y.representer.add_representer(
        type(None), lambda rep, _data: rep.represent_scalar("tag:yaml.org,2002:null", "null"))
    return y


def _split(path: str) -> list[str]:
    if not path.startswith("/"):
        raise ValueError(f"path must start with '/': {path}")
    return [p.replace("~1", "/").replace("~0", "~") for p in path.split("/")[1:]]


def _resolve(doc: Any, parts: list[str]) -> tuple[Any, str | int]:
    node = doc
    for part in parts[:-1]:
        node = node[int(part)] if isinstance(node, list) else node[part]
    last = parts[-1]
    return node, (int(last) if isinstance(node, list) and last != "-" else last)


def apply_ops_to_doc(doc: Any, ops: list[dict[str, Any]]) -> Any:
    for op in ops:
        kind, parts = op["op"], _split(op["path"])
        parent, key = _resolve(doc, parts)
        if kind == "replace":
            if isinstance(parent, list):
                parent[key] = op["value"]
            else:
                if key not in parent:
                    raise KeyError(f"replace: {op['path']} does not exist")
                parent[key] = op["value"]
        elif kind == "add":
            if isinstance(parent, list):
                if key == "-":
                    parent.append(op["value"])
                else:
                    parent.insert(key, op["value"])
            else:
                parent[key] = op["value"]
        elif kind == "remove":
            del parent[key]
        else:
            raise ValueError(f"unsupported op: {kind}")
    return doc


def _check_name(name: str) -> None:
    if name not in CONFIG_FILES:
        raise ValueError(f"unknown config '{name}' (allowed: {', '.join(CONFIG_FILES)})")


def _validate_candidate(name: str, text: str, cdir: Path, sdir: Path) -> None:
    with tempfile.TemporaryDirectory(prefix="fh-config-") as tmp:
        tmp_cfg = Path(tmp) / "config"
        shutil.copytree(cdir, tmp_cfg, ignore=shutil.ignore_patterns("*.env"))
        (tmp_cfg / f"{name}.yaml").write_text(text, encoding="utf-8")
        errors = validate_all(tmp_cfg, sdir)
    if errors:
        raise ConfigError(errors)


def _atomic_write(path: Path, text: str) -> None:
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def write_text(name: str, text: str, config_dir: Path | None = None, sites_dir: Path | None = None) -> None:
    _check_name(name)
    cdir, sdir = Path(config_dir or default_config_dir()), Path(sites_dir or default_sites_dir())
    _validate_candidate(name, text, cdir, sdir)
    _atomic_write(cdir / f"{name}.yaml", text)


def apply_ops(name: str, ops: list[dict[str, Any]], config_dir: Path | None = None,
              sites_dir: Path | None = None) -> str:
    """Apply ops to config/<name>.yaml, keeping comments. Returns the new text."""
    _check_name(name)
    cdir = Path(config_dir or default_config_dir())
    path = cdir / f"{name}.yaml"
    y = _rt_yaml()
    doc = y.load(path.read_text(encoding="utf-8"))
    apply_ops_to_doc(doc, ops)
    buf = io.StringIO()
    y.dump(doc, buf)
    text = buf.getvalue()
    write_text(name, text, cdir, sites_dir)
    return text
