"""Personal-data principle (guide/principles/personal_data.md): real files are gitignored, only dummy examples are
committed, examples work, and the docs say how to set them up. Needs git; skipped outside a git checkout."""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

import pytest
from dotenv import dotenv_values

REPO = Path(__file__).resolve().parents[3]
CONFIG = REPO / "config"
PERSONAL_YAML = ("locations", "profile", "search_area")


def _git(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(REPO), *args], capture_output=True, text=True, check=False)


@pytest.fixture(scope="module")
def tracked() -> set[str]:
    res = _git("ls-files")
    if res.returncode != 0:
        pytest.skip("not a git checkout")
    return set(res.stdout.splitlines())


def _examples() -> list[Path]:
    return sorted(CONFIG.glob("*.example.yaml")) + sorted(CONFIG.glob("*.env.example"))


def _real_name(example: Path) -> str:
    return example.name.replace(".example.yaml", ".yaml") if example.name.endswith(".example.yaml") else example.name[: -len(".example")]


def test_every_personal_yaml_has_an_example(tracked):
    for name in PERSONAL_YAML:
        assert f"config/{name}.example.yaml" in tracked, f"config/{name}.example.yaml must be committed"


def test_real_personal_files_are_ignored_and_not_tracked(tracked):
    for example in _examples():
        real = f"config/{_real_name(example)}"
        assert _git("check-ignore", "-q", real).returncode == 0, f"{real} must be in .gitignore"
        assert real not in tracked, f"{real} is personal and must not be tracked (git rm --cached {real})"


def test_no_env_key_or_certificate_files_are_tracked(tracked):
    bad = [f for f in tracked
           if re.search(r"(^|/)\.env($|\.)|\.env$", f) and not f.endswith(".example")
           or re.search(r"\.(pem|key|p12|pfx)$|(^|/)id_(rsa|ed25519)", f)]
    assert not bad, f"secret-looking files are tracked: {bad}"


def test_env_examples_name_every_variable_the_config_reads_and_hold_no_secrets():
    wanted: set[str] = set()
    for path in CONFIG.glob("*.yaml"):
        if path.name.split(".")[0] in PERSONAL_YAML and not path.name.endswith(".example.yaml"):
            continue                                              # personal files are not part of the repo
        wanted |= set(re.findall(r"\b\w+_env:\s*([A-Z][A-Z0-9_]+)", path.read_text(encoding="utf-8")))
    declared: dict[str, str | None] = {}
    for path in CONFIG.glob("*.env.example"):
        declared |= dotenv_values(path)
    assert wanted, "no *_env references found: the test is out of date"
    assert wanted <= set(declared), f"missing from the env examples: {sorted(wanted - set(declared))}"
    for key, value in declared.items():
        if key.startswith("FINDHOME_"):
            continue                                              # local defaults, checked below
        assert not value, f"{key} must be empty in its example (secrets never go in git)"
    url = declared.get("FINDHOME_DATABASE_URL") or ""
    assert "@localhost" in url or "@127.0.0.1" in url, "FINDHOME_DATABASE_URL: only a localhost default may be committed"


def test_examples_say_what_they_are():
    for example in _examples():
        head = "\n".join(example.read_text(encoding="utf-8").splitlines()[:14]).lower()
        assert "example" in head and "gitignored" in head, f"{example.name}: header must say it is an example and the real file is gitignored"


def test_config_readme_names_every_example():
    readme = (CONFIG / "README.md").read_text(encoding="utf-8")
    for example in _examples():
        assert example.name in readme, f"config/README.md must explain {example.name}"
    assert "config/README.md" in (REPO / "README.md").read_text(encoding="utf-8")


KEY_PATTERNS = {
    "Google API key": re.compile(r"AIza[0-9A-Za-z_\-]{35}"),
    "GitHub token": re.compile(r"gh[pousr]_[A-Za-z0-9]{36,}"),
    "OpenAI/Anthropic style key": re.compile(r"\bsk-[A-Za-z0-9_\-]{32,}"),
    "private key block": re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    "key assigned in an env line": re.compile(r"^[A-Z0-9_]*(?:API_KEY|_TOKEN|SECRET)[A-Z0-9_]*=\S{8,}$", re.MULTILINE),
}
SKIP = re.compile(r"(^|/)(package-lock\.json|poetry\.lock)$|\.(png|jpe?g|gif|ico|woff2?|pdf|zip)$")


def test_no_key_like_strings_in_tracked_files(tracked):
    hits = []
    for rel in sorted(tracked):
        if SKIP.search(rel) or not (REPO / rel).is_file() or (REPO / rel).stat().st_size > 1_000_000:
            continue
        try:
            text = (REPO / rel).read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        hits += [f"{rel}: {label}" for label, rx in KEY_PATTERNS.items() if rx.search(text)]
    assert not hits, "key-like strings in tracked files:\n" + "\n".join(hits)
