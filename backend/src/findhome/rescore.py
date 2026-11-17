"""Scoring of stored listings, shared by the recompute endpoint, scans and jobs: geocode a listing without
coordinates (cached), read its cached house analysis, score it under the current config and save the score.
`score_listings` re-scores only the listings a scan or job touched."""
from __future__ import annotations

from typing import Any

from findhome.api.state import bundle, registry
from findhome.db import repo
from findhome.domain.commute import resolve_point_coords
from findhome.domain.scoring import score_listing

GEOCODE_PER_RECOMPUTE = 60          # Nominatim allows 1 req/s; cached answers are free


async def ensure_coords(conn, reg, L: dict) -> dict:
    """Geocode a listing without coordinates from its address (cached) and store the result."""
    if L["lat"] is not None or not L.get("address_raw"):
        return L
    from findhome.providers.geocode import geocode

    hit = await geocode(conn, reg, L["address_raw"])
    if not hit:
        return L
    await conn.execute("UPDATE listings SET lat = %s, lon = %s, geocode_source = 'nominatim' WHERE id = %s",
                       (hit.lat, hit.lon, L["id"]))
    return {**L, "lat": hit.lat, "lon": hit.lon}


async def location_for(conn, b, L: dict, coords=None) -> dict | None:
    """The listing's house scores (transport with reach, services) and its zone's services index, for the
    transport / services / neighbourhood groups. Cached data only, no provider call: the house analysis must exist
    (open the listing or `findhome listings location --all`); the reach is refreshed from the caches here."""
    if L.get("lat") is None or L.get("lon") is None:
        return None
    from findhome.api.routers.house import house_scores_for
    from findhome.zone import analysis as za
    from findhome.zone.house import version as house_version

    row = await (await conn.execute("SELECT payload FROM listing_location WHERE listing_id = %s AND version = %s",
                                    (L["id"], house_version(b, float(L["lat"]), float(L["lon"]))))).fetchone()
    if not row:
        from findhome.geo.store import load_zones, zone_at

        return {"outside": True} if zone_at(load_zones(), L["lat"], L["lon"]) is None else None
    pl = row["payload"]
    sc = await house_scores_for(conn, b, L, pl, coords)
    zi = await (await conn.execute("SELECT payload FROM zone_index WHERE zone_id = %s AND version = %s",
                                   (pl["zone"]["id"], za.version(b, za.index_sets(b))))).fetchone()
    w = sc["reach_cfg"]["weight"] if sc["reach"] is not None and sc["transport_access"] is not None else (1.0 if sc["reach"] is not None else 0.0)
    return {"services": sc["services"], "transport": sc["transport"], "transport_access": sc["transport_access"],
            "reach": sc["reach"], "reach_rows": sc["reach_rows"], "estimated": sc["estimated"],
            "reach_weight": w, "reach_weight_access": round(1 - w, 3),
            "zone_services": (zi["payload"].get("services") if zi else None)}


async def score_rows(conn, b, rows: list[dict], progress: dict | None = None) -> dict[str, int]:
    """Geocode up to GEOCODE_PER_RECOMPUTE listings without coordinates, then score every row."""
    scored = rejected = geocoded = 0
    reg = registry()
    coords = await resolve_point_coords(conn, reg, b.locations.points, int(b.providers.cache.get("geocode_ttl_days", 365)))
    for L in rows:
        if L["lat"] is None and L.get("address_raw") and geocoded < GEOCODE_PER_RECOMPUTE:
            geocoded += 1
            L = await ensure_coords(conn, reg, L)
        result = score_listing(b, L, await repo.commute_for(conn, L["id"], b.config_hash), await location_for(conn, b, L, coords))
        await repo.save_score(conn, L["id"], b.config_hash, result)
        scored += 1
        rejected += bool(result["rejected_by"])
        if progress is not None:
            progress["done"] = scored
    return {"scored": scored, "rejected": rejected, "geocoded": geocoded}



async def score_listings(conn, listing_ids: list[Any], b=None) -> dict[str, int]:
    """Re-score only these listings (ids) under the current config; archived ones are skipped."""
    ids = [i for i in dict.fromkeys(listing_ids) if i]
    if not ids:
        return {"scored": 0, "rejected": 0, "geocoded": 0}
    rows = await (await conn.execute("SELECT * FROM listings WHERE id = ANY(%s) AND status <> 'archived'",
                                     (ids,))).fetchall()
    return await score_rows(conn, b or bundle(), rows)
