from findhome.config.loader import load_all
from findhome.domain.scoring import hard_filter_failures, score_listing


def bundle(tmp_repo):
    return load_all(tmp_repo / "config", tmp_repo / "sites")


def test_pet_no_is_hard_excluded(tmp_repo):
    b = bundle(tmp_repo)
    res = score_listing(b, {"listing_kind": "rent", "pet_status": "no", "rent_sek": 10000}, [])
    assert res["total"] is None and "pet_status_exclude" in res["rejected_by"]


def test_score_is_weighted_mean_of_available_groups(tmp_repo):
    b = bundle(tmp_repo)
    L = {"listing_kind": "rent", "pet_status": "yes", "has_balcony": True, "floor": 2, "has_elevator": True,
         "size_m2": 60, "rooms_rok": 2, "contract_type": "first_hand", "rent_sek": 15000}
    res = score_listing(b, L, [])
    assert 0 <= res["total"] <= 1
    assert res["breakdown"]["cost"]["score"] is None          # max/ideal rent not set yet (TODO(user))
    assert res["breakdown"]["cat_suitability"]["score"] == 1.0
    assert res["breakdown"]["neighbourhood"]["score"] is None  # no house analysis given: left out of the mean


def test_commute_and_reliability_penalty(tmp_repo):
    b = bundle(tmp_repo)
    base = {"listing_kind": "rent", "pet_status": "yes"}
    steady = [{"point_id": "work-main", "median_min": 25, "p90_min": 27, "spread_min": 2, "window_weight": 1}]
    shaky = [{"point_id": "work-main", "median_min": 25, "p90_min": 50, "spread_min": 25, "window_weight": 1}]
    s1 = score_listing(b, base, steady)["breakdown"]["commute"]["score"]
    s2 = score_listing(b, base, shaky)["breakdown"]["commute"]["score"]
    assert s1 > s2


def test_rooms_and_sovalkov_rule():
    hf = {"min_rooms_rok": 2, "accept_sovalkov": False}
    L = {"rooms_rok": 1, "has_sovalkov": True}
    assert "min_rooms_rok" in hard_filter_failures(hf, L, [])
    assert hard_filter_failures({**hf, "accept_sovalkov": True}, L, []) == []


def test_max_commute_by_category():
    hf = {"max_commute_min_by_category": {"work": 40}}
    commute = [{"category": "work", "median_min": 55}]
    assert hard_filter_failures(hf, {}, commute) == ["max_commute_min_by_category.work"]


def test_neighbourhood_from_house_analysis_and_zone(tmp_repo):
    b = bundle(tmp_repo)
    L = {"listing_kind": "rent", "pet_status": "yes"}
    full = score_listing(b, L, [], {"services": 80, "transport": 60, "zone_services": 50})["breakdown"]["neighbourhood"]
    assert full["score"] == round(0.5 * 0.8 + 0.3 * 0.6 + 0.2 * 0.5, 3)
    assert "home services 80" in full["why"] and [r["name"] for r in full["detail"]["rows"]] == [
        "home services", "home transport", "zone services"]
    part = score_listing(b, L, [], {"services": 80, "transport": None, "zone_services": None})["breakdown"]["neighbourhood"]
    assert part["score"] == 0.8                                                     # renormalised to the one part
    none = score_listing(b, L, [], {"services": None, "transport": None, "zone_services": None})["breakdown"]["neighbourhood"]
    assert none["score"] is None
