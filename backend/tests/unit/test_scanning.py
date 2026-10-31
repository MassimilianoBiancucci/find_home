import httpx
import pytest

from findhome.config.loader import load_all
from findhome.config.models import SiteConfig
from findhome.scanning.filters import resolve
from findhome.scanning.generic import HttpListScanner
from findhome.scanning.probe import analyse_html, write_outputs
from findhome.scanning.runner import collect

HTML = """<html><body>
<article class="card" data-id="a1"><a href="/l/a1">Ljus tvåa</a><span class="price">12 900 kr/mån</span>
<span class="size">48 m²</span><span class="rooms">2 rok</span><span class="addr">Hornsgatan 5</span>
<p class="desc">Husdjur enligt överenskommelse</p></article>
<article class="card" data-id="a2"><a href="/l/a2">Etta</a><span class="price">9 500 kr</span>
<span class="size">30 m²</span><span class="rooms">1 rok + sovalkov</span><span class="addr">Odengatan 1</span></article>
</body></html>"""


def site(**over):
    data = {"slug": "testsite", "name": "Test", "url": "https://test.invalid", "kinds": ["rent"], "status": "active",
            "fetch": {"order": ["http"], "method": "http",
                      "list_url_template": "https://test.invalid/search?city=stockholm",
                      "selectors": {"item": "article.card", "external_id": "@data-id", "url": "a@href", "title": "a",
                                    "rent_sek": ".price", "size_m2": ".size", "rooms": ".rooms",
                                    "address_raw": ".addr", "description_excerpt": ".desc"},
                      "pagination": {"type": "page_param", "param": "page", "max_pages": 3}},
            "filter_map": {"max_rent_sek": {"param": "maxRent"}, "min_rooms_rok": {"local_only": True},
                           "pets_allowed": {"param": "pets", "value_map": {"true": 1}}},
            "auth": {"mode": "none"}, "politeness": {"min_delay_s": 0, "max_pages_per_run": 2, "respect_robots": False}}
    data.update(over)
    return SiteConfig.model_validate(data)


def test_filters_resolve(tmp_repo):
    b = load_all(tmp_repo / "config", tmp_repo / "sites")
    r = resolve(b, site(), "rent")
    assert r.params == {"pets": 1}                 # max_rent is null (TODO user), pets_allowed derived True
    assert "min_rooms_rok" in r.local_only


@pytest.mark.asyncio
async def test_generic_http_scanner_parses_items(tmp_repo, tmp_path, monkeypatch):
    monkeypatch.setattr("findhome.scanning.generic.data_dir", lambda: tmp_path / "data")
    pages = []

    def handler(request: httpx.Request):
        pages.append(str(request.url))
        page = int(request.url.params.get("page", 1))
        return httpx.Response(200, text=HTML if page == 1 else "<html></html>")

    s = site()
    scanner = HttpListScanner(s, client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    b = load_all(tmp_repo / "config", tmp_repo / "sites")
    items, stats, filt = await collect(s, b, scanner=scanner)
    assert stats.parsed == 2 and stats.pages == 2       # second page empty → stop
    first = items[0]
    assert first.source.external_id == "a1" and first.source.url == "https://test.invalid/l/a1"
    assert first.rent_sek == 12900 and first.size_m2 == 48 and first.rooms_rok == 2
    assert first.pet_status == "ask"
    assert items[1].has_sovalkov is True
    assert "pets=1" in pages[0] and "page=1" in pages[0]
    assert first.source.raw_snapshot_path.endswith("page-1.html")


def test_probe_signals_and_outputs(tmp_path, monkeypatch, repo_root):
    rep = analyse_html("https://x.invalid/s?area=sthlm", 200, HTML + '<script src="https://x.invalid/api/v1/search"></script>'
                       '<script>fetch("https://x.invalid/api/v1/search?q=1")</script>')
    assert rep.price_hits >= 2 and rep.recommendation == "api"
    import shutil
    shutil.copytree(repo_root / "sites" / "_template", tmp_path / "sites" / "_template")
    monkeypatch.setattr("findhome.scanning.probe.sites_dir", lambda: tmp_path / "sites")
    out = write_outputs(rep, "newsite", "New Site")
    text = (tmp_path / "sites" / "newsite" / "site.yaml").read_text()
    assert "slug: newsite" in text and "method: api" in text and "url: https://x.invalid" in text
    assert "report" in out
