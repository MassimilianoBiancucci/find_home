"""sites/qasa/scanner.py against fixtures shaped like real qasa.com pages (2026-10-31)."""
import importlib.util
from pathlib import Path

import httpx
import pytest

from findhome.config.loader import load_all
from findhome.scanning.filters import resolve
from findhome.scanning.runner import collect

REPO = Path(__file__).resolve().parents[3]
FIX = REPO / "backend" / "tests" / "fixtures" / "qasa"


def qasa_module():
    spec = importlib.util.spec_from_file_location("qasa_scanner_test", REPO / "sites" / "qasa" / "scanner.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_search_page_documents_and_mapping():
    mod = qasa_module()
    nodes, meta = mod.search_documents((FIX / "search_page.html").read_text())
    assert len(nodes) == 3 and meta == {"totalCount": 1149, "pagesCount": 20, "hasNextPage": True}
    a, b, c = (mod.document_to_listing(n) for n in nodes)
    assert a.source.external_id == "1497003" and a.source.url == "https://qasa.com/se/sv/home/1497003"
    assert a.rent_sek == 19600 and a.attributes["rent"] == 18500 and a.attributes["tenantBaseFee"] == 1100
    assert a.rooms_rok == 4 and a.size_m2 == 94 and a.attributes["bedroomCount"] == 3
    assert a.attributes["pets_flag"]["value"] is True and "petsAllowed" in a.attributes["pets_flag"]["evidence"]
    from findhome.pets import ingest_candidate
    assert ingest_candidate(a)[0::2] == ("yes", "site")      # Qasa's flag is the site's answer, not the agent's
    assert a.contract_type == "second_hand" and str(a.contract_end) == "2027-02-28"
    assert a.address_raw == "Valla torg, Årsta" and a.area == "Årsta" and a.lat == pytest.approx(59.294, abs=1e-3)
    assert a.floorplan_urls and a.photo_urls and a.floorplan_urls[0] not in a.photo_urls
    assert b.contract_end is None and b.attributes["open_ended"] is True and b.rooms_rok == 3.5
    assert c.contract_type == "first_hand" and c.pet_status == "unknown" and c.attributes["qasa_pets_allowed"] is False
    assert c.address_raw == "Ribegatan 12, Kista"



def test_whole_gallery_kept_photos_and_plans_split_in_order():
    mod = qasa_module()
    uploads = [{"type": "home_picture", "order": 20 - i, "url": f"https://img.example/p{20 - i}.jpg"} for i in range(20)]
    uploads += [{"type": "home_layout_picture", "order": 25, "url": "https://img.example/plan2.png"},
                {"type": "home_layout_picture", "order": 3, "url": "https://img.example/plan1.png"},
                {"type": "home_picture", "order": 30, "url": None}]
    doc = {"id": 1, "uploads": uploads, "location": {"locality": "Exempelby", "point": {"lat": 59.3, "lon": 18.0}}}
    item = mod.document_to_listing(doc)
    assert item.photo_urls == [f"https://img.example/p{i}.jpg" for i in range(1, 21)]
    assert item.floorplan_urls == ["https://img.example/plan1.png", "https://img.example/plan2.png"]
    assert item.attributes["photo_count"] == 20

def test_detail_facts_only_for_that_home():
    mod = qasa_module()
    facts = mod.detail_facts((FIX / "detail_page.html").read_text(), "1497003")
    assert facts == {"floor": 3, "buildingFloors": 4, "buildYear": 2021,
                     "traits": ["balcony", "elevator", "pets", "washing_machine"]}
    assert mod.detail_facts("<html></html>", "1") == {}


@pytest.mark.asyncio
async def test_scanner_urls_paging_and_enrich(tmp_repo, monkeypatch, tmp_path):
    mod = qasa_module()
    monkeypatch.setattr("findhome.scanning.generic.data_dir", lambda: tmp_path / "data")
    b = load_all(tmp_repo / "config", tmp_repo / "sites")
    site = b.sites["qasa"]
    seen = []

    def handler(request: httpx.Request):
        seen.append(str(request.url))
        if "/home/" in request.url.path:
            return httpx.Response(200, text=(FIX / "detail_page.html").read_text())
        page = int(request.url.params.get("page", 1))
        return httpx.Response(200, text=(FIX / "search_page.html").read_text() if page == 1 else "<html></html>")

    scanner = mod.QasaScanner(site, client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    items, stats, filt = await collect(site, b, max_pages=3, scanner=scanner)
    assert stats.parsed == 3 and stats.pages == 2 and not stats.errors
    first = seen[0]
    assert first.startswith("https://qasa.com/se/sv/find-home?")
    for part in ("searchAreas=Stockholms_l%C3%A4n~~se", "sharedHome=privateHome", "rules=pets", "minRoomCount=2", "page=1"):
        assert part in first
    assert filt["params"]["rules"] == "pets" and "contract_types" in filt["local_only"]
    enriched = await scanner.enrich(items[0])
    assert enriched.floor == 3 and enriched.build_year == 2021 and enriched.has_balcony and enriched.has_elevator
    assert enriched.attributes["building_floors"] == 4


def test_pets_filter_param_dropped_when_not_required(tmp_repo):
    from findhome.config.writer import apply_ops
    apply_ops("profile", [{"op": "replace", "path": "/kinds/rent/hard_filters/pet_status_exclude", "value": []}],
              tmp_repo / "config", tmp_repo / "sites")
    b = load_all(tmp_repo / "config", tmp_repo / "sites")
    assert "rules" not in resolve(b, b.sites["qasa"], "rent").params


def test_cli_parser_converts_extract_output(tmp_path, monkeypatch):
    """`findhome ingest listings --parser qasa` turns extract.js output into ListingIn payloads."""
    from findhome.cli import main as cli

    mod = qasa_module()
    nodes, _ = mod.search_documents((FIX / "search_page.html").read_text())
    convert = cli._site_parser("qasa")
    items = [convert(n) for n in nodes]
    assert [i.source.method for i in items] == ["agent_browser"] * 3
    assert items[0].rent_sek == 19600 and items[0].attributes["pets_flag"]["value"] is True


def test_summary_line_shows_fetch_errors():
    from findhome.scanning.runner import summary_line

    s = {"site": "qasa", "seen": 0, "parse_errors": 0, "method": "http", "seconds": 0.2,
         "errors": ["page 1: HTTPStatusError 429 (the site refuses scripted requests: use fetch.method agent_browser)"]}
    assert "429" in summary_line(s) and "agent_browser" in summary_line(s)


def test_node_kept_whole_price_split_and_bump_date_apart():
    from findhome.domain.models import DESCRIPTION_MAX

    mod = qasa_module()
    node = {"id": 1400001, "monthlyCost": 11654, "rent": 11000, "tenantBaseFee": 654, "startDate": "2027-01-01",
            "publishedAt": "2026-07-01T07:32:52Z", "publishedOrBumpedAt": "2026-10-26T19:50:40Z",
            "displayStreetNumber": False, "rentalLengthSeconds": 0, "sortingScore": 0.5, "description": "x" * 5000,
            "location": {"route": "Exempelgatan", "locality": "Exempelby", "point": {"lat": 59.4, "lon": 17.9}},
            "uploads": [{"type": "home_layout_picture", "url": "https://img.invalid/plan.jpg", "order": 1}],
            "_seen": "2026-11-16"}
    item = mod.to_listing(node)
    a = item.attributes
    assert item.rent_sek == 11654 and a["price"] == {"rent": 11000, "tenant_base_fee": 654, "monthly_cost": 11654}
    assert a["publishedAt"] == "2026-07-01T07:32:52Z" and a["publishedOrBumpedAt"] == "2026-10-26T19:50:40Z"
    assert a["qasa"] == {"displayStreetNumber": False, "rentalLengthSeconds": 0, "sortingScore": 0.5}
    assert len(item.description_excerpt) == 5000 < DESCRIPTION_MAX
    assert a["address_parts"] == {"street": "Exempelgatan", "locality": "Exempelby"}
    assert a["floorplans"] == [{"url": "https://img.invalid/plan.jpg", "kind": "image"}]


def test_listing_page_detail_mapping():
    mod = qasa_module()
    out = mod.detail_to_listing({
        "listing": True, "status": "normal", "floor": 2, "buildingFloors": 5, "buildYear": 1962, "furnished": False,
        "rent": 11000, "tenantBaseFee": 654,
        "duration": {"startOptimal": "2027-01-01T00:00:00Z", "endOptimal": None, "endUfn": True,
                     "possibilityOfExtension": False},
        "traits": [{"type": "balcony", "detail": None}, {"type": "pets", "detail": "pets_allowed"},
                   {"type": "furniture", "detail": "partially_furnished"}], "furnishing": "partially_furnished",
        "landlord_professional": True,
        "location": {"latitude": 59.4, "longitude": 17.9, "route": "Exempelgatan", "locality": "Exempelby"},
        "photos": ["https://img.invalid/a.jpg"], "plan_photos": ["https://img.invalid/p.jpg"]})
    assert (out["floor"], out["build_year"], out["rent_sek"], out["available_from"]) == (2, 1962, 11654, "2027-01-01")
    assert out["has_balcony"] and out["has_elevator"] is False and "contract_end" not in out
    a = out["attributes"]
    assert a["open_ended"] and a["qasa_status"] == "normal" and a["pets_flag"]["value"] is True
    assert a["floorplans"] == [{"url": "https://img.invalid/p.jpg", "kind": "image"}]
    assert "furnished" not in out and a["furnishing_raw"] == "partially_furnished"
    unfurnished = mod.detail_to_listing({"listing": True, "furnishing": "unfurnished", "traits": []})
    assert unfurnished["furnished"] is False
