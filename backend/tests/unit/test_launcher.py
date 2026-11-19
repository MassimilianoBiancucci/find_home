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
    values = {"site": "qasa", "pages": 2, "run_id": "r1", "session_id": "s1", "max_turns": max_turns(prof, {"pages": 2}),
              "profile": "browser_scan", "run_short": "r1abcdef"}
    argv = build_argv(prof, "PROMPT", values)
    assert argv[:3] == ["claude", "-p", "PROMPT"]
    assert argv[argv.index("--session-id") + 1] == "s1"
    assert argv[argv.index("-n") + 1] == "findhome-browser_scan-r1abcdef"     # the name claude agents --json shows
    assert argv[argv.index("--max-turns") + 1] == "18"                      # 12 + 3 per page
    tools = argv[argv.index("--allowedTools") + 1].split(",")
    assert "mcp__claude-in-chrome__javascript_tool" in tools
    assert not any(t.startswith(("Write", "mcp__claude-in-chrome__computer")) for t in tools)   # pages go by post
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


def test_search_urls_page_by_url_without_pet_or_date_filters(bundle):
    from findhome.inbox import browser_paging, scan_urls

    sam = scan_urls(bundle.sites["samtrygg"], bundle)
    assert sam[0] == "https://www.samtrygg.se/RentalObject/NewSearch?place=Stockholm&sort=newest&page=1"
    assert len(sam) == 20 and browser_paging(bundle.sites["samtrygg"]) == {"page_size": 24}
    qasa = scan_urls(bundle.sites["qasa"], bundle)
    assert all("rules=" not in u and "earliestMoveIn" not in u and "move" not in u.lower() for u in qasa)
    assert "page=20" in qasa[-1]


def test_url_filter_policy(bundle):
    from findhome.scanning.filters import resolve

    site = bundle.sites["qasa"]
    hf = bundle.profile.kinds["rent"].hard_filters
    saved = dict(hf)
    try:
        hf.update(max_rent_sek=13000, pet_status_exclude=["no"], move_in_from="2027-01-01")
        fm = {**site.filter_map, "pets_allowed": {"param": "rules", "value_map": {"true": "pets"}},
              "move_in_from": {"param": "earliestMoveIn"}}
        params = resolve(bundle, site.model_copy(update={"filter_map": fm}), "rent").params
        assert params["maxMonthlyCost"] == 13000 and "rules" not in params and "earliestMoveIn" not in params
        never = site.model_copy(update={"fetch": {**site.fetch, "url_filter_policy": {"mode": "never"}}})
        assert "maxMonthlyCost" not in resolve(bundle, never, "rent").params
    finally:
        hf.clear()
        hf.update(saved)

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
