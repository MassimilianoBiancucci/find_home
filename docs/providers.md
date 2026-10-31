# External providers

All providers sit behind adapters in `backend/src/findhome/providers/` and are switched on in
[`config/providers.yaml`](../config/providers.yaml). Keys live in the gitignored `config/providers.env`
(template: [`config/providers.env.example`](../config/providers.env.example)). Results are cached in Postgres,
so the same origin, destination, mode and time slot is never requested twice within the cache TTL.

## haversine (built in)
Straight-line distance plus an assumed speed per mode. No network, no key. Used as the prefilter that decides
which listings deserve real routing calls.

## OSM: Nominatim (geocoding) and OSRM (walk / bike / drive)
Free, no key. The public endpoints have strict usage policies (Nominatim: max 1 request/second, a valid
User-Agent, no bulk geocoding). The adapter enforces 1 req/s and caches results. **No public transport.**
For heavy use, self-host OSRM or use OpenRouteService with a free key.

## Trafiklab ResRobot v2.1 (transit, default)
Sweden-wide journey planner on official timetables (SL included).
- Get a key: create an account at trafiklab.se, create a project, add the "ResRobot v2.1" API to it, copy the key
  into `TRAFIKLAB_RESROBOT_KEY`.
- Limits listed by Trafiklab per key level: Bronze 45 calls/min and 30,000/month, Silver 60/min and 200,000/month,
  Gold 200/min and 1,000,000/month.
- **To verify:** that the key levels are free of charge, and that the route planner supports arrive-by search with
  coordinate origins (`searchForArrival`, `originCoordLat/Long`). See `guide/issues/issues.md`.
- Timetable-based: gives scheduled times, not historical delays. Reliability by hour comes from sampling slots;
  a realtime delay collector (SL GTFS-RT via Trafiklab) is in `tasks/BACKLOG.md`.

## Google Maps Platform (optional, off)
Routes API (transit and traffic-aware driving), Geocoding, Places, Maps JS / 3D tiles. Needs a billing account.
Costs, free caps and key setup: [google-apis.md](google-apis.md). The adapter pins a minimal `X-Goog-FieldMask`
so calls stay in the cheapest SKU.

## OSM Overpass (points of interest)
Free, no key. Used for groceries, stops, parks, vets and the other categories in
[`config/poi.yaml`](../config/poi.yaml). Public instances throttle heavy use: the adapter caches per rounded
coordinate and radius.

## Map style (frontend)
MapLibre GL with an OSM-based vector style configured in `config/providers.yaml` (`map.style_url`). The default is
the free OpenFreeMap "liberty" style (no key). **To verify:** its usage terms before relying on it; attribution to
OpenStreetMap contributors is always shown.
