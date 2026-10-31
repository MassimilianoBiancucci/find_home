## Plan: Angular frontend shell and map

The UI is where you review candidates quickly, see them on a map next to your points, tune configs, give feedback and start agent runs. Init builds the shell and every page with real data wiring for what already exists: listings from fixtures, locations from config, sites, runs, config editing. The heavy features are left as clearly marked placeholders for backlog tasks: commute heatmaps, POI layers, 3D. Stack and look follow the Debug UI and IA frontends:

- Angular standalone components with signals;
- ng-bootstrap and Bootstrap 5;
- SCSS variables;
- a dark/light theme service.

Angular talks to FastAPI directly through the `ng serve` proxy (no BFF). Use the Angular major version the Debug UI currently pins (22 in `ui/frontend/package.json`), unless a newer stable release is required at implementation time.

### Pages

| Route | Purpose in init | Later |
|---|---|---|
| `/candidates` | Table sorted by score: short_id, area, rok, m², rent, pet_status chip, commute summary, status, tags; filters; keyboard triage (j/k move, s shortlist, r reject with tag picker, n note) | Saved views |
| `/candidates/:shortId` | Detail: digest block, photos/floor plans (links), evaluation, commute table per point/window with median/p90/worst, status timeline, feedback form, "copy digest for agent" | Side-by-side compare |
| `/map` | MapLibre map: candidate markers coloured by score, location points with category colours/icons, click → detail drawer; 2D/tilt toggle and 3D building extrusion | POI layers, isochrones, commute heat |
| `/locations` | List and edit points, categories, trips and windows (form editor writing through `PATCH /api/config/locations`) | Draw point on map |
| `/sites` | Registry status, method, last scan, errors; "Scan now" (scripted) per site | Probe viewer |
| `/runs` | Scan runs and agent runs; "Run agent" (profile picker from `agent.yaml`), live log tail (SSE) | Scratchpad viewer |
| `/settings` | Config files: schema-validated YAML editor per file (profile, poi, tags, providers, time_model), config hash, provider status (keys present / enabled) | Proposed-config patch review |

### Steps

1. **Scaffold** `frontend/` with `ng new` (standalone, routing, SCSS, no SSR).
   - Add `@ng-bootstrap/ng-bootstrap`, `bootstrap`, `maplibre-gl` and a small YAML editor. Use CodeMirror 6 with `@codemirror/lang-yaml`, chosen for its small size.
   - Add `proxy.conf.json`, sending `/api` and `/health` to `http://127.0.0.1:8200`.
   - Pin `.nvmrc` to Node 20.
   - Copy the layout pattern from the Debug UI rather than its code, since the theme tokens differ: sidebar plus content, `layout.service`, `theme.service` with a dark/light toggle, and `_variables.scss` with find_home's own palette.

2. **Write the API layer.**
   - `services/api.service.ts` holds typed `HttpClient` calls. The types are generated from the backend OpenAPI (`openapi-typescript` → `src/app/models/api.d.ts`, via an npm script `gen:api` that reads `config/schemas/ingest/openapi.json`) so the front and back ends can't drift.
   - Signal stores: `listings.store`, `config.store` and `runs.store`. Use polling for runs and SSE for the agent log.

3. **Build Candidates and detail for fast triage.**
   - The table virtualises rows with CDK virtual scroll.
   - Keyboard shortcuts post status and feedback changes immediately, with optimistic updates.
   - The tag picker reads `tags.yaml` through `/api/config/tags`.
   - The detail page shows the commute table exactly as the backend returns it, plus the digest text block with a copy button.
   - Empty states explain how to get data (`findhome ingest --file ...` or run a scan).

4. **Build the map.**
   - Show MapLibre GL with a free OSM-based vector style, configurable in `config/providers.yaml` under `map.style_url`. Use a style that needs no key, or a self-hosted style JSON; verify its licence and usage limits at implementation and note them in `docs/providers.md`.
   - Add GeoJSON sources for candidates and for points (from `/api/config/locations`, geocoded through the backend).
   - Add a layer toggle panel, a pitch/bearing control for the tilted 2D/3D view, and a `fill-extrusion` building layer when the style has building heights.
   - Clicking a marker opens a drawer with the digest. The map provider is behind a small `MapAdapter` interface, so a Google Maps or Google 3D Tiles adapter can be added later (see `docs/google-apis.md`).

5. **Build Locations and Settings editors.**
   - The Locations editor is a structured form (point → trips → windows) built from `locations.schema.json`. It validates on the client with `ajv` and on the server through `PATCH`, which uses the comment-preserving writer.
   - Settings shows the CodeMirror YAML editor per file, with server-side validation errors shown inline, plus the current `config_hash`.
   - Saving any scoring-relevant file shows a banner: "scores computed with an older config: recompute", linked to `POST /api/scores/recompute`.

6. **Build Sites and Runs.**
   - Sites lists the registry and offers "Scan now", which calls `POST /api/scans`, disabled for `unverified` sites.
   - Runs lists scan and agent runs. "Run agent" opens a modal with the profile list and the prompt file name, then streams the log. Show a warning that the agent CLI must be installed and logged in on this Mac.

7. **Add tests and tasks.**
   - Component tests: candidates keyboard triage, locations form validation, and the map adapter called with the right GeoJSON. Use mocked services, with the default Angular test runner of the pinned version.
   - Add `FH: ng serve` (background matcher), `FH: Frontend tests` and `FH: Generate API types` to `.vscode/tasks.json`.
   - Check that `FH: Full Stack` + `FH: Dev Prereqs` opens http://localhost:4400 with all pages rendering against fixture data.
   - Commit as `feat(frontend): Angular shell, map, editors (init-project 07)`.
