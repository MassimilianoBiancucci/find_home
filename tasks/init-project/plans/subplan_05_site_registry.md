## Plan: Site registry

Each listing website gets its own folder under `sites/`, containing:

- a machine-readable `site.yaml`, validated by `config/schemas/site.schema.json`, that tells scanners how to fetch, filter, paginate, parse and behave politely;
- a human/agent-readable `NAVIGATION.md` that explains how to use the site effectively, with screenshots described in words, filter steps, login needs and known traps.

General filters (`profile.yaml` hard_filters, keyed by `filters_catalog.yaml`) drive each site's own filters through a per-site `filter_map`. Filters a site cannot apply are marked `local_only` and enforced after parsing. Init ships a template plus four **unverified** rent stubs (Blocket Bostad, Qasa, Samtrygg, Bostadsförmedlingen). Nothing about these sites is researched or scanned yet: every site-specific value is written as a hypothesis, marked `# UNVERIFIED`, for the `verify-sites` backlog task.

### Steps

1. **Define `site.schema.json`** (in 02) and the template `sites/_template/site.yaml`:

   ```yaml
   # yaml-language-server: $schema=../../config/schemas/site.schema.json
   slug: example-site
   name: Example Site
   url: https://example.org
   kinds: [rent]                  # rent | buy
   status: unverified             # unverified | active | broken | disabled
   last_verified: null
   fetch:
     order: [api, http, playwright, agent_browser]   # cheapest first
     method: null                 # chosen after probe/verification
     list_url_template: null      # e.g. "https://.../search?min_rooms={min_rooms_rok}&page={page}"
     api: { endpoint: null, method: GET, items_path: null }
     selectors: { item: null, external_id: null, url: null, title: null, price: null, size: null, rooms: null, address: null }
     pagination: { type: page_param, param: page, max_pages: 5 }
   filter_map:                    # canonical key (filters_catalog) -> site param / UI step / local_only
     max_rent_sek: { param: null, local_only: true }
     min_rooms_rok: { param: null, local_only: true }
     pets_allowed:  { param: null, local_only: true, note: "verify whether the site exposes a pet filter" }
   field_map: {}                  # site field -> ListingIn field, with optional parser name
   pets: { filter_available: unknown, typical_wording: [] }
   auth: { mode: none }           # none | browser_session (agent uses the user's logged-in Chrome; never store credentials)
   politeness: { min_delay_s: 3, max_pages_per_run: 10, respect_robots: true, user_agent: "findhome/0.1 (personal use)" }
   schedule: { interval: null }   # documented for an external scheduler; the app does not schedule
   notes: ""
   ```

2. **Write `sites/_template/NAVIGATION.md`** with fixed sections, so the agent can update one section at a time without rereading the whole file:
   1. Purpose and coverage (rent/buy, regions, first- or second-hand).
   2. Access (login needed? BankID? cookie wall?).
   3. Search flow (step-by-step clicks or URL params to reach a filtered Stockholm list).
   4. Filters (which canonical filters map to what, and which are local only).
   5. Listing page anatomy (where price, size, rooms, pets, contract and floor plan appear).
   6. Pet wording (phrases seen, and how they map to `pet_status`).
   7. Pagination and limits.
   8. Known traps (duplicates, sponsored items, stale ads, scam patterns).
   9. Probe history (links to `probe/*.md`).
   10. Last verified, by whom (agent run id).

3. **Create the four stubs** by copying the template into `sites/blocket-bostad/`, `sites/qasa/`, `sites/samtrygg/` and `sites/bostadsformedlingen/`.
   - Fill only the safe facts: name, home URL, `kinds: [rent]`, `status: unverified`.
   - Write one line per stub in `notes`, giving its expected role as a hypothesis:
     - Blocket Bostad and Qasa: second-hand marketplaces, probably with a pets filter.
     - Samtrygg: second-hand with landlord vetting.
     - Bostadsförmedlingen: queue-based first-hand listings, login likely needed for applications.
   - Keep `fetch.method: null` and all selectors null.
   - In each `NAVIGATION.md`, mark every section "To verify".
   - Do not visit the sites in init.

4. **Write the registry docs** in `sites/README.md`:
   - **Add a site.** Run `findhome site probe <url> --slug <slug>`, then copy the template, fill `site.yaml` from the probe report, have the agent write `NAVIGATION.md` with the `site_onboarding` prompt (06), run `findhome config validate`, run `findhome scan <slug> --dry-run`, and set `status: active` only after a dry run returns parsed listings.
   - **Repair a site.** When a scan reports parse errors or zero items, set `status: broken` and follow the `site_repair` prompt.
   - **Retire a site.**
   - **Respect the site's terms**: personal use only, polite delays, no stored credentials, and agent-browser mode for login-walled sites.

5. **Hook the registry into the app.**
   - The backend syncs the `sites` table from `sites/*/site.yaml` on startup and on file change (each site's config_hash is stored).
   - `GET /api/sites` returns status, method, last scan and errors.
   - `findhome config validate` validates every `site.yaml` too, and fails if a `filter_map` key isn't in `filters_catalog.yaml`.
   - A test asserts that all four stubs validate and that every catalog filter is mapped or marked local_only in every site.

6. **Record the follow-up.** Add a `verify-sites` entry to `tasks/BACKLOG.md` covering:
   - per site: probe, choose the fetch method, fill the filter map, write the navigation doc, run a dry-run scan, then activate;
   - the open question for each site: is there a native pets filter, and is login needed;
   - the order to work through them: Qasa, Blocket Bostad, Samtrygg, then Bostadsförmedlingen.

   Commit as `feat(sites): site registry template and unverified stubs (init-project 05)`.
