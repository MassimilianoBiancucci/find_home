"""The scripted sites' page status rules (site.yaml ad_status), on fictional HTML (sub-plan #11)."""
from __future__ import annotations

from datetime import date

import yaml

from findhome.core.paths import sites_dir
from findhome.jobs.status import page_status

RULES = yaml.safe_load((sites_dir() / "bostadsformedlingen" / "site.yaml").read_text(encoding="utf-8"))["ad_status"]
URL = "https://bostad.stockholm.se/bostad/999999/"


def box(text: str) -> str:
    return (f'<div class="house-body-intresseanmalan"><div class="house-content"><strong>{text}</strong>'
            '<p>Påhittad text.</p></div></div>')


def test_the_status_box_redirect_and_deadline():
    assert page_status(box("Bostaden är förmedlad. Kötid 2019-03-01"), URL, RULES)[0] == "rented"
    assert page_status(box("Annonseringen är avslutad"), URL, RULES)[0] == "applications_closed"
    assert page_status(box("Annonsen är avregistrerad"), URL, RULES)[0] == "removed"
    assert page_status(box("För att anmäla intresse behöver du logga in"), URL, RULES)[0] == "open"
    status, ev = page_status("<html></html>", "https://bostad.stockholm.se/annonsen-ar-inte-langre-tillganglig/", RULES)
    assert status == "removed" and ev["rule"] == "redirect"
    late = page_status(box("Något nytt"), URL, RULES, apply_by="2026-11-01", today=date(2026, 11, 19))
    assert late == ("applications_closed", {"rule": "deadline passed", "value": "2026-11-01"})
    assert page_status(box("Något nytt"), URL, RULES)[0] == "unknown"
    # the open prompt after the deadline: the anonymous view, not an open ad
    prompt = box("För att anmäla intresse behöver du vara registrerad som bostadssökande och vara inloggad.")
    assert page_status(prompt, URL, RULES, apply_by="2026-11-18", today=date(2026, 11, 20))[0] == "applications_closed"
    assert page_status(prompt, URL, RULES, apply_by="2026-11-29", today=date(2026, 11, 20))[0] == "open"
