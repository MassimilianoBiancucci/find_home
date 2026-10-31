## Plan: Open configuration system

This sub-plan defines every YAML config the user, the agent and the app share, plus the JSON Schemas that validate them, a typed loader, a config hash for reproducible scores, and a comment-preserving writer for edits made from the UI. Everything that might change as needs evolve lives here, not in code. That covers hard limits, weights, locations with their trips and time slots, POI categories, reason tags, site filter mappings, providers and the agent command. The model is rent-first but buy-ready: profile, criteria and statuses are keyed by `listing_kind`.

### Config files

| File | Purpose | Notes |
|---|---|---|
| `config/profile.yaml` | Per listing kind: `hard_filters` (gate) and `preferences` (weighted scoring) | `rent` filled, `buy` slots present but `enabled: false` |
| `config/filters_catalog.yaml` | Canonical filter keys, type, unit, description | Sites map these keys (05) |
| `config/locations.yaml` | Points of interest with categories, weights, notes, trips and time windows | Several points per category |
| `config/time_model.yaml` | Global defaults: day types, grid, dense windows, reliability stats | Overridden per trip |
| `config/poi.yaml` | Nearby-services categories (OSM tags, radius, weight) | Overpass first |
| `config/tags.yaml` | Feedback reason tags (positive and negative) and lifecycle statuses per kind | Feeds the digest |
| `config/providers.yaml` | Routing/POI provider enable flags, priorities, budgets, rate limits | Keys come from `providers.env` |
| `config/agent.yaml` | Headless agent commands for the "Run agent" button | Claude and Codex profiles |
| `config/*.env.example` | `backend.env` (DB URL, ports), `providers.env` (TRAFIKLAB_RESROBOT_KEY, GOOGLE_MAPS_SERVER_KEY, GOOGLE_MAPS_BROWSER_KEY) | Real `*.env` gitignored |
| `config/schemas/*.schema.json` | One JSON Schema per YAML plus `site.schema.json` and `ingest/*.schema.json` | Draft 2020-12 |

### Steps

1. **Write `locations.yaml` and `time_model.yaml`** with the open points model the user asked for. You can have any number of points per category, and each point carries its own trips and time slots.

   ```yaml
   # config/locations.yaml
   categories:
     work:        { label: Work,        default_weight: 1.0, color: "#990ae3", icon: briefcase }
     partner:     { label: Partner,     default_weight: 0.8, color: "#e91e63", icon: heart }
     transit_hub: { label: Transit hub, default_weight: 0.5, color: "#2196f3", icon: train }
     generic:     { label: Point,       default_weight: 0.3, color: "#607d8b", icon: pin }
   points:
     - id: work-main
       category: work
       label: "Office"                      # TODO(user): real address
       address: "TODO"
       weight: 1.0
       notes: "Must arrive 08:00-09:00, flexible"
       modes: [transit, bike]
       trips:
         - direction: to_point             # home -> point
           day_types: [weekday]
           windows: [{ type: arrive_by, from: "08:00", to: "09:00", weight: 1.0, step_min: 15 }]
         - direction: from_point           # point -> home
           day_types: [weekday]
           windows: [{ type: depart_at, from: "16:30", to: "18:30", weight: 0.6, step_min: 30 }]
     - id: stockholm-central
       category: transit_hub
       label: "Stockholm C"
       coords: [59.3303, 18.0586]
       modes: [transit, walk]
       trips:
         - { direction: both, day_types: [weekday, saturday, sunday], use_default_grid: true }
     - id: partner-1
       category: partner
       label: "Partner home"                # TODO(user)
       address: "TODO"
       modes: [transit]
       trips:
         - direction: both
           day_types: [weekday, saturday, sunday]
           windows: [{ type: depart_at, from: "18:00", to: "03:00", weight: 1.0, step_min: 60 }]
   ```

   `time_model.yaml` defines `day_types` (weekday = Mon-Fri, saturday, sunday, each with a reference date rule such as "next Tuesday not on a public holiday" so sampled timetables stay comparable), the `default_grid` (`from: "07:00"`, `to: "03:00"`, `step_min: 60`, `dense: [{from: "07:00", to: "09:00", step_min: 15}]`), and the reliability stats to report (`median`, `p90`, `worst`, `spread`). Windows that cross midnight (`18:00`→`03:00`) are allowed, and the schema documents them.

2. **Write `profile.yaml` and the other vocabularies.**
   - `profile.yaml` has a `rent` section with `hard_filters`:
     - `max_rent_sek: null  # TODO(user)`, `min_size_m2: null  # TODO(user)`.
     - `min_rooms_rok: 2` with the comment `# >=1 bedroom; does 1 rok + sovalkov count? TODO(user)` and `accept_sovalkov: false`.
     - `move_in_from`, `move_in_to`, `areas_include`, `areas_exclude`, `max_commute_min_by_category`.
     - `pet_status_exclude: [no]` and `contract_types: [first_hand, second_hand, sublet]`.
   - `rent` also has `preferences`, one weighted group per criteria category, each with `enabled` and `weight`: `cost` (rent, price per m²), `space`, `commute`, `cat_suitability` (pet status penalty for `ask`/`unknown`, secure balcony, floor/lift, green space or vet nearby), `building_comfort`, `contract_availability` and `neighbourhood`.
   - `buy` mirrors the structure with `enabled: false` and buy-specific keys (`max_price_sek`, `max_avgift_sek`).
   - `filters_catalog.yaml` lists every canonical filter key used by `hard_filters`, with type and unit.
   - `tags.yaml` defines the lifecycle statuses (`new, shortlisted, contacted, viewing, applied, rejected, archived`), per-kind overrides, positive tags (`great_commute`, `cat_friendly`, `bright`, ...) and negative tags (`too_far`, `no_pets`, `noisy`, `too_small`, `over_budget`, `bad_layout`, `short_contract`, ...).
   - `poi.yaml` lists categories with OSM tag filters and radius: `grocery` (`shop=supermarket|convenience`), `metro` (`station=subway`), `commuter_rail`, `bus_stop` (`highway=bus_stop`), `park` (`leisure=park`), `vet` (`amenity=veterinary`), `pharmacy`, `gym`. Each has a `weight`, a `max_walk_min` and a provider (`overpass` | `google_places`).

3. **Write `providers.yaml` and `agent.yaml`.**
   - `providers.yaml` lists the routing providers with `enabled`, `modes` and `priority`: `haversine` (always), `osm` (walk, bike, drive; Nominatim + OSRM public demo or ORS, rate limited at 1 request/s), `resrobot` (transit, default, `max_calls_per_month: 30000`, `max_calls_per_minute: 45`) and `google` (transit and drive, `enabled: false`, `max_elements_per_month` below the free cap).
   - It also sets `budget.max_routing_calls_per_run`, `cache.ttl_days` (timetables change by season, default 30) and `prefilter.max_haversine_km_by_category`.
   - `agent.yaml` lists the run profiles. Each profile has a `command`, `args`, `cwd`, `timeout_min`, `env_passthrough` and a `prompt_file` (from 06). For example: `claude_scan`, i.e. `claude -p "$(cat .agents/skills/find-home/prompts/run_scan.md)" --output-format stream-json`, with the exact flags verified at implementation, and `codex_scan` (`codex exec ...`). The app never interprets the output, it only streams and stores it.

4. **Write the JSON Schemas** in `config/schemas/`, one per file, plus `site.schema.json` (used by 05).
   - Use `additionalProperties: false` at every level except `notes` and `extra` maps, so that typos fail loudly.
   - Use enums for `direction`, `window.type`, `pet_status` and `listing_kind`.
   - Use `pattern` for `HH:MM` times and `format: date` for dates.
   - Every property gets a `description`, so the VS Code YAML extension and the UI can show help text.
   - Reference the schemas from each YAML file's first line (`# yaml-language-server: $schema=./schemas/locations.schema.json`).

5. **Implement the loader** in `backend/src/findhome/config/`:
   - `models.py` holds pydantic v2 models mirroring the schemas (generated once with `datamodel-code-generator`, then hand-kept; the schemas stay the source of truth, and a test asserts the two agree).
   - `loader.py` has `load_all(config_dir) -> ConfigBundle`. It validates each YAML against its schema (`jsonschema`), parses it into the models, resolves trip defaults from `time_model`, resolves the enabled flags in `providers.env`, and computes `config_hash` (SHA-256 over the canonical JSON of the scoring-relevant files: profile, locations, time_model, poi, tags). Each score row later stores this hash.
   - `watch.py` provides a file watcher (`watchfiles`) for the backend that reloads the bundle on change and logs validation errors without crashing; the last valid bundle stays active.

6. **Implement the writer** in `config/writer.py`. `update(file, json_patch)` loads the YAML with `ruamel.yaml` (round-trip mode, so comments and order survive), applies the patch, validates the result against the schema, then writes it atomically (temp file + rename). The UI (07) and the API config endpoints (03) use this path. The agent edits files directly and must run `findhome config validate` afterwards (06).

7. **Add the tests** in `backend/tests/config/`:
   - All `*.yaml` files in `config/` validate against their schemas.
   - The models round-trip the files.
   - `config_hash` is stable across key reordering and changes when a weight changes.
   - A midnight-crossing window expands correctly into slots (`18:00..03:00` step 60 gives 10 slots).
   - The writer preserves comments.
