"""Site capabilities (what may scan a site, and why not) and listing origin mapping."""
from __future__ import annotations

import pytest

from findhome.config.models import SiteConfig
from findhome.db.repo import origin_site
from findhome.domain.models import ListingIn
from findhome.scanning.runner import ScanError, make_scanner

BASE = {"slug": "demo", "name": "Demo", "url": "https://demo.example", "kinds": ["rent"], "status": "active",
        "fetch": {"method": "http"}, "filter_map": {}, "auth": {"mode": "none"}, "politeness": {}}


def site(**over) -> SiteConfig:
    data = {**BASE, **over}
    return SiteConfig.model_validate(data)


def test_script_scan_reasons():
    assert site().script_scan() == (True, None)
    assert site(role="origin").script_scan()[0] is False
    off = site(scan={"script": {"enabled": False, "reason": "answers 429"}})
    assert off.script_scan() == (False, "answers 429")
    assert "browser" in site(fetch={"method": "agent_browser"}).script_scan()[1]
    assert "onboard" in site(fetch={"method": None}).script_scan()[1]


def test_browser_scan_and_pages():
    assert site(fetch={"method": "agent_browser"}).browser_scan() == (True, None)
    assert site(role="origin").browser_scan()[0] is False
    b = site(scan={"browser": {"enabled": True, "default_pages": 30, "max_pages": 20}})
    assert b.browser_pages() == (20, 20)
    assert site(politeness={"max_pages_per_run": 4}).browser_pages() == (4, 4)


def test_make_scanner_refuses_before_loading_scanner_py(monkeypatch, tmp_path):
    """A disabled scripted scan never reaches the site's scanner.py (it would send HTTP requests)."""
    (tmp_path / "demo").mkdir()
    (tmp_path / "demo" / "scanner.py").write_text("raise RuntimeError('loaded')\n")
    monkeypatch.setattr("findhome.scanning.runner.sites_dir", lambda: tmp_path)
    with pytest.raises(ScanError, match="429"):
        make_scanner(site(scan={"script": {"enabled": False, "reason": "answers 429"}}))
    with pytest.raises(ScanError, match="origin-only"):
        make_scanner(site(role="origin"))


def _item(site_slug: str, platform: str | None) -> ListingIn:
    return ListingIn.model_validate({"source": {"site_slug": site_slug, "external_id": "1"},
                                     "attributes": {"platform": platform} if platform else {}})


def test_origin_site_mapping():
    platforms = {"agg": {"alpha": "alpha-site", "self": "agg"}}
    assert origin_site(_item("agg", "alpha"), platforms) == "alpha-site"
    assert origin_site(_item("agg", "self"), platforms) == "agg"
    assert origin_site(_item("agg", "unmapped"), platforms) == "agg"
    assert origin_site(_item("other", None), platforms) == "other"
