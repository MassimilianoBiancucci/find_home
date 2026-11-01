from typer.testing import CliRunner

from findhome.cli.main import app

runner = CliRunner()


def test_help_lists_commands():
    res = runner.invoke(app, ["--help"])
    assert res.exit_code == 0
    for cmd in ("scan", "commute", "digest", "ingest", "listings", "site", "run", "config", "db"):
        assert cmd in res.output


def test_config_validate_ok(shared_repo, monkeypatch):
    """Runs against the committed examples, not the owner's personal config files."""
    from findhome.core import paths

    monkeypatch.setenv("FINDHOME_ROOT", str(shared_repo))
    paths.repo_root.cache_clear()
    try:
        res = runner.invoke(app, ["config", "validate"])
    finally:
        paths.repo_root.cache_clear()
    assert res.exit_code == 0, res.output
    assert "config valid" in res.output


def test_schema_markdown_mentions_contract():
    res = runner.invoke(app, ["config", "schema", "ingest", "--markdown"])
    assert res.exit_code == 0
    assert "### ListingIn" in res.output and "pet_status" in res.output


def test_api_down_message():
    res = runner.invoke(app, ["--api", "http://127.0.0.1:9", "digest", "history"])
    assert res.exit_code == 2
