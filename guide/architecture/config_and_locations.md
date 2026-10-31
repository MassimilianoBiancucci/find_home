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
| [`poi.yaml`](../../config/poi.yaml) | nearby-service categories (OSM tags, radius, walking threshold, map icon and colour) |
| [`tags.yaml`](../../config/tags.yaml) | lifecycle statuses (per kind) and feedback reason tags |
| [`providers.yaml`](../../config/providers.yaml) | routing, geocoding, POI providers, mode priority, budget, cache, prefilter, map style |
| [`agent.yaml`](../../config/agent.yaml) | headless agent commands for the Run agent button |
| [`geo.yaml`](../../config/geo.yaml) | geodata region (municipalities) and dataset sources for `data/geo/` |
| [`search_area.yaml`](../../config/search_area.yaml) | the search area: weighted pieces, erasers, buffer (edited in Map → Area) |
| [`area_aliases.yaml`](../../config/area_aliases.yaml) | popular area names → zone ids (seeded from OSM place names) |
| [`transit_colours.yaml`](../../config/transit_colours.yaml) | line colours and labels per transit mode (GTFS has no colours) |
| `backend.env`, `providers.env` | process settings and provider keys (gitignored; `*.env.example` committed) |

[`config/loader.py`](../../backend/src/findhome/config/loader.py) `load_all` parses every file, validates it against
[`config/schemas/<name>.schema.json`](../../config/schemas/profile.schema.json), validates every
`sites/*/site.yaml` (folders starting with `_` are templates), then runs cross-file checks: hard-filter keys exist
in the catalog for that kind, point categories exist, trip day types exist in the time model, mode priorities name
known providers, site `filter_map` keys exist in the catalog, site slugs match their folders, search-area piece ids
are unique and their geometries valid, and (when `data/geo/zones.geojson` exists) zone ids in the search area and
the aliases exist. All errors are
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
time_model, poi, tags, search_area). Every row in `scores` and `commute_results` stores the hash it was computed with. Reading
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
[`google.py`](../../backend/src/findhome/providers/google.py) (Routes API, minimal field mask),
[`ors.py`](../../backend/src/findhome/providers/ors.py) (OpenRouteService walking: directions and matrix).

## Points of interest and the test point

[`poi.yaml`](../../config/poi.yaml) lists categories with OSM tags (`key=value`, `a|b` alternatives, `key~regex`,
`key!=value`, `&` for conditions on one element; grammar in
[`providers/poi.py`](../../backend/src/findhome/providers/poi.py) `tag_filters`), a walking threshold
(`max_walk_min`), and the map blip (`icon`, `color`). `findhome geo fetch poi`
([`geo/build_poi.py`](../../backend/src/findhome/geo/build_poi.py)) fetches each category for the whole region
(one Overpass request per category) into `data/geo/poi/<category>.geojson`;
[`geo/store.py`](../../backend/src/findhome/geo/store.py) `load_poi` keeps an STRtree per category in
EPSG:3006. POIs are shown and inspected only; no score group uses them (`neighbourhood` stays disabled).

The **test point** ([`domain/probe.py`](../../backend/src/findhome/domain/probe.py), `POST /api/probe`) answers
for any spot: the area result, the 3 nearest places per category by walking minutes (5 straight-line candidates
per category, one ORS matrix call for all of them, each pair cached in `routing_cache`, haversine × detour as
fallback) and one ResRobot itinerary per enabled point (first trip, its first day type, the middle slot of its
first window), cached by ~100 m origin cell. Saved, named test points (`probes` table, `/api/probes`) are an
**alpha** feature; nothing else depends on them.

## Transit network

`findhome geo fetch transit` ([`geo/build_transit.py`](../../backend/src/findhome/geo/build_transit.py)) writes
`data/geo/transit/lines_<mode>.geojson` (one feature per line, both directions merged), `stations.geojson` and
`meta.json`. Sources follow `geo.yaml` `datasets.transit.order`: SL GTFS when `TRAFIKLAB_GTFS_KEY` is set (dominant
shape per route and direction, parent stations), else OSM route relations. Modes are metro, commuter_rail,
local_rail (Roslagsbanan, Saltsjöbanan), tram (incl. Tvärbanan, Lidingö- and Nockebybanan), train (regional),
bus and ferry; `classify` holds the line-number rules. A station serves the lines that pass within
`station_snap_m` of it (no timetables needed); platforms with the same name and mode are merged. Colours:
`transit_colours.yaml` per line, then OSM `colour`, then the mode default. `load_transit`
([`geo/store.py`](../../backend/src/findhome/geo/store.py)) gives the test point the line shapes, so itinerary legs
follow the track and carry the line colour. Nothing here changes scores.

## Zones and the search area

**Zones** are SCB RegSO 2025 statistical areas (CC0) of the municipalities in `geo.yaml` (263 for the 9 around
Stockholm), grouped by Stockholm's stadsdelsområden from OSM. `findhome geo fetch zones`
([`geo/build_zones.py`](../../backend/src/findhome/geo/build_zones.py)) downloads them, simplifies them and writes
`data/geo/zones.geojson` (gitignored), and seeds `area_aliases.yaml` from OSM place names when it is empty.
[`geo/store.py`](../../backend/src/findhome/geo/store.py) loads the file once per process (reloaded when it
changes) with an STRtree. Geometry runs in SWEREF 99 TM (EPSG:3006, metres) through
[`geo/crs.py`](../../backend/src/findhome/geo/crs.py); files and the API use WGS84.

The **search area** (`search_area.yaml`) is a list of pieces: `zones` (RegSO ids), `shape` (a GeoJSON polygon
from the brush, lasso, circle or polygon tool) and `eraser` (cuts every other piece), each with a weight 0..1, plus
`buffer_m`. [`geo/area.py`](../../backend/src/findhome/geo/area.py) `compile_area` unions each piece, removes the
erasers and caches the result per content and zones file; `area_eval(lat, lon)` returns inside, the distance to
the nearest piece, the depth inside, the per-piece contributions and the score
`max(weight × falloff)`, where the falloff is 1 inside and falls linearly to 0 at `buffer_m` outside. The Area
mode edits the pieces and saves them through the config writer; `POST /api/area/brush` turns a painted stroke
into a polygon (buffered in metres, unioned with or cut from a base piece). Agents read the area with
`findhome area show` and the history digest's Search area section.

## Scoring

[`domain/scoring.py`](../../backend/src/findhome/domain/scoring.py) `score_listing`:

- Hard filters from the listing kind's profile gate the listing. Any failure gives `total = null` and lists the
  reasons in `rejected_by`. `pet_status_exclude` defaults to `["no"]`. A sleeping alcove adds one room only when
  `accept_sovalkov` is true. `max_commute_min_by_category` uses the best median of that category's points.
- Each enabled preference group returns a 0..1 score or `None` when its data is missing (for example cost while
  `max_rent_sek` and `ideal_rent_sek` are unset). The total is the weighted mean of the groups that returned a
  score. Groups: cost, space, commute (point weight × window weight, linear between `good_min` and `bad_min`,
  reduced when the spread exceeds `reliability_spread_penalty_min`), cat_suitability, building_comfort,
  contract_availability, area (the area function's score; its breakdown keeps the contributions).
  `neighbourhood` has no scorer yet.
- With a search area defined, a listing whose area score is 0 (beyond the buffer) is rejected with
  `outside_search_area`, and the text filters `areas_include` / `areas_exclude` are not used. A listing without
  coordinates is not rejected: the area group is `None` (`area_unknown`). `scores recompute` geocodes up to 60
  listings without coordinates per run from `address_raw` (cached) before scoring.
- A disabled listing kind (`buy` today) is rejected with `kind_disabled.<kind>`.

## Where the code lives

| Concern | File |
|---|---|
| Load, validate, hash | [`config/loader.py`](../../backend/src/findhome/config/loader.py) |
| Write config | [`config/writer.py`](../../backend/src/findhome/config/writer.py) |
| Windows and grids | [`config/timegrid.py`](../../backend/src/findhome/config/timegrid.py) |
| Commute matrix | [`domain/commute.py`](../../backend/src/findhome/domain/commute.py) |
| Scoring | [`domain/scoring.py`](../../backend/src/findhome/domain/scoring.py) |
| Zones, search area, area function | [`geo/`](../../backend/src/findhome/geo/area.py), [`api/routers/geo.py`](../../backend/src/findhome/api/routers/geo.py) |
| Area editor (UI) | [`pages/map/area-mode.ts`](../../frontend/src/app/pages/map/area-mode.ts) |
| Locations editor (UI) | [`pages/locations.ts`](../../frontend/src/app/pages/locations.ts) |
| Tests | [`tests/config/test_config.py`](../../backend/tests/config/test_config.py), [`tests/unit/test_commute_plan.py`](../../backend/tests/unit/test_commute_plan.py), [`tests/unit/test_scoring.py`](../../backend/tests/unit/test_scoring.py), [`tests/unit/test_area.py`](../../backend/tests/unit/test_area.py) |
