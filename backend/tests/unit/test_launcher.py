"""Agent launcher: parameters validated before launch, argv substitution, the VS Code link."""
from __future__ import annotations

from urllib.parse import unquote

import pytest

from findhome.agentrun.launcher import AgentRunError, build_argv, max_turns, resolve_params, vscode_link
from findhome.config.loader import load_all


@pytest.fixture(scope="module")
def bundle(shared_repo):
    return load_all(shared_repo / "config", shared_repo / "sites")


def test_browser_scan_params(bundle):
    prof = bundle.agent.profiles["browser_scan"]
    assert resolve_params(bundle, prof, {"site": "qasa"}) == {"site": "qasa", "pages": 20, "model": "sonnet"}
    assert resolve_params(bundle, prof, {"site": "qasa", "pages": "3"})["pages"] == 3
    with pytest.raises(AgentRunError, match="between"):
        resolve_params(bundle, prof, {"site": "qasa", "pages": 21})
    with pytest.raises(AgentRunError, match="origin-only"):
        resolve_params(bundle, prof, {"site": "blocket-bostad"})
    with pytest.raises(AgentRunError, match="required"):
        resolve_params(bundle, prof, {})
    with pytest.raises(AgentRunError, match="unknown parameter"):
        resolve_params(bundle, prof, {"site": "qasa", "shell": "rm -rf"})


def test_argv_substitution(bundle):
    prof = bundle.agent.profiles["browser_scan"]
    values = {"site": "qasa", "pages": 2, "run_id": "r1", "session_id": "s1", "max_turns": max_turns(prof, {"pages": 2})}
    argv = build_argv(prof, "PROMPT", values)
    assert argv[:3] == ["claude", "-p", "PROMPT"]
    assert argv[argv.index("--session-id") + 1] == "s1"
    assert argv[argv.index("--max-turns") + 1] == "64"                      # 40 + 12 per page
    tools = argv[argv.index("--allowedTools") + 1].split(",")
    assert "mcp__claude-in-chrome__javascript_tool" in tools and "Write(./inbox/**)" in tools
    assert not any("{" in a for a in argv)
    # a placeholder without a value drops itself and its flag
    values.pop("session_id")
    argv = build_argv(prof, "P", values)
    assert "--session-id" not in argv


def test_vscode_link_is_fully_encoded():
    link = vscode_link("follow x.md with site=qasa pages=20 run=abc & more")
    assert link.startswith("vscode://anthropic.claude-code/open?prompt=")
    assert " " not in link and "&" not in link.split("?", 1)[1]
    assert unquote(link.split("prompt=", 1)[1]) == "follow x.md with site=qasa pages=20 run=abc & more"


def test_move_in_sweep_and_browser_inputs(bundle):
    from findhome.inbox import browser_inputs, move_in_sweep

    assert move_in_sweep("2026-12-01", "2027-04-30") == ["2026-12-01", "2027-01-01", "2027-02-01", "2027-03-01",
                                                         "2027-04-01"]
    assert move_in_sweep("2026-12-15", "2027-01-10") == ["2026-12-15", "2027-01-01"]
    assert move_in_sweep(None, "2027-01-01") == [] and move_in_sweep("2027-02-01", "2027-01-01") == []
    site = bundle.sites["samtrygg"]
    hf = bundle.profile.kinds["rent"].hard_filters
    got = browser_inputs(site, bundle)
    assert got["avoid_paths"] and got["inputs"][0]["label"] == "Önskat tillträde"
    if hf.get("move_in_from") and hf.get("move_in_to"):
        assert got["input_sets"] and not got["inputs_missing"]
    else:                                                   # the example profile leaves the window unset
        assert got["input_sets"] == [] and got["inputs_missing"]
    assert browser_inputs(bundle.sites["qasa"], bundle) == {}


def test_model_is_a_launch_parameter(bundle):
    for name, default in (("browser_scan", "sonnet"), ("site_onboarding", "opus"), ("pet_agent_check", "sonnet")):
        prof = bundle.agent.profiles[name]
        assert prof.params["model"]["default"] == default
        assert '{model}' in prof.args
    prof = bundle.agent.profiles["browser_scan"]
    assert resolve_params(bundle, prof, {"site": "qasa"})["model"] == "sonnet"
    assert resolve_params(bundle, prof, {"site": "qasa", "model": "haiku"})["model"] == "haiku"
    with pytest.raises(AgentRunError, match="one of"):
        resolve_params(bundle, prof, {"site": "qasa", "model": "gpt"})
    argv = build_argv(prof, "P", {"site": "qasa", "pages": 1, "model": "opus", "run_id": "r", "session_id": "s",
                                  "max_turns": 50})
    assert argv[argv.index("--model") + 1] == "opus"
