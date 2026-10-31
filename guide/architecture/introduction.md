# Architecture: introduction

A short tour of the components and how data moves between them. See the [overview](../overview.md) for the
directory map.

## Components

**Infrastructure.** [`docker-compose.yml`](../../docker-compose.yml) runs Postgres 16 on host port 5434 and pgAdmin
on 5052 with the server preloaded from [`infra/pgadmin/`](../../infra/pgadmin/servers.json). The API and the
Angular dev server run on the host, started by [`.vscode/launch.json`](../../.vscode/launch.json) and
[`.vscode/tasks.json`](../../.vscode/tasks.json): the compound `FH: Full Stack` first runs `FH: Dev Prereqs`, a
sequence of tasks that all terminate (free ports, [`scripts/ensure-env.sh`](../../scripts/ensure-env.sh) to create
a missing `backend/.venv`, `frontend/node_modules` or `config/*.env`, `docker compose up --wait`, migrate). It then
launches `FH: Backend (FastAPI)` under debugpy and `FH: Frontend (ng serve)` as a Node launch, together. No
long-running server is part of the pre-launch chain, so the launch never depends on matching a server's output.

**API.** [`api/main.py`](../../backend/src/findhome/api/main.py) builds the FastAPI app, binds to 127.0.0.1:8200,
opens an async psycopg pool ([`core/db.py`](../../backend/src/findhome/core/db.py)) without waiting for the
database, loads the config bundle and starts two watchers: one reloads the config, one imports JSON files dropped
into `inbox/` ([agent_contract.md](agent_contract.md)). The API starts even when Postgres is
down: it logs the database URL (password hidden) and whether it is reachable, `/health` reports `db_error`, and
any request needing the database returns 503 with the cause while the pool keeps retrying. Routers live in [`api/routers/`](../../backend/src/findhome/api/routers/listings.py).
Each request gets one connection, committed when the request succeeds.

**Data model.** [`migrations/001_init.sql`](../../backend/migrations/001_init.sql) defines `listings` (one row per
real flat, rent and buy columns), `listing_sources` (one row per site item, with its own content hash),
`listing_status_events`, `feedback`, `evaluations`, `scores` and `commute_results` (both keyed by `config_hash`),
the provider caches (`routing_cache`, `geocode_cache`, `poi_cache`) and `sites`, `scan_runs`, `agent_runs`.
[`002_probes.sql`](../../backend/migrations/002_probes.sql) adds `probes` (alpha: saved test points);
[`003_zone_commute.sql`](../../backend/migrations/003_zone_commute.sql) adds `zone_commute` (the Connectivity matrix).
[`db/migrate.py`](../../backend/src/findhome/db/migrate.py) applies the SQL files in order and refuses edited ones.

**Config.** YAML under [`config/`](../../config/profile.yaml) and [`sites/`](../../sites/README.md), described in
[config_and_locations.md](config_and_locations.md).

**Ingest and dedupe.** [`db/repo.py`](../../backend/src/findhome/db/repo.py) `ingest` matches an item first by
(site, external id), then across sites by the dedupe key from
[`domain/normalize.py`](../../backend/src/findhome/domain/normalize.py) (normalised street and number, floor,
rounded size, 500 SEK price band, plus a fuzzy address check). Change detection uses the source's own content
hash, so two sites listing the same flat do not overwrite each other on every scan. A known pet status is never
downgraded to `unknown`.

**Scanning.** [`scanning/runner.py`](../../backend/src/findhome/scanning/runner.py) scans one site: status check,
robots.txt, filters resolved through the site's `filter_map` ([`scanning/filters.py`](../../backend/src/findhome/scanning/filters.py)),
pages fetched with the site's delay, items parsed by
[`scanning/generic.py`](../../backend/src/findhome/scanning/generic.py) (HTML selectors or a JSON API with a field
map) or by an optional `sites/<slug>/scanner.py` (for example [`sites/qasa/scanner.py`](../../sites/qasa/scanner.py),
which reads the JSON embedded in Qasa's result pages; Qasa answers scripted requests with 429, so that site
runs as `agent_browser`). A scanner may also implement `enrich`: the runner calls it
for listings not seen before, up to `fetch.details.max_per_run`, and hashes the list-page view so later scans of
the same listing stay `unchanged`. Then the items are ingested. Raw pages are saved under `data/raw/`. Only
`active` sites are scanned; a dry run works on any site and stores nothing.
[`scanning/probe.py`](../../backend/src/findhome/scanning/probe.py) inspects a new site and recommends a fetch method.

**Commute and scoring.** [`domain/commute.py`](../../backend/src/findhome/domain/commute.py) and
[`domain/scoring.py`](../../backend/src/findhome/domain/scoring.py), described in
[config_and_locations.md](config_and_locations.md).

**Digests.** [`digest/history.py`](../../backend/src/findhome/digest/history.py) and
[`digest/listing.py`](../../backend/src/findhome/digest/listing.py) render compact text for agents and for the UI's
copy button. See [agent_contract.md](agent_contract.md).

**Agent runs.** [`agentrun/launcher.py`](../../backend/src/findhome/agentrun/launcher.py) starts a command from
`config/agent.yaml` as a subprocess (no shell), in a run folder prepared by
[`agentrun/rundir.py`](../../backend/src/findhome/agentrun/rundir.py), streams its output to `log.jsonl` and records
it in `agent_runs`. One run per profile at a time; a timeout kills it.

**CLI.** [`cli/main.py`](../../backend/src/findhome/cli/main.py) is a Typer app. Most commands call the API through
[`cli/client.py`](../../backend/src/findhome/cli/client.py); `db`, `config validate|hash|show|schema` and
`run new` work locally. [`scripts/findhome`](../../scripts/findhome) runs it from the repo root.

**Frontend.** Angular standalone components with signals in
[`frontend/src/app/`](../../frontend/src/app/app.routes.ts). One file per page (candidates, detail, locations,
sites, runs, settings) and a folder for the map. [`services/api.service.ts`](../../frontend/src/app/services/api.service.ts) wraps the API;
[`proxy.conf.json`](../../frontend/proxy.conf.json) sends `/api` and `/health` to :8200 (there is no BFF).
Settings edits whole YAML files in CodeMirror; Locations edits points through JSON-patch operations.

The shell ([`app.html`](../../frontend/src/app/app.html)) has three boxes, like the Telia debug UI: box 1 holds
the navigation bubble (pages, with the map modes as child entries) and the bubbles of the active page; box 2 is
the routed page; box 3 is an optional right panel. A page publishes its bubbles and panel as `TemplateRef`s
through [`LayoutService`](../../frontend/src/app/services/layout.service.ts) `register`, which removes them when
the page is destroyed. Box widths and collapsed bubbles persist in localStorage; drag handles resize the boxes.

The map ([`pages/map/`](../../frontend/src/app/pages/map/map-shell.ts)) is one MapLibre instance owned by
`MapShell` and shared through [`MapStateService`](../../frontend/src/app/pages/map/map-state.service.ts) with
the modes, which are child routes (`/map/explore`, `/map/area`, `/map/connectivity`). Modes add named layer
groups (`addGroup`), toggle them (`setVisible`, persisted) and read the shared `selection`. The base style is
`map.style_url` (light) or `map.style_url_dark` from `config/providers.yaml`; switching the colour mode reloads
the style and re-applies every group. A style that cannot load falls back to a blank background.

Every marker is a round **blip** (category colour, white glyph, dark outline, glow) drawn on a canvas by
[`components/map-icons.ts`](../../frontend/src/app/components/map-icons.ts) and added on demand through
MapLibre's `styleimagemissing` (`blip:<glyph>:<rrggbb>`), so blips survive style reloads.
[`PoiLayersService`](../../frontend/src/app/pages/map/poi-layers.service.ts) adds one layer per POI category, loaded
the first time it is switched on. The **test point** (right-click, or the Test point button) lives in
[`ProbeService`](../../frontend/src/app/pages/map/probe.service.ts): it survives mode switches, calls
`/api/probe`, and draws the pin, straight lines to the nearest places and the legs of the selected itinerary;
[`probe-panel.ts`](../../frontend/src/app/pages/map/probe-panel.ts) shows it in the inspector of every mode, plus
the alpha saved test points and their side-by-side compare.
[`TransitLayersService`](../../frontend/src/app/pages/map/transit-layers.service.ts) draws one line layer per transit
mode (data loaded when first shown; buses from zoom 12) and the stations as blips; the inspector shows a line's
stations in order or the lines serving a station.
[`ConnectivityService`](../../frontend/src/app/pages/map/connectivity.service.ts) holds the zone × point matrix:
the Connectivity mode ([`connectivity-mode.ts`](../../frontend/src/app/pages/map/connectivity-mode.ts)) fills the zones
by minutes for one point or the weighted mix and starts or cancels the refresh; Explore can show a light tint of
the same colours; hovering a zone shows its minutes over the map; the test point shows its zone's matrix value
next to its own itinerary.

## Main flows

```mermaid
flowchart LR
  subgraph Agent["Agent (Claude Code / Codex) + find-home skill"]
    A1[scripts/findhome]
  end
  Sites[(listing sites)] -->|scripted scan| Scan[scanning.runner]
  Sites -->|browser| Agent
  A1 -->|HTTP| API[FastAPI :8200]
  Scan --> Repo[db.repo.ingest]
  API --> Repo
  Repo --> PG[(Postgres)]
  API --> Commute[domain.commute] --> Prov[providers] --> PG
  API --> Score[domain.scoring] --> PG
  PG --> Digest[digest] --> A1
  UI[Angular :4400] -->|/api proxy| API
  UI -->|Run agent| Launcher[agentrun.launcher] --> Agent
```

```mermaid
flowchart LR
  Edit[YAML edit: user, UI or agent] --> Validate[schemas + cross-file checks]
  Validate -->|valid| Hash[new config_hash]
  Validate -->|invalid| Keep[previous bundle stays active, errors on /health]
  Hash --> Stale[scores and commute results of the old hash become stale]
  Stale --> Recompute[scores recompute / commute]
```

## Where the code lives

| Concern | File |
|---|---|
| App start, health, error mapping | [`api/main.py`](../../backend/src/findhome/api/main.py) |
| Listings, status, feedback | [`api/routers/listings.py`](../../backend/src/findhome/api/routers/listings.py) |
| Ingest endpoints | [`api/routers/ingest.py`](../../backend/src/findhome/api/routers/ingest.py) |
| Commute and score endpoints | [`api/routers/scoring.py`](../../backend/src/findhome/api/routers/scoring.py) |
| Config endpoints | [`api/routers/config.py`](../../backend/src/findhome/api/routers/config.py) |
| Sites and scans | [`api/routers/sites.py`](../../backend/src/findhome/api/routers/sites.py) |
| Runs and agent launch | [`api/routers/runs.py`](../../backend/src/findhome/api/routers/runs.py) |
| Map GeoJSON | [`api/routers/map.py`](../../backend/src/findhome/api/routers/map.py) |
| Zones, search area, brush | [`api/routers/geo.py`](../../backend/src/findhome/api/routers/geo.py) |
| POIs, test point, saved test points | [`api/routers/probe.py`](../../backend/src/findhome/api/routers/probe.py) |
| Connectivity matrix and refresh | [`api/routers/connectivity.py`](../../backend/src/findhome/api/routers/connectivity.py) |
| SQL | [`db/repo.py`](../../backend/src/findhome/db/repo.py) |
