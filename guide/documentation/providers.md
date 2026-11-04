# External providers

All providers sit behind adapters in `backend/src/findhome/providers/` and are switched on in
[`config/providers.yaml`](../../config/providers.yaml). Keys live in the gitignored `config/providers.env`
(template: [`config/providers.env.example`](../../config/providers.env.example)). Results are cached in Postgres,
so the same origin, destination, mode and time slot is never requested twice within the cache TTL.

## haversine (built in)
Straight-line distance plus an assumed speed per mode. No network, no key. Used as the prefilter that decides
which listings deserve real routing calls.

## OSM: Nominatim (geocoding) and OSRM (drive)
Free, no key. The public endpoints have strict usage policies (Nominatim: max 1 request/second, a valid
User-Agent, no bulk geocoding). The adapter enforces 1 req/s and caches results. **No public transport.**
The public OSRM demo server only routes cars, so `osm.modes` is `[drive]`; walk and bike fall back to the
haversine estimate until you point `osrm_url` at a self-hosted OSRM (foot/bike profiles) or add OpenRouteService.

When a provider fails 3 times in a row during one commute run, the rest of that run uses haversine estimates
for it (marked `~` in digests) instead of retrying.

## Address suggestions: OpenRouteService or Photon
The Locations editor suggests addresses while you type. Nominatim's usage policy forbids autocomplete, so
suggestions use OpenRouteService's geocode/autocomplete (free key at openrouteservice.org, `ORS_API_KEY`; the
same key serves walking times) and fall back to Photon (photon.komoot.io, no key, fair use). Configured under
`geocoding.suggest` in `config/providers.yaml`. Suggestions are cached in memory by the API.

## Trafiklab ResRobot v2.1 (transit, default)
Sweden-wide journey planner on official timetables (SL included).
- Get a key: create an account at trafiklab.se, create a project, add the "ResRobot v2.1" API to it, copy the key
  into `TRAFIKLAB_RESROBOT_KEY`.
- Limits listed by Trafiklab per key level: Bronze 45 calls/min and 25,000/month, Silver 60/min and 200,000/month,
  Gold 200/min and 1,000,000/month.
- **To verify:** that the key levels are free of charge, and that the route planner supports arrive-by search with
  coordinate origins (`searchForArrival`, `originCoordLat/Long`). See `guide/issues/issues.md`.
- Timetable-based: gives scheduled times, not historical delays. Reliability by hour comes from sampling slots;
  a realtime delay collector (SL GTFS-RT via Trafiklab) is in `tasks/BACKLOG.md`.
- The map's test point also asks ResRobot for one itinerary per point (`passlist=1`: legs with stops and
  coordinates), cached per ~100 m origin cell.
- The Connectivity map mode asks ResRobot for every zone × point × window (~2,100 requests for the 263 zones,
  about 8% of the Bronze monthly quota, ~47 minutes at 45/min), capped by `budget.max_connectivity_calls_per_run`,
  cached and resumable. Without a key the matrix holds straight-line estimates, replaced on the next refresh with a key.

## Transit network for the map: SL GTFS or OSM routes
`findhome geo fetch transit` builds the map's lines and stations under `data/geo/transit/`. With
`TRAFIKLAB_GTFS_KEY` (Trafiklab project + "GTFS Regional Static data" API; CC0; Bronze key: 50 downloads/month) it
uses SL's GTFS (`sl.zip`, downloaded at most every `refresh_days`). Without a key it uses OpenStreetMap route
relations from Overpass (three requests, raw answers kept in `data/geo/raw/` for `refresh_days`). SL lines without a
number or with a future `start_date` (the yellow metro line under construction) are skipped. GTFS has no line
colours: they come from [`config/transit_colours.yaml`](../../config/transit_colours.yaml) (approximate, **to verify**
against SL's network map), then from OSM's `colour` tag.

## Google Maps Platform (optional, off)
Routes API (transit and traffic-aware driving), Geocoding, Places, Maps JS / 3D tiles. Needs a billing account.
Costs, free caps and key setup: [google-apis.md](google-apis.md). The adapter pins a minimal `X-Goog-FieldMask`
so calls stay in the cheapest SKU.

## OSM Overpass (points of interest)
Free, no key. Used for SATS, groceries, stations, parks, vets and the other categories in
[`config/poi.yaml`](../../config/poi.yaml). `findhome geo fetch poi` fetches every category for the whole region in
one request per category (Overpass usage policy: scheduled region-wide fetches, never one query per listing) into
`data/geo/poi/`. Run it again every `fetch.refresh_days` (7); busy instances (429/502/503/504) are retried with
back-off.

## OpenRouteService (walking minutes)
The map's test point asks for real walking minutes to the nearest places with one ORS **matrix** request per click
(`routing.ors`, `ORS_API_KEY`; free key at openrouteservice.org: matrix 500/day, directions 2,000/day, 40/min).
Every origin/destination pair is cached in `routing_cache` for `cache.routing_ttl_days`. Without a key, or when
ORS fails, minutes are straight-line estimates (×1.3 detour) marked `~` in the inspector. ORS is also first in
`mode_priority.walk` for commute runs. No public transport: transit stays on ResRobot.

## Map style (frontend)
MapLibre GL with an OSM-based vector style configured in `config/providers.yaml` (`map.style_url`). The default is
the free OpenFreeMap "liberty" style (no key). **To verify:** its usage terms before relying on it; attribution to
OpenStreetMap contributors is always shown.
