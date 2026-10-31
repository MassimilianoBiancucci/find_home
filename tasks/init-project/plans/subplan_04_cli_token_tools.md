## Plan: `findhome` CLI and token-saving tools

The CLI is how the agent, the VS Code tasks and the user drive the app without reading raw pages or the database. Every command prints compact, fixed-format output that fits a small token budget, and supports `--json` for scripts. It is a thin client of the REST API from 03; only `db migrate` and `config validate` work offline. This sub-plan builds the six token-saving tools agreed in the QA:

- scan + normalize + dedupe
- compact listing digest
- history digest
- commute matrix with cache
- site onboarding probe
- the run scratchpad convention

### Token budget rules (apply to every command)

- **Short IDs.** Identify listings by `short_id` (`L-7Q2K`), never by URL or full UUID in human output.
- **Default output.** It is a short Markdown table or key: value block, with `--limit` defaults of 20 rows, truncated text fields (description excerpt ≤ 280 chars) and omitted null fields. The size guide is about 150 tokens per listing in a digest and about 40 tokens per row in a history line.
- **Diff mode.** `--since <run|timestamp>` returns only new or changed items, so a repeated run costs close to nothing when nothing changed.
- **Raw HTML.** Raw HTML is never printed. It is saved to `data/raw/<site>/<external_id>/<timestamp>.html` and referenced by path.

### Steps

1. **Build the CLI skeleton** in `backend/src/findhome/cli/main.py` with Typer.
   - Command groups: `db`, `config`, `scan`, `listings`, `digest`, `commute`, `site`, `run`.
   - Global options: `--api` (default from `FINDHOME_API`, falling back to `http://127.0.0.1:8200`), `--json` and `--quiet`.
   - Write a shared `client.py` (httpx) with clear errors. If the API is down, it says "backend not running: start `FH: Full Stack` or `docker compose up` + `findhome serve`".
   - Add `findhome serve`, which runs uvicorn without the debugger, for headless agent runs.

2. **Scan, normalize and dedupe** (`findhome scan <slug>|--all [--dry-run] [--max-pages N]`).
   - Add the `scanning/` package with a scanner interface:

     ```python
     class Scanner(Protocol):
         slug: str
         method: Literal["api", "http", "playwright"]
         def build_queries(self, filters: ResolvedFilters) -> list[Query]: ...
         async def fetch(self, q: Query) -> list[RawItem]: ...      # obeys site politeness
         def parse(self, raw: RawItem) -> ListingIn: ...             # via domain.normalize
     ```

   - A registry loads `sites/<slug>/scanner.py` if it exists, otherwise a generic `HttpListScanner` driven purely by `site.yaml` selectors (list URL template, item selector, field selectors, pagination).
   - `filters.py` resolves `profile.yaml` hard_filters through `filters_catalog.yaml` and the site's `filter_map`. Filters the site can apply go into the query; `local_only` filters are applied after parsing.
   - The command posts batches to `/api/ingest/listings` and prints one summary line per site: `blocket-bostad: 48 seen, 5 new, 2 changed, 3 dup-cross-site, 38 unchanged, 0 errors (method=http, 12.4s)`.
   - In init only the generic scanner and a fixture-based test exist. Live scanners come in `verify-sites`.

3. **Listing digest** (`findhome digest listing <short_id>... [--fields core|full]`).
   - Output is one fixed block per listing, for example:

     ```
     L-7Q2K rent 2rok 54m² 13 900 kr  Södermalm, Hornsgatan 12 (3/5, lift)
     pets: ask ("husdjur enligt överenskommelse")  contract: 2nd-hand → 2027-08-31
     commute: work-main 32′/38′p90 · stockholm-central 14′ · partner-1 41′ (night 58′)
     score 0.71 (cost .62 commute .80 cats .55 …)  status: shortlisted  tags: +bright −short_contract
     ```

   - `--fields full` adds evaluation pros, cons and questions plus the photo and floor-plan URLs.
   - The formatting lives in the backend (`digest/listing.py`, endpoint `/api/digest/listing`), so the UI "copy for agent" button prints the same text.

4. **History digest** (`findhome digest history [--since ...] [--out path]`).
   - The file the agent loads first in every run. Sections:
     - Profile snapshot: the active hard filters and the top weights, one line each.
     - Liked and disliked traits: tag counts from feedback, plus the top three examples by short_id.
     - Pipeline: counts per status, then short_id lists for shortlisted, contacted, viewing and applied.
     - Rejected: short_id + reason tags, the last N.
     - Seen dedupe index: per site, the count and the max `last_seen_at`. The agent can skip anything already known by checking `findhome listings exists <site> <external_id|url>` (fast, returns a yes/no line).
     - Open questions: listings with `pet_status in (ask, unknown)`, awaiting a landlord answer.
   - Target size is about 1.5k tokens at 300 listings. When the history grows past that, the lists collapse into counts plus a pointer.

5. **Commute matrix** (`findhome commute <short_id>... [--provider resrobot] [--budget N] [--dry-run]`).
   - Calls `/api/commute/compute`.
   - `--dry-run` prints the number of provider calls it would make (after the cache and the prefilter) and the estimated cost for paid providers, using the per-element prices in `providers.yaml`. This gives cost visibility before a Google key is ever used.
   - Normal output is one line per point and window: `work-main → arrive 08:00-09:00 (weekday, transit): median 32′ p90 38′ worst 44′ depart ≈07:22 [resrobot, 8 slots, 6 cached]`.
   - Also add `findhome geocode "<address>"` for quick checks.

6. **Site onboarding probe** (`findhome site probe <url> [--slug s] [--browser]`).
   - Without a browser: fetch the URL with httpx and report status, whether the listing content is present in the HTML (heuristic: prices with `kr`, `rok`, `m²`), embedded JSON (`__NEXT_DATA__`, `application/ld+json`, `window.__INITIAL_STATE__`), candidate API URLs found in scripts, `robots.txt` rules for the path, and query parameters on the URL.
   - With `--browser`: run Playwright headless, record the XHR/fetch requests returning JSON while the page loads and scrolls, and list the endpoints with sample keys.
   - Write `sites/<slug>/probe/<timestamp>.md` (the report) and a draft `site.yaml` with `status: unverified` and the recommended `fetch.method` (api > http > playwright > agent_browser). The agent then completes `NAVIGATION.md` (06). The probe uses no LLM.

7. **Run scratchpads and the remaining commands.**
   - `findhome run new <profile>` creates `runs/<ts>-<profile>/` with `scratchpad.md` (sections: Goal, Context loaded, Sites planned, Findings, Decisions, Handover), the history digest and a `run.yaml` manifest.
   - `findhome run close` writes the summary into `agent_runs` through the API.
   - The same layout is used by the app launcher (03), so manual and app-started runs look identical.
   - Also add:
     - `findhome ingest listings|evaluations --file <json> [--source agent_browser|manual]`, the agent's write path for browser-scanned data and evaluations
     - `findhome listings exists <site> <external_id|url>`
     - `findhome scores recompute`
     - `findhome config schema ingest [--markdown]`, which prints the ingest contract (used to generate the skill's `data_contract.md`)
     - `findhome listings list|show|status|feedback`
     - `findhome config validate|show <name>|hash`
     - `findhome db migrate [--check]`
   - Add VS Code tasks `FH: Scan site`, `FH: History Digest` and `FH: Config Validate` (01).

8. **Tests and docs.**
   - CLI tests with Typer's `CliRunner` against a test API (FastAPI `TestClient` + test DB).
   - Golden-file tests for the digest formats, so output size and shape don't drift.
   - A token-size check that asserts the history digest for a 300-listing fixture stays under 8 KB.
   - `findhome --help` text is concise because the skill references it.
   - Commit as `feat(cli): findhome CLI and token-saving tools (init-project 04)`.
