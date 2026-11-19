# Architecture: jobs

A **job** is a named, reusable analysis over a chosen subset of listings. The Jobs page lists one row per job;
each time a job runs it creates an **execution** with one reviewable result per listing (before, after, the quoted
evidence, the outcome) that can be undone. Types register in
[`jobs/registry.py`](../../backend/src/findhome/jobs/registry.py) and get a seeded `jobs` row.

| Job | Kind | What it does |
|---|---|---|
| `pet_keywords` | in-app | re-runs the pet wording rules ([config_and_locations.md](pets.md)) on the subset, e.g. after `config/pet_rules.yaml` changed; never above the agent, the site or you, never resolves a conflict |
| `pet_agent_check` | agent | the agent opens each listing in your Chrome, finds the exact pet sentence and records yes / no / ask with the quote (unknown when the page says nothing); results apply at once |
| `listing_details` | agent | browser sites: the agent opens each listing's own page; the site's `detail_extract.js` hands the page's data to the app, and the agent adds only what is still missing from the free text, each value with its quote (below) |
| `listing_details_script` | in-app | scripted sites (Bostadsförmedlingen): reads each listing's page again with the scanner's `enrich`, in the background, 3 s apart, no tokens |
| `listing_status` | agent | browser sites: the agent opens each listing's page; the site's `status_check.js` hands the app the ad status (open, let, removed, not found) with its evidence and the current price ([below](#ad-status)) |
| `listing_status_script` | in-app | scripted sites (Bostadsförmedlingen): reads the page of each listing whose applications closed, to tell a let flat from a removed ad (`ad_status` rules in `site.yaml`), no tokens |

## Tables

| Table | Holds |
|---|---|
| `jobs` | `key`, `type`, `label`, `settings` (`subset`, `n` per execution, `launcher`, `model`, `chain_after_scan`, `chain_after_details`), `enabled`; seeded by [`013_jobs.sql`](../../backend/migrations/013_jobs.sql), [`017_listing_details_job.sql`](../../backend/migrations/017_listing_details_job.sql) and [`018_ad_status.sql`](../../backend/migrations/018_ad_status.sql) |
| `job_runs` | one execution: `status` running / ok / partial / error / cancelled, the frozen `settings`, `counts` by outcome, `agent_run_id` |
| `job_items` | one listing of one execution: `state` queued / leased / done / undone / skipped, `before`, `after`, `evidence`, `page_url`, `outcome` changed / unchanged / conflict / skipped / error / gone / unread / translated, `note`, `usage` (the tokens the agent spent on it) |

## The subset

One filter for every job type ([`subset_sql()`](../../backend/src/findhome/jobs/subset.py)): `sites`,
`origin_sites`, `pet_status`, `pet_source`, `status` (default: not rejected or archived), `new_since`,
`passes_hard_filters`, `short_ids`, `exclude_checked_within_days` (uses `listings.pet_checked_at`, so a listing
the agent or you checked recently is skipped), `missing_fields` (no move-in, no photos, no description, no street
number, or a page never read), `exclude_details_checked_within_days` (`attributes.details_checked_at`), `agent_run`
(the listings a browser scan run saw), `ad_status_in` (a source, on the chosen `sites`, in one of these ad statuses),
`not_seen_since_last_scan` (a source the site's last completed scan did not list) and `order` (`score_desc`, `newest`, `oldest`). The first `n`
matches are frozen into `job_items` when the execution starts ([`create_run()`](../../backend/src/findhome/jobs/service.py#L88));
`POST /api/jobs/{key}/preview` counts the matches before you start.

## An agent execution

```mermaid
sequenceDiagram
  participant UI as Job page
  participant API as /api/jobs
  participant L as launcher
  participant AG as Agent (Claude in Chrome)
  UI->>API: POST /api/jobs/pet_agent_check/run {settings, launcher}
  API->>API: job_run running, subset frozen into ≤ n job_items
  API->>L: start(pet_agent_check, {job_run, n}, cli | vscode)
  loop until nothing is left
    AG->>API: findhome jobs next <job_run> (10 min lease)
    API-->>AG: short id, URL, current pet status
    AG->>AG: open the page, find the pet sentence
    AG->>API: findhome jobs submit <job_run> <id> --pet ask --evidence "…"
    API->>API: set_pet(source agent), job_item before/after/outcome
  end
  AG->>API: findhome run close --outcome ok|partial|failed
```

| Step | Code |
|---|---|
| Start, launch the agent | [`POST /api/jobs/{key}/run`](../../backend/src/findhome/api/routers/jobs.py) |
| Next listing, with a lease | [`next_item()`](../../backend/src/findhome/jobs/service.py#L196) |
| Record the answer through the pet precedence | [`submit()`](../../backend/src/findhome/jobs/service.py#L241), [`set_pet()`](../../backend/src/findhome/db/repo.py) |
| Close executions whose agent ended early | [`finalize_agent_runs()`](../../backend/src/findhome/jobs/service.py#L146) |
| Undo one item | [`undo()`](../../backend/src/findhome/jobs/service.py#L279) |
| Prompt and profile | [`pet_agent_check.md`](../../.agents/skills/find-home/prompts/pet_agent_check.md), `pet_agent_check` in `config/agent.yaml` |

`submit` requires a quote for yes, no and ask. An answer that ranks below the listing's current source (your own
answer) is recorded as `unchanged` with a note. Undo puts back the `before` value only when nobody changed the
listing's pet status since the job; otherwise it is refused and the listing is changed on its own page.

The execution ends when `jobs next` finds nothing left (`ok`), when you cancel it (which also stops its agent run's
process, exactly as the run drawer's Cancel does, and refuses that run's later `jobs next` and `jobs submit` with
409), or when its agent run ends
first (`partial` with listings left, `error` when the agent failed). The agent run appears on the Runs page with
the job run nested under it.

## The details jobs

A browser site's listing page is read by its `sites/<site>/detail_extract.js`, which the agent runs on the open page
with `window.FH_POST = {api, site, run, job_run}`. The script posts its result to `POST /api/inbox/raw` (kind
`detail`; only from the site's own origin and for an open agent run, see
[agent_contract.md](agent_contract.md#file-inbox-agents-without-api-access)), so the page's data never passes
through the agent's context. [`raw_detail()`](../../backend/src/findhome/jobs/details.py#L170) maps it with the site's
`detail_to_listing`, writes only the values the page had (a missing value never overwrites a stored one), merges
`attributes`, sets `details_checked_at`, and records the item: `changed` / `unchanged` with before and after,
`gone` (the ad is gone), `unread` (the page state could not be read) or `translated` (the run stops). The answer to
the agent names the fields still missing. For those, the agent reads the page's free text and sends each value with its
quote (`findhome jobs submit <job_run> <id> --fields-file f.json`,
[`submit_details()`](../../backend/src/findhome/jobs/details.py#L226)): move-in and contract dates, contract terms,
deposit, max tenants, other costs, floor, furnishing, sleeping alcove, pets (through the pet precedence, source
agent). A value without a quote is refused. `--gone` records a missing ad; `findhome jobs post-detail` posts a page's
data from the CLI when the page could not post (Chrome's local network access, the app down). A Qasa page read also
sets the source's ad status (`ad_status_of()` in its `scanner.py`: `Home.status`, or no Home object). Undo
([`undo_details()`](../../backend/src/findhome/jobs/details.py#L270)) puts back the fields an item changed, only while
the listing still holds the values it wrote.

**The chain.** When a `browser_scan` run's process ends `ok` or `partial`, the launcher starts `listing_details` on
the passing listings that run saw (`chain_after_scan`, on by default;
[`chain_after_run()`](../../backend/src/findhome/jobs/details.py#L352)): one agent uses your Chrome at a time, and a
details run already open covers it later. Nothing starts when no listing matches.

**Scripted sites.** `listing_details_script` runs in the API process in the background
([`run_details_script()`](../../backend/src/findhome/jobs/details.py#L304)): each item's page is read by the site's
scanner, the run closes `ok` when every item is done, and the touched listings are scored.

## Ad status

Every source (`listing_sources`) has an `ad_status`: `open` (you can apply), `unknown` (never checked),
`applications_closed` (page still there, applications over), `rented`, `removed` or `not_found`, with
`status_checked_at` and `status_evidence` (`{rule, value, http, url_final, …}`); every change is a row of
`source_status_events` (`from_status`, `to_status`, `evidence`, `actor` scan / job / user), written only when the
status changes ([`_bulk_ad_status()`](../../backend/src/findhome/db/repo.py#L224)). Nothing is deleted. A listing is
**open** while any of its sources is open or unknown, computed per request
([`AD_OPEN_SQL`](../../backend/src/findhome/db/repo.py#L220)), so a flat let on one site but open on another stays.
`GET /api/listings` hides closed listings by default (`closed=exclude | include | only`); Candidates has a "Hide
closed" toggle and a status pill on closed rows, the listing page a pill per source (evidence and check time on
hover) and the status history. Your own workflow status (`listing_status_events`: shortlisted, rejected …) is a
different thing.

```mermaid
stateDiagram-v2
  [*] --> unknown: imported, never checked
  unknown --> open: listed by a scan / status check
  open --> applications_closed: missing from a complete feed
  applications_closed --> rented: page "Bostaden är förmedlad"
  applications_closed --> removed: redirect to "annonsen är inte längre tillgänglig"
  open --> rented: Samtrygg 410 + "Uthyrd"
  open --> removed: Qasa archived, Samtrygg 410
  open --> not_found: Qasa no Home object, 404
  applications_closed --> open: back in the feed
  rented --> open: listed again by a scan
```

How each status is set, cheapest first:
- **Scans, free** ([`feed_status()`](../../backend/src/findhome/scanning/runner.py#L250)): every source a scan lists is
  `open`. A site whose scanner reads the whole region in one response (Bostadsförmedlingen: `scanner.feed_ids`) and
  whose `site.yaml` sets `ad_status.feed_complete_min` closes its open or unknown sources missing from a complete
  feed (`feed_missing_status`, `applications_closed`); a feed with errors or fewer ads than the minimum closes
  nothing. Browser scans: every source on an imported result page is `open` ([`inbox.py`](../../backend/src/findhome/inbox.py)).
- **`listing_status` (agent)**: the default subset is the passing listings on Samtrygg and Qasa that are open or
  unknown and that the site's last scan did not list. The agent runs `sites/<site>/status_check.js` with `FH_POST`;
  the script posts `{status, evidence, price?}` to `POST /api/inbox/raw` (kind `status`) and
  [`apply_status()`](../../backend/src/findhome/jobs/status.py#L40) sets the status (an `unknown` result never
  overwrites a known one, outcome `unread`), re-reads the rent of an open ad (re-scored when it changed) and records
  the item (`ad_status.<site>` and `rent_sek` in before / after). `findhome jobs post-detail --kind status` is the
  fallback. Undo ([`undo_status()`](../../backend/src/findhome/jobs/status.py#L86)) puts back the status and rent
  while the source still has what the item set. The rules per site are in the scripts' headers (Samtrygg: HTTP 410
  + badge, 404, JSON-LD availability; Qasa: no Home object, `Home.status`, the overlay text; robots meta is no
  signal).
- **`listing_status_script` (in-app)**: [`page_status()`](../../backend/src/findhome/jobs/status.py#L115) applies the
  site's `ad_status` rules (`removed_url`, `box_selector` + `box` prefixes, a deadline in the past) to the listing
  page, following redirects, 3 s apart.
- **The chain**: when a `listing_details` run ends `ok` or `partial`, the launcher starts `listing_status` on the same
  sites (`chain_after_details`, on by default; [`chain_status()`](../../backend/src/findhome/jobs/status.py#L183)).
  Scan → details → status, one agent in your Chrome at a time.

## Where the code lives

| Concern | File |
|---|---|
| Types | [`jobs/registry.py`](../../backend/src/findhome/jobs/registry.py) |
| Subset filter | [`jobs/subset.py`](../../backend/src/findhome/jobs/subset.py) |
| Executions, agent protocol, undo | [`jobs/service.py`](../../backend/src/findhome/jobs/service.py) |
| Details jobs: page posts, free-text values, undo, the chain | [`jobs/details.py`](../../backend/src/findhome/jobs/details.py) |
| Status jobs: page posts, the page rules, undo, the chain | [`jobs/status.py`](../../backend/src/findhome/jobs/status.py) |
| Ad status storage and the open rule | [`db/repo.py`](../../backend/src/findhome/db/repo.py) (`set_ad_status`, `mark_seen_open`, `close_missing`) |
| API | [`api/routers/jobs.py`](../../backend/src/findhome/api/routers/jobs.py) |
| CLI | `findhome jobs list|next|submit` in [`cli/main.py`](../../backend/src/findhome/cli/main.py) |
| Tests | [`tests/db/test_jobs.py`](../../backend/tests/db/test_jobs.py) |
