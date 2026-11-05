"""Scoring v0: hard filters gate, then a weighted mean of preference groups (each 0..1).

Deterministic and fully driven by profile.yaml. A group that lacks the data it needs returns
None and is left out of the mean (its weight does not count), and the breakdown says why.
Tuning is the scoring-v1 backlog task.
"""
from __future__ import annotations

from datetime import date
from typing import Any

from findhome.config.loader import ConfigBundle


def _lin(value: float, good: float, bad: float) -> float:
    """1.0 at `good`, 0.0 at `bad`, linear in between, clamped."""
    if good == bad:
        return 1.0 if value <= good else 0.0
    return max(0.0, min(1.0, (bad - value) / (bad - good)))


def _as_date(v: Any) -> date | None:
    if v is None or isinstance(v, date):
        return v
    return date.fromisoformat(str(v))


def hard_filter_failures(hf: dict[str, Any], listing: dict[str, Any], commute: list[dict],
                         area: dict[str, Any] | None = None) -> list[str]:
    fails: list[str] = []
    rent, size, rooms = listing.get("rent_sek"), listing.get("size_m2"), listing.get("rooms_rok")
    if hf.get("max_rent_sek") and rent is not None and rent > hf["max_rent_sek"]:
        fails.append("max_rent_sek")
    if hf.get("max_price_sek") and listing.get("price_sek") and listing["price_sek"] > hf["max_price_sek"]:
        fails.append("max_price_sek")
    if hf.get("max_avgift_sek") and listing.get("avgift_sek") and listing["avgift_sek"] > hf["max_avgift_sek"]:
        fails.append("max_avgift_sek")
    if hf.get("min_size_m2") and size is not None and float(size) < hf["min_size_m2"]:
        fails.append("min_size_m2")
    if hf.get("min_rooms_rok") and rooms is not None and float(rooms) < hf["min_rooms_rok"]:
        bonus = 1 if (hf.get("accept_sovalkov") and listing.get("has_sovalkov")) else 0
        if float(rooms) + bonus < hf["min_rooms_rok"]:
            fails.append("min_rooms_rok")
    if listing.get("pet_status") in (hf.get("pet_status_exclude") or []):
        fails.append("pet_status_exclude")
    ct = listing.get("contract_type")
    if hf.get("contract_types") and ct and ct != "unknown" and ct not in hf["contract_types"]:
        fails.append("contract_types")
    area_text = (listing.get("area") or "").lower()
    if area is None:
        if hf.get("areas_include") and area_text and not any(a.lower() in area_text for a in hf["areas_include"]):
            fails.append("areas_include")
        if hf.get("areas_exclude") and area_text and any(a.lower() in area_text for a in hf["areas_exclude"]):
            fails.append("areas_exclude")
    elif area.get("score") == 0:
        fails.append("outside_search_area")
    avail = _as_date(listing.get("available_from"))
    if avail and hf.get("move_in_to") and avail > _as_date(hf["move_in_to"]):
        fails.append("move_in_to")
    for cat, limit in (hf.get("max_commute_min_by_category") or {}).items():
        meds = [float(c["median_min"]) for c in commute if c.get("category") == cat and c.get("median_min") is not None]
        if meds and min(meds) > limit:
            fails.append(f"max_commute_min_by_category.{cat}")
    return fails


def _cost(p, hf, L):
    rent, ideal, mx = L.get("rent_sek"), p.get("ideal_rent_sek"), hf.get("max_rent_sek")
    if rent is None or (ideal is None and mx is None):
        return None, "needs rent and ideal_rent_sek or max_rent_sek"
    ideal = ideal if ideal is not None else mx * 0.75
    mx = mx if mx is not None else ideal * 1.5
    return _lin(rent, ideal, mx), f"{rent} kr vs ideal {int(ideal)} / max {int(mx)}"


def _space(p, hf, L):
    size = L.get("size_m2")
    if size is None:
        return None, "size unknown"
    ideal = p.get("ideal_size_m2") or 55
    low = hf.get("min_size_m2") or ideal * 0.6
    return _lin(-float(size), -ideal, -low), f"{size} m² vs ideal {ideal}"


def _commute(p, hf, L, commute: list[dict], bundle: ConfigBundle):
    if not commute:
        return None, "no commute results yet (run findhome commute)"
    good, bad = p.get("good_min", 20), p.get("bad_min", 60)
    spread_pen = p.get("reliability_spread_penalty_min", 10)
    weights = {pt.id: bundle.locations.effective_weight(pt) for pt in bundle.locations.points}
    num = den = 0.0
    for c in commute:
        if c.get("median_min") is None:
            continue
        s = _lin(float(c["median_min"]), good, bad)
        spread = float(c.get("spread_min") or 0)
        if spread_pen and spread > spread_pen:
            s *= max(0.5, 1 - 0.1 * (spread - spread_pen) / spread_pen)
        w = weights.get(c["point_id"], 0) * float(c.get("window_weight") or 1)
        num, den = num + w * s, den + w
    if den == 0:
        return None, "no weighted commute windows"
    return num / den, f"{len(commute)} windows"


def _cats(p, hf, L):
    table = p.get("pet_status_score", {"yes": 1.0, "ask": 0.5, "unknown": 0.4})
    s = float(table.get(L.get("pet_status") or "unknown", 0.0))
    if L.get("has_balcony"):
        s += p.get("balcony_bonus", 0)
    floor = L.get("floor")
    if floor is not None and (floor <= 1 or L.get("has_elevator")):
        s += p.get("low_floor_or_elevator_bonus", 0)
    return min(1.0, s), f"pets {L.get('pet_status')}"


def _building(p, hf, L):
    floor, lift = L.get("floor"), L.get("has_elevator")
    if floor is None and lift is None and L.get("has_balcony") is None:
        return None, "no building data"
    s = 0.7
    if floor is not None and floor >= p.get("elevator_needed_from_floor", 3) and lift is False:
        s -= 0.4
    if L.get("has_balcony"):
        s += 0.2
    if L.get("build_year") and L["build_year"] >= 2000:
        s += 0.1
    return max(0.0, min(1.0, s)), "floor/lift/balcony"


def _contract(p, hf, L):
    ct = L.get("contract_type")
    if not ct or ct == "unknown":
        return None, "contract type unknown"
    s = 0.6 + (p.get("first_hand_bonus", 0.3) if ct == "first_hand" else 0)
    months = L.get("max_duration_months")
    start, end = _as_date(L.get("contract_start")), _as_date(L.get("contract_end"))
    if months is None and start and end:
        months = (end.year - start.year) * 12 + end.month - start.month
    if months is not None and months < p.get("min_contract_months", 12):
        s -= 0.4
    return max(0.0, min(1.0, s)), f"{ct}, {months or '?'} months"


def _area(area: dict[str, Any] | None):
    if area is None:
        return None, "no search area defined (Map → Area)"
    if area.get("unknown"):
        return None, "area_unknown: no coordinates"
    where = "inside" if area["inside"] else f"{area['distance_m']} m outside"
    return area["score"], f"{where} · best {area['best_piece'] or '-'}"


NEIGHBOURHOOD_DEFAULT = {"house_services": 0.5, "house_transport": 0.3, "zone_services": 0.2}


def _neighbourhood(p, location: dict[str, Any] | None):
    """The home's surroundings from its exact address (house analysis) and its zone's services index (0-100 each):
    house services, house transport and zone services, weighted by params; missing parts renormalise. Commute is
    not counted here: it has its own group."""
    if not location:
        return None, "no house analysis yet (open the listing or run findhome listings location --all)", None
    w = {**NEIGHBOURHOOD_DEFAULT, **{k: float(v) for k, v in (p or {}).items() if k in NEIGHBOURHOOD_DEFAULT}}
    parts = {"house_services": location.get("services"), "house_transport": location.get("transport"),
             "zone_services": location.get("zone_services")}
    labels = {"house_services": "home services", "house_transport": "home transport", "zone_services": "zone services"}
    have = [(v / 100, w[k]) for k, v in parts.items() if v is not None and w[k] > 0]
    total = sum(x for _, x in have)
    rows = [{"name": labels[k], "input": "no value" if v is None else f"{v:g} / 100",
             "score": None if v is None else round(v / 100, 3), "weight": w[k]} for k, v in parts.items()]
    if not total:
        return None, "house analysis without scores", rows
    why = ", ".join(f"{labels[k]} {v:g}" for k, v in parts.items() if v is not None)
    return sum(v * x for v, x in have) / total, why, rows


def evaluate_area(bundle: ConfigBundle, listing: dict[str, Any]) -> dict[str, Any] | None:
    """None when no search area is defined; {'unknown': True} without coordinates; else the AreaResult dict."""
    from findhome.geo.area import area_eval, compiled_for

    area = compiled_for(bundle.raw.get("search_area"))
    if not area.defined:
        return None
    if listing.get("lat") is None or listing.get("lon") is None:
        return {"unknown": True}
    return area_eval(area, float(listing["lat"]), float(listing["lon"])).as_dict()


def score_listing(bundle: ConfigBundle, listing: dict[str, Any], commute: list[dict],
                  location: dict[str, Any] | None = None) -> dict[str, Any]:
    """location: the house analysis' transport / services scores plus `zone_services` (the zone's services index),
    for the neighbourhood group; None leaves that group without data."""
    kind = listing.get("listing_kind", "rent")
    prof = bundle.profile.kinds.get(kind)
    if prof is None or not prof.enabled:
        return {"total": None, "rejected_by": [f"kind_disabled.{kind}"], "breakdown": {}}
    cats = {pt.id: pt.category for pt in bundle.locations.points}
    commute = [{**c, "category": cats.get(c["point_id"])} for c in commute]
    hf = prof.hard_filters
    area = evaluate_area(bundle, listing)
    failures = hard_filter_failures(hf, listing, commute, area)
    groups = {
        "cost": lambda p: _cost(p, hf, listing),
        "space": lambda p: _space(p, hf, listing),
        "commute": lambda p: _commute(p, hf, listing, commute, bundle),
        "cat_suitability": lambda p: _cats(p, hf, listing),
        "building_comfort": lambda p: _building(p, hf, listing),
        "contract_availability": lambda p: _contract(p, hf, listing),
        "area": lambda p: _area(area),
        "neighbourhood": lambda p: _neighbourhood(p, location),
    }
    breakdown: dict[str, Any] = {}
    num = den = 0.0
    for name, pref in prof.preferences.items():
        if not pref.enabled:
            continue
        fn = groups.get(name)
        if fn is None:
            breakdown[name] = {"score": None, "weight": pref.weight, "why": "no scorer yet"}
            continue
        s, why, *extra = fn(pref.params)
        breakdown[name] = {"score": None if s is None else round(s, 3), "weight": pref.weight, "why": why}
        if extra and extra[0]:
            breakdown[name]["detail"] = {"label": "Part", "rows": extra[0], "total": None if s is None else round(s, 3)}
        if name == "area" and area and not area.get("unknown"):
            breakdown[name]["detail"] = area
        if s is not None:
            num, den = num + pref.weight * s, den + pref.weight
    total = None if failures or den == 0 else round(num / den, 4)
    return {"total": total, "rejected_by": failures, "breakdown": breakdown}
