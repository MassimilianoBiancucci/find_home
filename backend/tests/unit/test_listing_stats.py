"""Listing statistics per zone on made-up listings."""
from datetime import date

from findhome.domain.listing_stats import StatsFilter, where_sql, zone_stats


def test_zone_stats_medians_quartiles_and_min_n():
    rows = [{"zone_id": "A", "rent": r, "size": s, "rooms": 2} for r, s in ((10000, 50), (12000, 40), (14000, 70))]
    rows += [{"zone_id": "B", "rent": 9000, "size": 30, "rooms": 1}, {"zone_id": None, "rent": 1, "size": 1, "rooms": 1}]
    out = zone_stats(rows, {"A": 2.0, "B": None}, min_n=3)
    assert set(out) == {"A", "B"}                                   # the listing outside every zone is dropped
    a = out["A"]
    assert a["n"] == 3 and a["per_km2"] == 1.5
    assert a["rent"] == {"median": 12000.0, "p25": 11000.0, "p75": 13000.0, "n": 3}
    assert a["rent_per_m2"]["median"] == 200.0                       # 200, 300, 200 kr/m²
    assert out["B"] == {"n": 1, "per_km2": None}                     # below min_n: the count only


def test_where_sql_builds_conditions_in_order():
    f = StatsFilter(statuses=("new", "shortlisted"), seen="active", active_days=7, scored="passing",
                    posted_from=date(2026, 10, 1), rent_max=15000, min_n=2)
    sql, args = where_sql(f)
    assert "l.status = ANY(%s)" in sql and "make_interval(days => %s)" in sql and "s.total IS NOT NULL" in sql
    assert "(l.attributes->>'publishedAt')::date >= %s" in sql and "l.rent_sek <= %s" in sql
    assert args == [["new", "shortlisted"], 7, date(2026, 10, 1), 15000]
    assert where_sql(StatsFilter()) == ("l.lat IS NOT NULL AND l.lon IS NOT NULL", [])
