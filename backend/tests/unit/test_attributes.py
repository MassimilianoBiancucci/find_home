"""The fixed attribute keys: wrong shapes fail at ingest, other site keys pass as they are."""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from findhome.domain.attributes import validate_attributes
from findhome.domain.models import DESCRIPTION_MAX, ListingIn

SRC = {"site_slug": "example", "external_id": "1"}


def test_fixed_keys_are_checked_and_normalised():
    attrs = validate_attributes({
        "contract_terms": {"guaranteed_months": 2, "guaranteed_raw": "Garanterad boendetid: 2 månader",
                           "notice_months": None},
        "floorplans": [{"url": "https://example.org/plan.pdf", "kind": "pdf"}],
        "units": [{"label": "1101", "rent_sek": 9500, "floor": 2}],
        "move_in_raw": "Nu",
        "type_flags": ["Vanlig"], "pets_flag": {"value": True}})      # free site keys
    assert attrs["contract_terms"] == {"guaranteed_months": 2, "guaranteed_raw": "Garanterad boendetid: 2 månader"}
    assert attrs["floorplans"] == [{"url": "https://example.org/plan.pdf", "kind": "pdf"}]
    assert attrs["type_flags"] == ["Vanlig"] and attrs["pets_flag"] == {"value": True}


@pytest.mark.parametrize("bad", [
    {"contract_terms": {"guaranteed_months": "two"}},
    {"contract_terms": {"unknown_key": 1}},
    {"floorplans": [{"url": "x", "kind": "drawing"}]},
    {"amenities": "Balkong"},
    {"address_parts": {"street": "Exempelgatan", "number": 4}},
])
def test_wrong_shapes_fail_at_ingest(bad):
    with pytest.raises(ValidationError, match="attributes"):
        ListingIn(source=SRC, attributes=bad)


def test_description_cap_is_10000():
    assert DESCRIPTION_MAX == 10000
    ListingIn(source=SRC, description_excerpt="x" * DESCRIPTION_MAX)
    with pytest.raises(ValidationError):
        ListingIn(source=SRC, description_excerpt="x" * (DESCRIPTION_MAX + 1))
