# Bug: work points missing from the map (geocoding)

Observed 2026-10-31: `/api/map/points` returns `geocoded: false` for the two workplace points (address only,
no `coords`); the points with `coords` show.

## Root cause
1. [providers/geocode.py](../../../backend/src/findhome/providers/geocode.py) `geocode()` appends `", Sverige"`
   unless the normalised query contains `stockholm` or `sverige`. Both addresses end in `Sweden`, so Nominatim gets
   `"Example Street 7, 123 45 Solna, Sweden, Sverige"` → no result. Verified: the plain address resolves
   to coordinates, the suffixed one returns "not found".
2. The miss is stored in `geocode_cache` with `lat = NULL` and `expires_at = now() + 365 days`, and a cached NULL
   is returned as "not found" without retrying. Fixing the address alone does not help until the row expires.
3. `findhome geocode` calls the geocoder directly (no suffix, no cache), so the CLI check looks fine while the
   map fails: misleading when debugging.

## Fix direction (to implement outside this planning session)
- Append the country only when the query has no country at all (`sverige`, `sweden`), or rely on
  `countrycodes=se`, which Nominatim already receives, and drop the suffix.
- Cache misses for a short TTL (e.g. 1 day), not the full geocode TTL.
- Make `findhome geocode` go through the same cached `geocode()` path (or print both).
- Immediate unblock without code: put `coords` on both points in `config/locations.yaml`, or delete the two
  NULL rows from `geocode_cache` after fixing the suffix.
- Add a unit test for the suffix rule and the miss TTL.
