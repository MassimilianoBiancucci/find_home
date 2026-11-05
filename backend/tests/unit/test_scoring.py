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
    assert res["breakdown"]["transport"]["score"] is None      # no house analysis given: left out of the mean
    assert res["breakdown"]["services"]["score"] is None


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
    prefs = b.profile.kinds["rent"].preferences
    prefs["neighbourhood"].enabled = True                   # the example has transport + services instead
    prefs["transport"].enabled = prefs["services"].enabled = False
    L = {"listing_kind": "rent", "pet_status": "yes"}
    full = score_listing(b, L, [], {"services": 80, "transport": 60, "zone_services": 50})["breakdown"]["neighbourhood"]
    assert full["score"] == round(0.5 * 0.8 + 0.3 * 0.6 + 0.2 * 0.5, 3)
    assert "home services 80" in full["why"] and [r["name"] for r in full["detail"]["rows"]] == [
        "home services", "home transport", "zone services"]
    part = score_listing(b, L, [], {"services": 80, "transport": None, "zone_services": None})["breakdown"]["neighbourhood"]
    assert part["score"] == 0.8                                                     # renormalised to the one part
    none = score_listing(b, L, [], {"services": None, "transport": None, "zone_services": None})["breakdown"]["neighbourhood"]
    assert none["score"] is None


def test_value_scale_keeps_listings_in_the_running_and_reads_the_targets():
    from findhome.config.models import KindProfile
    from findhome.domain.value_scale import value_scale

    prof = KindProfile.model_validate({"enabled": True, "hard_filters": {"max_rent_sek": 12000, "min_size_m2": 30, "min_rooms_rok": 2},
                                       "preferences": {"cost": {"enabled": True, "weight": 1, "params": {}},
                                                       "space": {"enabled": True, "weight": 1, "params": {"ideal_size_m2": 50}}}})
    rows = [
        {"score": 0.7, "rejected_by": [], "status": "new", "rent_sek": 9000, "size_m2": 45, "rooms_rok": 2},
        {"score": 0.5, "rejected_by": [], "status": "shortlisted", "rent_sek": 11000, "size_m2": 55, "rooms_rok": 3},
        {"score": None, "rejected_by": ["max_rent_sek"], "status": "new", "rent_sek": 20000, "size_m2": 80, "rooms_rok": 4},
        {"score": 0.9, "rejected_by": [], "status": "rejected", "rent_sek": 5000, "size_m2": 20, "rooms_rok": 1},
    ]
    s = value_scale(rows, prof)
    f = s["fields"]
    assert s["n"] == 2                                                      # the hard-filtered and your rejected are out
    assert f["rent_sek"]["values"] == [9000.0, 11000.0] and f["rent_sek"]["better"] == "low"
    assert f["rent_sek"]["limit"] == 12000 and f["rent_sek"]["ideal"] == 9000           # 0.75 × max, as the cost group
    assert f["size_m2"]["ideal"] == 50 and f["rooms_rok"]["limit"] == 2
    assert f["rent_per_m2"]["values"] == [200.0, 200.0]


def test_transport_and_services_groups_hold_the_commute_and_flag_estimates(tmp_repo):
    b = bundle(tmp_repo)
    L = {"listing_kind": "rent", "pet_status": "yes"}
    loc = {"services": 70, "transport": 62.0, "transport_access": 50, "reach": 70, "estimated": True, "reach_weight": 0.6,
           "reach_weight_access": 0.4, "reach_rows": [{"name": "Work", "input": "30 min · estimate", "score": 0.75, "weight": 1.0}]}
    commute = [{"point_id": "work-main", "median_min": 25, "window_weight": 1, "mode": "transit"}]
    bd = score_listing(b, L, commute, loc)["breakdown"]
    assert bd["transport"]["score"] == 0.62 and bd["transport"]["estimated"] is True and "estimate" in bd["transport"]["why"]
    assert [r["name"] for r in bd["transport"]["detail"]["rows"]] == ["access", "reach", "· Work"]
    assert bd["services"]["score"] == 0.7 and "estimated" not in bd["services"]
    assert bd["commute"]["score"] is None and "transport" in bd["commute"]["why"]           # not counted twice
    no_reach = score_listing(b, L, commute, {**loc, "reach": None, "estimated": False})["breakdown"]
    assert no_reach["commute"]["score"] is not None and "estimated" not in no_reach["transport"]
