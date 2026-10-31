# Architecture: configuration, locations and scoring

Everything the user may want to change lives in YAML, not in code. This page covers how the files are loaded and
validated, the locations model (points, trips, windows), the config hash, the commute matrix and scoring. See the
[introduction](introduction.md) for the other components.

## Files and validation

| File | Role |
|---|---|
| [`profile.yaml`](../../config/profile.yaml) | per listing kind: `hard_filters` (gate) and `preferences` (weighted groups) |
| [`filters_catalog.yaml`](../../config/filters_catalog.yaml) | canonical filter keys, used by `hard_filters` and every site's `filter_map` |
| [`locations.yaml`](../../config/locations.yaml) | categories and points with trips and time windows |
| [`time_model.yaml`](../../config/time_model.yaml) | day types, default sampling grid, reliability statistics |
| [`poi.yaml`](../../config/poi.yaml) | nearby-service categories (OSM tags, radius, weight) |
| [`tags.yaml`](../../config/tags.yaml) | lifecycle statuses (per kind) and feedback reason tags |
| [`providers.yaml`](../../config/providers.yaml) | routing, geocoding, POI providers, mode priority, budget, cache, prefilter, map style |
| [`agent.yaml`](../../config/agent.yaml) | headless agent commands for the Run agent button |
| `backend.env`, `providers.env` | process settings and provider keys (gitignored; `*.env.example` committed) |

[`config/loader.py`](../../backend/src/findhome/config/loader.py) `load_all` parses every file, validates it against
[`config/schemas/<name>.schema.json`](../../config/schemas/profile.schema.json), validates every
`sites/*/site.yaml` (folders starting with `_` are templates), then runs cross-file checks: hard-filter keys exist
in the catalog for that kind, point categories exist, trip day types exist in the time model, mode priorities name
known providers, site `filter_map` keys exist in the catalog, site slugs match their folders. All errors are
collected and returned together. [`config/models.py`](../../backend/src/findhome/config/models.py) gives typed
access after validation; the schemas are the source of truth.

[`config/store.py`](../../backend/src/findhome/config/store.py) keeps the active bundle in the API process and
reloads it when files change. An invalid edit leaves the last valid bundle active and exposes the errors on
`/health` and `/api/config`.

[`config/writer.py`](../../backend/src/findhome/config/writer.py) is the only code that writes config files. It
round-trips YAML with ruamel.yaml (comments and order kept, `null` written explicitly; inserted values are
styled like the hand-written files: small scalar lists and maps in flow style, `HH:MM` quoted, no anchors), validates the whole
config set on a temporary copy, and replaces the file atomically. `apply_ops` takes add / replace / remove
operations on a JSON pointer path; `write_text` replaces a whole file.

## Config hash

`config_hash` is a 16-character SHA-256 over the canonical JSON of the scoring files (profile, locations,
time_model, poi, tags). Every row in `scores` and `commute_results` stores the hash it was computed with. Reading
always uses the active hash, so changing a weight or a window makes old results invisible (stale) until
`scores recompute` or a new commute run.

## Locations: points, trips, windows

A **point** has an id, a category (defined in the same file with label, default weight, colour, icon), a label,
`address` or `coords`, an optional weight, notes, modes and one or more **trips**. Any number of points can share a
category: several workplaces, several partner homes, generic points.

The Locations editor suggests addresses while typing through `GET /api/geocode/suggest`
([`providers/suggest.py`](../../backend/src/findhome/providers/suggest.py): OpenRouteService autocomplete with
`ORS_API_KEY`, else Photon; never Nominatim, whose policy forbids autocomplete). Picking a suggestion saves both
`address` and `coords`, so the point does not depend on runtime geocoding.

**Geocoding** ([`providers/geocode.py`](../../backend/src/findhome/providers/geocode.py)) resolves points
without `coords` and listings without coordinates through `geocode_cache`. The query sent to Nominatim gets
`, Sverige` only when the address names no country (`sverige` / `sweden`). Hits are cached for
`cache.geocode_ttl_days`, misses for one day. `findhome geocode "<address>" [--refresh]` uses the same cached
path through `GET /api/geocode`.

A **trip** has a `direction` (`to_point` = home → point, `from_point` = point → home, `both`), `day_types`, and
either `windows` or `use_default_grid: true`. A trip may override the point's modes.

A **window** is `arrive_by` (be at the destination between `from` and `to`) or `depart_at` (leave between them),
with a `weight` and a `step_min`. Windows may cross midnight (`18:00` → `03:00`).
[`config/timegrid.py`](../../backend/src/findhome/config/timegrid.py) expands windows into slots counted in
minutes from midnight of the reference day, so `01:00` after midnight is minute 1500. The default grid adds its
`dense` sub-windows (e.g. 07:00-09:00 every 15 minutes).

## Commute matrix

[`domain/commute.py`](../../backend/src/findhome/domain/commute.py) `compute_listing`:

1. `plan_requests` expands enabled points × trips × directions × day types × slots × modes. Points without
   coordinates are reported (`missing_coords`; addresses starting with `TODO` are never geocoded); points farther
   than `prefilter.max_haversine_km_by_category` are skipped (`prefiltered`).
2. Each request picks a provider by `mode_priority` from
   [`providers/registry.py`](../../backend/src/findhome/providers/registry.py): the first enabled provider that
   has its key and supports the mode, else the haversine estimate.
3. Each sample is looked up in `routing_cache`. The key holds provider, mode, rounded origin and destination, and
   for time-dependent providers the day type, slot and arrive/depart kind. Identical keys within one run are
   requested once.
4. Provider calls respect the run budget (`budget.max_routing_calls_per_run`). After three consecutive errors a
   provider is replaced by the haversine estimate for the rest of the run. `dry_run` only counts unique calls and the
   Google cost estimate.
5. Samples are grouped per (point, direction, day type, window, mode) and stored with median, p90 (nearest
   rank), worst and spread (p90 − median) under the active config hash.

Sampled times use a reference date per day type: the next date on the preferred weekday that is not in
`skip_dates`, so timetable answers stay comparable between runs.

Providers: [`haversine.py`](../../backend/src/findhome/providers/haversine.py) (straight line × detour ÷ speed, +5
min wait for transit), [`osm.py`](../../backend/src/findhome/providers/osm.py) (OSRM drive, Nominatim geocoding,
1 req/s), [`resrobot.py`](../../backend/src/findhome/providers/resrobot.py) (transit),
[`google.py`](../../backend/src/findhome/providers/google.py) (Routes API, minimal field mask).
[`providers/poi.py`](../../backend/src/findhome/providers/poi.py) builds Overpass queries and caches results; no
endpoint uses it yet.

## Scoring

[`domain/scoring.py`](../../backend/src/findhome/domain/scoring.py) `score_listing`:

- Hard filters from the listing kind's profile gate the listing. Any failure gives `total = null` and lists the
  reasons in `rejected_by`. `pet_status_exclude` defaults to `["no"]`. A sleeping alcove adds one room only when
  `accept_sovalkov` is true. `max_commute_min_by_category` uses the best median of that category's points.
- Each enabled preference group returns a 0..1 score or `None` when its data is missing (for example cost while
  `max_rent_sek` and `ideal_rent_sek` are unset). The total is the weighted mean of the groups that returned a
  score. Groups: cost, space, commute (point weight × window weight, linear between `good_min` and `bad_min`,
  reduced when the spread exceeds `reliability_spread_penalty_min`), cat_suitability, building_comfort,
  contract_availability. `neighbourhood` has no scorer yet.
- A disabled listing kind (`buy` today) is rejected with `kind_disabled.<kind>`.

## Where the code lives

| Concern | File |
|---|---|
| Load, validate, hash | [`config/loader.py`](../../backend/src/findhome/config/loader.py) |
| Write config | [`config/writer.py`](../../backend/src/findhome/config/writer.py) |
| Windows and grids | [`config/timegrid.py`](../../backend/src/findhome/config/timegrid.py) |
| Commute matrix | [`domain/commute.py`](../../backend/src/findhome/domain/commute.py) |
| Scoring | [`domain/scoring.py`](../../backend/src/findhome/domain/scoring.py) |
| Locations editor (UI) | [`pages/locations.ts`](../../frontend/src/app/pages/locations.ts) |
| Tests | [`tests/config/test_config.py`](../../backend/tests/config/test_config.py), [`tests/unit/test_commute_plan.py`](../../backend/tests/unit/test_commute_plan.py), [`tests/unit/test_scoring.py`](../../backend/tests/unit/test_scoring.py) |
