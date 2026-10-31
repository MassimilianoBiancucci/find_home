# Current state relevant to enhance-map

## Map page today
- One file: [frontend/src/app/pages/map.ts](../../../frontend/src/app/pages/map.ts). A single full-width MapLibre map
  (style `config/providers.yaml` → `map.style_url`, OpenFreeMap "liberty"), 2D/3D tilt, "show rejected" toggle.
- Layers: `listings` (circle coloured by score), `listings-rejected`, `points` (your locations, category colour),
  optional `fh-3d-buildings` extrusion. Popup on listing click → detail page.
- No side panels, no layer manager, no drawing, no POI or transit layers.
- Frontend deps: `maplibre-gl` only (no draw library, no turf).

## Backend map API
- [api/routers/map.py](../../../backend/src/findhome/api/routers/map.py): `/api/map/settings`, `/points` (geocoded,
  cached), `/listings` (lat/lon + score under the active config hash).

## Areas today
- `profile.yaml` hard filters `areas_include` / `areas_exclude` are **text lists** (empty today).
- [domain/scoring.py](../../../backend/src/findhome/domain/scoring.py) L49-52: substring match on the listing's
  free-text `area` field. No geometry, no distance, no partial credit.
- `neighbourhood` preference group exists but is disabled and has no scorer ("needs the POI layer").

## POI
- [config/poi.yaml](../../../config/poi.yaml): categories grocery, metro, commuter_rail, bus_stop, park, vet,
  pharmacy, gym (OSM tags, radius, max walk, weight, provider overpass).
- [providers/poi.py](../../../backend/src/findhome/providers/poi.py): Overpass query builder + `poi_cache` table;
  **no endpoint uses it yet** (backlog `poi-layer`).

## Commute engine (reusable for "well connected" zones)
- [domain/commute.py](../../../backend/src/findhome/domain/commute.py): points × trips × windows × modes, providers
  by priority (ResRobot transit, OSRM drive, haversine fallback), `routing_cache`, run budget 500 calls.
- ResRobot limits: 45 calls/min, 30k/month (providers.yaml).

## Infra
- Postgres 16 **without PostGIS** (docker-compose `postgres:16`). Backend deps: no shapely/pyproj.
- Listings carry `lat`, `lon`, `area`, `address_raw`.

## Reference layout: Telia debug UI 3-box
- `~/Projects/telia_env/gcpai-se-co-debug-ui/ui/frontend/src/app/app.component.html`: three flex columns
  (`[style.flex]` per box) separated by `.resize-handle` divs with `(mousedown)` drag handlers; box 3 is optional
  (layout `3-box`) and switches content by mode (`box3Mode`).

## Related backlog items (tasks/BACKLOG.md)
- `poi-layer`: Overpass POI per listing, map layers, walking time to nearest. Overlaps with this task.
- `map-3d`: tilt presets, isochrones / commute heat layers. Overlaps (accessibility layer).
- `reliability-collector`: SL GTFS-RT delays. Related data source (Trafiklab).
