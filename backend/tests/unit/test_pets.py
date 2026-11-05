"""Pet wording rules (config/pet_rules.yaml) and the precedence of who decides a listing's pet status.

The corpus is fictional. A `yes` or `no` that is not explicitly written is a false positive and must never happen:
the keyword rules only decide on explicit phrases, anything else stays `unknown` (or `ask` when ambiguous).
"""
from __future__ import annotations

import pytest

from findhome.domain.models import ListingIn
from findhome.pets import apply_pet, detect, ingest_candidate

CORPUS: list[tuple[str, str]] = [
    # explicit no (sv)
    ("Inga husdjur tack.", "no"),
    ("Lägenheten är rökfri och inga husdjur.", "no"),
    ("Husdjur är inte tillåtna.", "no"),
    ("Husdjur ej tillåtna enligt föreningens regler.", "no"),
    ("Djurhållning är förbjudet i fastigheten.", "no"),
    ("Tyvärr inga husdjur på grund av allergi hos hyresvärden.", "no"),
    ("Detta är en djurfri lägenhet.", "no"),
    ("Inga katter eller hundar.", "no"),
    ("Djur är inte välkomna.", "no"),
    ("Ej husdjur.", "no"),
    # explicit no (en)
    ("No pets, no smoking.", "no"),
    ("Pets are not allowed in this apartment.", "no"),
    ("Pet-free building.", "no"),
    ("Cats not permitted.", "no"),
    ("Pets are prohibited.", "no"),
    # explicit yes (sv)
    ("Husdjur är tillåtna.", "yes"),
    ("Husdjur tillåtet.", "yes"),
    ("Katter är välkomna!", "yes"),
    ("Katt ok.", "yes"),
    ("Djur tillåts i lägenheten.", "yes"),
    ("Husdjursvänlig förening med stor innergård.", "yes"),
    ("Hundar välkomna, nära till skogen.", "yes"),
    # explicit yes (en)
    ("Pets allowed.", "yes"),
    ("Cats are welcome.", "yes"),
    ("Pet-friendly apartment near the park.", "yes"),
    ("Dogs are okay.", "yes"),
    # ambiguous → ask
    ("Allergianpassad lägenhet.", "ask"),
    ("Lägenheten är allergivänlig.", "ask"),
    ("Husdjur enligt överenskommelse.", "ask"),
    ("Djur efter överenskommelse med hyresvärden.", "ask"),
    ("Husdjur kan diskuteras.", "ask"),
    ("Fråga om husdjur.", "ask"),
    ("Pets negotiable.", "ask"),
    ("Allergy-friendly home.", "ask"),
    ("Pets by agreement.", "ask"),
    ("Katt efter överenskommelse.", "ask"),
    ("Allergianpassad men katter är välkomna efter samtal.", "ask"),
    # exceptions: contain rule words, mean something else
    ("Inga problem med husdjur i huset.", "unknown"),
    ("Husdjur ej tillåtna i tvättstugan.", "unknown"),
    ("Inga djur i trapphuset, tack.", "unknown"),
    ("No pets problem here.", "unknown"),
    ("Pets are not allowed in the laundry.", "unknown"),
    # no pet wording → unknown (never guess)
    ("Fin utsikt över vattnet.", "unknown"),
    ("Nyrenoverat kök och badrum.", "unknown"),
    ("Djurgården ligger nära.", "unknown"),
    ("Husdjur.", "unknown"),
    ("Djur", "unknown"),
    ("Pets", "unknown"),
    ("Nära djuraffär och veterinär.", "unknown"),
    ("Lägenheten har en kattlucka sedan tidigare ägare.", "unknown"),
    ("The building has a pet shop on the ground floor.", "unknown"),
    ("Quiet street, no traffic.", "unknown"),
    ("Hyresvärden har själv en katt.", "unknown"),
    ("Det finns inga hissar i huset.", "unknown"),
    ("Not suitable for smokers.", "unknown"),
    ("", "unknown"),
    ("   ", "unknown"),
    # contradictions → conflict
    ("Husdjur tillåtna. Inga husdjur i gemensamma lokaler är okej men inga husdjur i lägenheten.", "conflict"),
    ("Pets allowed! (No pets in summer.)", "conflict"),
    ("Katter är välkomna men inga hundar.", "conflict"),
]


@pytest.mark.parametrize(("text", "expected"), CORPUS)
def test_corpus(text, expected):
    assert detect(text).status == expected


def test_no_false_positives_on_corpus():
    wrong = [(t, e, detect(t).status) for t, e in CORPUS
             if detect(t).status in ("yes", "no") and detect(t).status != e]
    assert wrong == []
    assert len(CORPUS) >= 60


def test_evidence_is_the_quoted_sentence():
    found = detect("Ljus trea med balkong. Inga husdjur tack. Tillträde 1 december.")
    assert found.status == "no" and found.evidence == "Inga husdjur tack." and found.rule.startswith("sv.no")
    assert detect("Allergianpassad lägenhet i lugnt område.").evidence == "Allergianpassad lägenhet i lugnt område."


def test_precedence():
    # a lower source never overwrites a higher one
    assert apply_pet("ask", "agent", "yes", "flag", "site") is None
    assert apply_pet("no", "user", "yes", "agent read", "agent") is None
    assert apply_pet("conflict", "site", "yes", "text", "keywords") is None       # keywords never resolve a conflict
    assert apply_pet("conflict", "site", "ask", "page says", "agent")["pet_status"] == "ask"
    assert apply_pet("yes", "site", "no", "you said so", "user")["pet_source"] == "user"
    # unknown never overwrites a known value; a new listing records unknown
    assert apply_pet("yes", "site", "unknown", None, "keywords") is None
    assert apply_pet(None, None, "unknown", None, "keywords")["pet_status"] == "unknown"


def _listing(**kw) -> ListingIn:
    return ListingIn.model_validate({"source": {"site_slug": "demo", "external_id": "1",
                                                "method": kw.pop("method", "script")}, **kw})


def test_ingest_candidate():
    flag = {"pets_flag": {"value": True, "evidence": "site: pets allowed"}}
    assert ingest_candidate(_listing(attributes=flag)) == ("yes", "site: pets allowed", "site")
    status, evidence, source = ingest_candidate(_listing(attributes=flag, description_excerpt="Inga husdjur."))
    assert (status, source) == ("conflict", "site") and "Inga husdjur." in evidence
    assert ingest_candidate(_listing(attributes=flag, description_excerpt="Allergianpassad."))[0] == "yes"
    assert ingest_candidate(_listing(description_excerpt="Katter är välkomna."))[::2] == ("yes", "keywords")
    assert ingest_candidate(_listing(pet_status="no", pet_evidence="'no cats'", method="agent_browser"))[2] == "agent"
    assert ingest_candidate(_listing(description_excerpt="Fin utsikt."))[0] == "unknown"
