from findhome.domain.models import ListingIn, SourceIn
from findhome.domain.normalize import (contract_type_from_text, dedupe_key, normalize_address, parse_int, parse_number,
                                       parse_rooms, pet_status_from_text)


def test_swedish_numbers():
    assert parse_int("12 500 kr/mån") == 12500
    assert parse_int("12 500 kr") == 12500
    assert parse_number("54,5 m²") == 54.5
    assert parse_number("1.250.000 kr") == 1250000
    assert parse_number(None) is None


def test_rooms_and_sovalkov():
    assert parse_rooms("2 rok") == (2.0, None)
    assert parse_rooms("1 rok + sovalkov") == (1.0, True)
    assert parse_rooms("2,5 rum") == (2.5, None)


def test_pet_wording():
    assert pet_status_from_text("Inga husdjur tack")[0] == "no"
    assert pet_status_from_text("Husdjur enligt överenskommelse")[0] == "ask"
    assert pet_status_from_text("Katter är välkomna!")[0] == "yes"
    assert pet_status_from_text("Pets allowed")[0] == "yes"
    assert pet_status_from_text("Fin utsikt") == ("unknown", None)


def test_contract_words():
    assert contract_type_from_text("Uthyres i andrahand") == "second_hand"
    assert contract_type_from_text("Förstahandskontrakt") == "first_hand"
    assert contract_type_from_text("ingen info") is None


def test_dedupe_key_ignores_site_and_small_differences():
    a = ListingIn(source=SourceIn(site_slug="a", external_id="1"), address_raw="Hornsgatan 12, Södermalm",
                  floor=3, size_m2=54, rent_sek=14500)
    b = ListingIn(source=SourceIn(site_slug="b", external_id="2"), address_raw="HORNSGATAN 12", floor=3,
                  size_m2=54.4, rent_sek=14600)
    assert normalize_address("Hornsgatan 12 B, 2 tr") == "hornsgatan 12b"
    assert dedupe_key(a) == dedupe_key(b)
