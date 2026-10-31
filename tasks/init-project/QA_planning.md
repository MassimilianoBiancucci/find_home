# QA Planning: find_home — init-project (project setup, skill, tools, app, site registry)

**Objective:** Define the project skeleton for a Stockholm home search (user + 2 cats): project skill and
token-saving scripts, candidate-evaluation app with configurable weighted locations, site registry with
per-site config + navigation docs, general filters guiding site-specific filters, agent prompts, and
container/DB + VS Code launch/tasks setup modelled on the telia_env Debug UI. No listing research yet.
**Started:** 2026-10-31
**Status:** Complete. User confirmed GENERATE THE PLAN on 2026-10-31.
**Target folder (assumed):** `find_home/tasks/init-project/`

---

# Topic (1): Search scope & hard requirements ######################

## Q1:
Are you looking to **rent or buy**, and which contract types are acceptable? This decides which sites go in
the first registry (Blocket Bostad / Qasa / Samtrygg / Bostadsförmedlingen vs. Hemnet / Booli) and which
attributes the app must track (contract end date, deposit, monthly fee vs. price).

## A1:
I think that one will be ascaffold for an application that i will use to search for a rent house, but also will be expanded soon for buy, so max priority to rent functionalities and features but keeping i general to being expanded ina second moment.

## R1:
[Updated after the user edited A1.] Rent-first, **buy-ready**: init is a scaffold for renting, and buying is expected *soon*, so the generic part must be designed now, not merely left "extensible". Domain model: one `listings` table with `listing_kind` (rent | buy) and kind-specific attribute groups (rent: monthly rent, deposit, contract type, contract end, max duration; buy: asking price, avgift, driftkostnad, bid status). Search profile, scoring weights, criteria and lifecycle statuses are keyed per kind; site registry entries declare which kinds they serve. Rent features get all the implementation effort in init; buy only gets schema slots and config keys. Depth confirmed in Q4.

## Q2:
Please give your starting hard limits (rough is fine, they live in a config file and can change): max monthly
budget, minimum size (m²), minimum rooms (you said ≥1 bedroom), target move-in date, and the areas or max
commute time you would accept.

## A2:
max 

## R2:
A2 contains only "max " (unfinished). Values still missing; asked again in the review message.

## Q3:
(Follow-up to Q2, not answered yet.) Do you want to give the starting values for budget, minimum m²,
move-in date and areas now, or should init ship a `search_profile.example.yaml` with placeholders that you fill
in yourself later?

## A3:
I'll give values now. (Selected, but no values were included in the reply.)

## R3:
Values still pending: budget, min m2, min rooms (>=1 bedroom already known), move-in date, areas / max commute. Asked the user to send them as text. Until they arrive, the plan treats them as placeholders in `config/search_profile.yaml` (gitignored real file + committed `.example.yaml`), so this does not block the QA loop.

## Q4:
(Follow-up to your edited A1: buy support comes soon.) How far should init go for buying?

## A4:
Schema and config ready (Recommended).

## R4:
Buy-ready at schema/config level only: `listing_kind`, buy attribute group, per-kind profile/statuses/criteria keys in YAML, `kinds:` field on site entries. No buy sites, buy UI or buy scoring in init. BACKLOG gets a 'buy mode' task.

## Q5:
Swedish listings count rooms as "rum och kök": 2 rok usually means 1 bedroom + living room. Should the hard filter
be `min_rooms: 2` (rok), and does a 1 rok with a sleeping alcove (sovalkov) count as having a bedroom?

## A5:


## R5:

# Topic (2): Pets policy ######################

## Q1:
Listings often say nothing about pets or only "ask landlord". How should the app treat a listing whose pet
policy is **unknown**? (Affects the schema: a `pet_status` field with yes / no / ask / unknown, and a
"pet inquiry" message template in the agent prompts.)

## A1:
Prioritize option 1 (keep, flag 'ask').

## R1:
Unknown pet policy stays in the shortlist with `pet_status` in {yes, no, ask, unknown} and a configurable score penalty (not a hard filter). Agent prompts include a pet-inquiry message drafter (Swedish + English). Explicit `no` is a hard exclude. Open point for later: how much penalty, and whether 2 cats triggers extra checks (e.g. max number of pets).

# Topic (3): Evaluation app stack ######################

## Q1:
Reference setups found: the big Debug UI (Redis, Postgres, pgAdmin, 3 debugpy processes, Angular + Express
BFF) and your smaller "Interactions_analytics" (Postgres + pgAdmin, FastAPI :8100, Express BFF :3100,
Angular :4300, Poetry in-project venv). Which stack should find_home use?

## A1:
Prioritize option 1 (same as IA project).

## R1:
Stack = IA pattern: Angular + Express BFF + FastAPI + Postgres 16 + pgAdmin in Docker Compose, Poetry in-project `.venv`, plain SQL migrations, `.vscode` inside the project with `${workspaceFolder}` paths. Own non-clashing ports (IA uses 5433/5051/8100/3100/4300; Debug UI uses 5432/5050/8000/8080/3000/4200) so all can run side by side. No Redis/GCP/WIF/toolset/Mirage.

## Q2:
You said to exploit the Debug UI setup "in telia_env" for launch.json and tasks.json. Where should the
find_home versions live? (I will not touch anything inside telia_env either way.)

## A2:
find_home/.vscode, own workspace (Recommended).

## R2:
`find_home/.vscode/launch.json` + `tasks.json` with `${workspaceFolder}` paths, find_home opened as workspace root (IA precedent). telia_env is read-only reference: no edits there. Labels prefixed `FH:`. The Debug UI's orchestration pattern (sequence preLaunchTask, background problemMatchers, postDebugTask, free-ports.sh, per-process env examples) is adapted, the Redis/GCP/Mirage parts are dropped.

## Q3:
In the IA project the Express BFF is an axios passthrough. find_home has no auth, no sockets and no AI, so the BFF
would add a process without a job. Keep it for consistency with your other apps, or let Angular call FastAPI directly?

## A3:
Drop it (Recommended).

## R3:
No BFF. Angular calls FastAPI through the `ng serve` proxy (`proxy.conf.json` -> :8200). Processes: Postgres + pgAdmin (compose), FastAPI (debugpy launch config), Angular (background task). Deviation from the IA layout is deliberate; the launch/tasks orchestration pattern stays.
# Topic (4): Distance & commute data ######################

## Q1:
For distance/commute to workplace, Stockholm Central and your girlfriend's place, which data source should
the scoring use? Transit time matters a lot in Stockholm, but free routing is simpler and needs no key.

## A1:
Prioritize option 1 (free routing, pluggable), but also support Google (can pay for an API key later). Wants the real travel time between every point for each apartment AND the reliability of transport on different days and hours.

## R1:
Provider adapter interface with: `haversine` (offline fallback), a free provider (OSM Nominatim geocoding + OSRM/OpenRouteService for walk/bike/drive) and a `google` provider (Routes API, key via env, off by default). Every result is cached in Postgres keyed by (origin, destination, mode, departure-slot, provider) to bound cost. Requirement 'real time between every point' = a matrix per candidate: candidate -> each configured location, plus optionally location <-> location. Requirement 'reliability by day/hour' = query a configurable set of departure slots (weekday peak, off-peak, weekend, evening) and store p50/worst-case plus spread. Caveat to verify in the plan: Google driving can use traffic models (best-guess/pessimistic/optimistic) but transit results are timetable-based and do not give historical delay statistics, so true transit *reliability* needs either sampling over several slots/days or an SL/Trafiklab realtime/GTFS-RT collector. Needs a decision on how deep to go in init (schema + adapter slots now, collector later is the likely answer).

## Q2:
Which departure windows should the commute matrix be computed for, so reliability can be compared? Each
window multiplies the number of routing calls per candidate, so pick the ones that matter to you.

## A2:
Everything should be driven by a YAML (or similar) config so it can change dynamically as needs change. First configuration: must be at the workplace around 8-9; flexible, a farther house means departing earlier. Increase scanning accuracy for the 07:00-09:00 morning peak, but consider ALL hours 07:00-03:00, with different weights for different areas (locations).

## R2:
Time model = YAML-driven, per location: `arrive_by` window (e.g. workplace 08:00-09:00, flexible), a sampling grid over 07:00-03:00 (coarse step outside peaks, fine step e.g. 15 min inside configurable `dense_windows` such as 07:00-09:00), and a per-hour weight curve per location (so workplace weights the morning, girlfriend/central station weight evenings/weekends/late). Departure time becomes an OUTPUT for arrive-by queries (earliest departure that arrives in window), which is what the 'farther house -> leave earlier' requirement needs; Google Routes supports arrival-time for transit, free OSRM/ORS do not model transit at all (to verify in the plan). Weekday vs weekend: not stated, assumed `day_types: [weekday, saturday, sunday]` configurable, default weekday + one weekend slot set. Cost consequence: ~20 hourly slots x locations x modes x candidates is large, so the plan needs (1) two-stage evaluation (haversine prefilter, full matrix only for shortlist), (2) Postgres cache, (3) a per-run `max_routing_calls` budget in YAML, (4) provider-level quotas. Not asked: whether weekend slots matter and per-location weekday/weekend profiles; covered by defaults, confirm in summary.

## Q3:
Inconsistency found: the free routing stack (OSRM / OpenRouteService) has **no public transport**, yet transit to
work and its reliability by hour is your key metric. Until a Google key exists, the free setup would give car/bike/
walk times only. Should init design a free transit provider using Trafiklab ResRobot (Sweden-wide journey planner,
one key; Bronze level 30,000 calls/month and 45/minute per Trafiklab's page; free status and arrive-by support to
verify)?

## A3:
Which one is the best? If I have to pay for ResRobot, doesn't it make more sense to connect Google directly?

## R3:
Comparison (to confirm with the user):
- *Cost:* Trafiklab is a free public service (run by Samtrafiken, the Swedish public-transport data body); to my knowledge keys are free at every level and Bronze (30,000 calls/month, 45/min) is issued immediately. I could not confirm the 'free' wording on Trafiklab's pages today, so it is flagged to verify. Google needs a billing account and card even inside the free cap; at our volumes (see `notes/google_apis_costs_and_key.md`) it would also likely stay inside the monthly free cap, but the transit tier is unverified.
- *Quality for Stockholm transit:* ResRobot uses the official Swedish timetables (including SL), coordinate origins and arrive-by search (HAFAS `searchForArrival`, to verify). Google transit for Stockholm comes from the same kind of timetable feeds, plus better geocoding and walking legs, and traffic-aware driving.
- *Reliability by hour:* neither gives historical delays; both are timetable-based. True reliability needs a realtime collector (Trafiklab realtime / SL GTFS-RT), which is also Trafiklab.
- *Recommendation:* ResRobot as default transit provider (free, no card, official data), Google as optional provider for geocoding cross-check, driving with traffic, and comparison, all behind the same adapter. Realtime reliability collector goes to BACKLOG.

## Q4:
(Follow-up to A3.) Given the comparison in R3, which transit setup?

## A4:
ResRobot default, Google optional (Recommended).

## R4:
Transit provider = Trafiklab ResRobot v2.1 (key in gitignored `config/providers.env`). Google Routes adapter designed, off by default. OSM (Nominatim + OSRM/ORS) for walk/bike/drive and geocoding; haversine for prefilter. Realtime delay collector (Trafiklab realtime / SL GTFS-RT) goes to BACKLOG. To verify during implementation: ResRobot free status, `searchForArrival` and coordinate origins.

## Q5:
(Clarification volunteered by the user with the plan confirmation.)

## A5:
Work and girlfriend are just two special locations; locations must be configurable and expandable, so there can be multiple workplaces and multiple girlfriend places, plus generic points for which I want the reliability of getting from point X to home or vice versa. For each point I must be able to specify in the config the time slots I care about.

## R5:
`locations.yaml` holds a list of points, each with `id`, `category` (free vocabulary defined in the same file: work, partner, transit_hub, generic, ...; categories carry default weight/colour/icon), `label`, `address` or `coords`, `weight`, `notes`, `modes`, and a list of **trips**. A trip has `direction` (`to_point` = home -> point, `from_point` = point -> home, `both`), `day_types`, one or more time windows of type `arrive_by` or `depart_at` with their own weight and sampling step. `time_model.yaml` holds only defaults (global grid 07:00-03:00, dense windows, day-type definitions) that a trip inherits when it does not set its own. The commute matrix is computed per (candidate, point, trip window, mode). Reliability metrics are per trip window: median, worst, spread over the sampled slots, later realtime delays.

# Topic (5): Scoring criteria beyond distance ######################

## Q1:
Besides distance/commute, which candidate attributes should the app extract and score? (Each becomes a field
in the schema, a filter in the general-filters file, and a weight in the scoring config.)

## A1:
(Not answered explicitly. General principle given: all of this must be driven by YAML config, changeable dynamically.)

## R1:
Treated as unanswered for selection. Provisional default: all four categories (cat suitability, building/comfort, contract/availability, neighbourhood) exist in the schema and general-filters file, each toggled and weighted in YAML, so nothing is committed beyond what the user switches on. Price, size, price/m2, rooms always included. Confirmation requested in Topic 6 Q3.

# Topic (6): Site scanning & scheduling ######################

## Q1:
How should an automated scan of a registered site fetch listings? This is the main driver of token cost: the
site config documents the chosen method per site, and scripts do the work without the LLM reading pages.

## A1:
(Not answered explicitly; YAML-driven principle applies.)

## R1:
Provisional default: 'scripts first, browser fallback'. [Superseded by Q3/R3: the agent browser is not only for onboarding and repair, it also scans new houses when scripts or crawler cannot.] Each site config has a `fetch.method` (api | http | playwright | agent_browser) chosen as the cheapest that works.

## Q2:
How should periodic scans be triggered in this first version?

## A2:
(Not answered explicitly; YAML-driven principle applies.)

## R2:
Provisional default: manual first, scheduler-ready. Scan interval lives in each site's YAML (`schedule.interval`), runs/jobs are tables, and CLI + VS Code task trigger scans now; a scheduler (APScheduler in backend or OS cron) is a later add-on. Confirmation requested in Topic 6 Q3.

## Q3:
Your reply said everything should be YAML-driven but did not pick on three points. Do you accept these
provisional defaults: all four criteria categories present and toggled/weighted in YAML; scripts first with
browser fallback for scanning; manual-first scanning with an interval field per site ready for a scheduler?

## A3:
Which four categories? [My omission: I wrote 'all four categories' without naming them. They are in Topic 5 Q1: cat suitability, building and comfort, contract and availability, neighbourhood; price/size/rooms are always on.]
Scanning is script first, with a website crawler if possible; then a skill-guided agent with scripts and computer use scans the new houses, using scratchpads and access to a research history of previous iterations, so already evaluated / eliminated / under-evaluation houses are available immediately, and so the research is guided by the best matches the user reviewed.
For the scheduler: it must be possible to run it manually. The application is a standalone app with open file configurations updated by an agent. The user will use Claude or Codex to schedule the automatic trigger of the agent that starts the update. The GenAI part is OUTSIDE the application, it is part of the skill: the skill integrates the agent with the app, and the app works on the data generated by the agent with the skill. The app also allows changing configurations, generating feedback, guiding the agent's research, and evaluating many aspects of the houses by connecting the scraped data to other services like Google Maps: a map view of the user's points of interest, distance from services like markets, metro, bus stops and many others, on a 3D or 2D map, focused on making the experience effective and the evaluation super fast.

## R3:
MAJOR ARCHITECTURE DECISION. Three separate layers:
1. **App (standalone, no GenAI inside)**: Angular UI + Express BFF + FastAPI + Postgres. Deterministic crawler/scraper scripts run manually from CLI / VS Code task / UI button. Owns data, scoring, map views, config editing, user feedback (ratings, reasons, notes).
2. **Open file configs (YAML/MD)**: search profile, locations, general filters, per-site config + navigation doc, scoring weights. Humans and agents both edit them; the app reloads them (dynamic).
3. **Skill + agent (outside the app)**: project skill drives Claude (or Codex) to (a) scan new listings when scripts/crawler are not enough using browser/computer use, (b) onboard/repair sites, (c) evaluate with scratchpads, (d) read a compact research-history digest so evaluated / rejected / under-evaluation / favourite listings are known instantly and the next search is steered by what the user liked. The agent writes results into the app's data (contract still to decide: API vs file inbox vs CLI). Scheduling = the user's own Claude/Codex scheduled task that launches the agent; the app only needs to be manually runnable and expose a stable 'ingest' contract plus a 'history digest' export.
Implications for the plan: no APScheduler / no LLM calls in the backend; the skill must be agent-agnostic enough for Claude and Codex (shared SKILL.md + AGENTS.md pointer, to verify Codex's skill discovery); add run/scratchpad folders and a `history digest` tool to Topic 7; map + POI layer becomes a first-class UI module (Topics 10-11). Scan order per site: api -> http crawler -> playwright script -> agent browser (computer use).

# Topic (7): Skill and token-saving tools ######################

## Q1:
Which token-saving tools should init build first? Each one is a script the agent calls so it never has to read
raw pages or re-evaluate unchanged listings.

## A1:
Scan/normalize/dedupe, Compact listing digest, Site onboarding probe, Commute matrix CLI with cache (all four).

## R1:
All four tools in init scope. Additions implied by the architecture answer: (5) `history digest` (compact summary of previously seen/evaluated/rejected/favourite listings plus user-liked traits, for the agent to load first each run) and (6) a per-run scratchpad convention (`runs/<timestamp>/scratchpad.md`). Both are cheap scripts, proposed as part of the same tools package; confirm in summary.

# Topic (8): Initial site registry ######################

## Q1:
Should init register stub entries for real sites (config + navigation doc skeleton, no scanning yet), or only
the empty template and the add-a-site workflow?

## A1:
Stubs for 4 main sites (Blocket Bostad, Qasa, Samtrygg, Bostadsförmedlingen).

## R1:
Four stub site entries: `sites/<slug>/site.yaml` + `NAVIGATION.md`, status `unverified`, no scanning or research in init. Each stub states expected fetch method as a hypothesis only. Verification is the first follow-up task after init.

# Topic (9): Agent to app data contract ######################

## Q1:
Since the GenAI part lives in the skill and the app only works on the data the agent produces, how should the
agent hand listings, evaluations and config changes to the app?

## A1:
One free-text reply covering the four questions: start free; go with option one (it gives much more customization), but document option two because it could be interesting. The user is thinking about integrating Google Routes extractions too, which needs an API key, so add notes on the Google solution with possible cost estimations and how to get a key. [Read as: option 1 for this question too.]

## R1:
CLI + REST API. A small `findhome` CLI (ingest, digest, scan, commute, onboard-probe) calls the FastAPI backend, which validates against the schema (pydantic). YAML/MD configs are plain files the agent edits directly; the backend watches/reloads them. File inbox kept as a documented offline fallback only if the backend is down. No direct DB writes by agents.

## Q2:
Where will the scheduled agent run, and should the app be able to start one? A cloud-run agent (Claude scheduled
task in the cloud, Codex cloud) cannot reach `localhost`, so the CLI-to-API contract only works if the agent runs on
your Mac with the app up.

## A2:
Local, plus app button (Recommended).

## R2:
Agents run locally (Claude Code or Codex CLI on the Mac) with the app up; `findhome` CLI talks to the local API. UI gets a 'Run agent' action that launches a configurable headless command from `config/agent.yaml` (e.g. `claude -p ...` / `codex exec ...`) as a subprocess, streams its log to a Runs page, and records the run. The app still has no LLM code: it only spawns an external command. Cloud runs and file-sync inbox are out of scope.
# Topic (10): Map, 3D view and points of interest ######################

## Q1:
Which map technology should the UI use for the points-of-interest, candidates and 2D/3D view?

## A1:
One free-text reply covering the four questions: start free; go with option one (it gives much more customization), but document option two because it could be interesting. The user is thinking about integrating Google Routes extractions too, which needs an API key, so add notes on the Google solution with possible cost estimations and how to get a key. [Read as: option 1 (MapLibre + OSM); Google (option 2) documented and evaluated.]

## R1:
MapLibre GL JS + OSM vector tiles (2D, tilt, 3D building extrusion), behind a map-provider switch so Google Maps JS / Google 3D tiles can be added. A cost and key note was written: `notes/google_apis_costs_and_key.md` (third-party figures, to verify). Maps JS dynamic maps reported at $7/1000 loads after 10k free per month; a personal single-user app stays inside the free cap, so cost risk is routing, not the map.

## Q2:
Where should the nearby-services data (markets, metro, bus stops, parks, vets, and so on) come from?

## A2:
One free-text reply covering the four questions: start free; go with option one (it gives much more customization), but document option two because it could be interesting. The user is thinking about integrating Google Routes extractions too, which needs an API key, so add notes on the Google solution with possible cost estimations and how to get a key. [Read as: option 1 (OSM Overpass first, Google Places later).]

## R2:
OSM Overpass for stops, groceries, parks, vets etc., results cached per (candidate, category, radius). POI categories, radius and weights are YAML. Google Places switchable per category once a key exists (Place Details Pro $17/1000, Text Search Pro $32/1000 in the sources, to verify). Trafiklab left out of init; transit stop data from OSM.

# Topic (11): Agent runtime and portability ######################

## Q1:
Which agents must the skill and prompts work with? This decides the folder layout and whether the skill stays a
single source of truth with thin per-agent entry files.

## A1:
One free-text reply covering the four questions: start free; go with option one (it gives much more customization), but document option two because it could be interesting. The user is thinking about integrating Google Routes extractions too, which needs an API key, so add notes on the Google solution with possible cost estimations and how to get a key. [Read as: option 1 (Claude and Codex, one source).]

## R1:
[Corrected in review with the Codex docs.] Codex discovers repo skills in `.agents/skills/` (scanned from CWD up to repo root), follows symlinks, and uses the same SKILL.md format (`name`, `description`, optional `scripts/`, `references/`, `assets/`, `agents/openai.yaml`) from the open Agent Skills standard. Claude Code reads `.claude/skills/`. Layout: canonical `.agents/skills/find-home/` and a symlink `.claude/skills/find-home -> ../../.agents/skills/find-home` (Claude Code symlink handling to be verified in implementation; fallback is a sync script). Thin `CLAUDE.md` and `AGENTS.md` at repo root point to the skill; no duplicated prompt text. Prompts stay plain markdown so any agent can use them.
# Topic (12): Depth of the init task ######################

## Q1:
How much should the init-project task actually build, once the plan is executed?

## A1:
Walking skeleton that runs (Recommended).

## R1:
Init delivers a running skeleton: `docker compose up` (Postgres + pgAdmin, healthchecks, preloaded pgAdmin server), F5 compound starts backend + BFF (+ ng serve via task), SQL migration creates the base schema, `/health` endpoint, empty Angular shell with sidebar and placeholder pages (Candidates, Map, Locations, Sites, Runs, Settings), `findhome` CLI with working stubs, config loader reading the YAML files, skill + prompts + 4 site stubs. Real features (routing, scanning, scoring, map data) are later tasks, though the config schemas and DB tables are designed for them now.

# Topic (13): Candidate lifecycle and feedback ######################

## Q1:
How should the app track a listing through your decision process, and how should your feedback steer the
agent's next search?

## A1:
Pipeline + reason tags (Recommended).

## R1:
Statuses: new, shortlisted, contacted, viewing, applied, rejected, archived. Likes and rejections carry reason tags from a YAML-defined vocabulary (too_far, no_pets, noisy, too_small, over_budget, bad_layout, ...) plus free note. `findhome digest` aggregates them into liked/disliked traits and lists previously seen/rejected/in-progress listings by short id, so each agent run starts from history instead of re-evaluating.

# Topic (14): Plan output mode ######################

## Q1:
This task has several independent work streams (infrastructure and VS Code setup, data model and configs, skill
and tools, backend, UI, site registry). Should the plan be one `plan.md` or a master plan plus sub-plans?

## A1:
Advanced: master + sub-plans (Recommended).

## R1:
Output mode = advanced: `master_plan.md` + `plans/subplan_NN_<name>.md`, written into `find_home/tasks/init-project/`.


# Topic (15): Guide bootstrap ######################

## Q1:
(Request volunteered by the user with the plan confirmation.)

## A1:
Use the /guide skill to start a guide after the base project is created.

## R1:
Last sub-plan of init: install the guide skill into find_home and bootstrap `guide/` following its `references/bootstrap.md` once the skeleton runs. Source check: the newest `SKILL.md` is `telia_env/SKILLs/guide/` (2026-10-29 23:56) but that copy lacks `references/bootstrap.md` and `scripts/check_links.py`; those exist only in `telia_env/.github/skills/guide/` (older SKILL.md, 23:27). Install = newest SKILL.md + bootstrap.md + skeleton.md + check_links.py into `.agents/skills/guide/` with a `.claude/skills/guide` symlink. Principles are proposed to the user, never invented.

# Review (pass 1) ######################

Requested by the user after the first summary: check for unclear points, inconsistencies and setup improvements.

**Inconsistencies found and fixed in this file**
- T1/A1 was edited by the user (buy support comes soon). R1 said buy was out of scope; R1 now says rent-first, buy-ready. Depth asked in T1/Q4.
- T1/A2 is unfinished ("max "): starting values still missing.
- T6/R1 said the agent browser is only for onboarding and repair; T6/R3 (the user's answer) also has the agent scan new houses. R1 marked superseded.
- T11/R1 put the canonical skill in `.claude/skills/`, which Codex does not scan. Codex uses `.agents/skills/` and follows symlinks: canonical folder moved there, Claude gets a symlink.
- T4: "free routing first" contradicts "transit reliability is key", because OSRM/ORS have no transit. Asked in T4/Q3.
- T9: the CLI-to-REST-API contract requires a running local backend, and T6/R3 says scheduling is done by Claude/Codex. That breaks if the scheduled agent runs in the cloud. Asked in T9/Q2.
- T9/A1, T10/A1-A2 and T11/A1 hold one shared free-text reply; the bracketed "Read as" notes record my interpretation (option 1 everywhere, Google documented).

**Improvements adopted by default (say if you disagree)**
- *One config vocabulary.* The summary had overlapping "search profile", "general filters" and "scoring weights". Proposed split: `config/profile.yaml` (per listing kind: `hard_filters` that gate, `preferences` with weights), `config/filters_catalog.yaml` (canonical filter keys and types, which each `sites/<slug>/site.yaml` maps to its own URL params or UI steps, or marks `local_only`), `config/locations.yaml`, `config/poi.yaml`, `config/time_model.yaml`, `config/tags.yaml`. Each one validated by a JSON Schema the app, the CLI and the agent all use.
- *Config edits from UI and agent.* Both write YAML; the UI writes with a comment-preserving library (ruamel.yaml) and validates before saving. Every score stores the config hash it was computed with, so results stay reproducible and stale scores are visible.
- *Git as config history.* Instead of gitignoring the whole personal config, the repo stays local/private and commits configs, so changes made by the agent are reviewable diffs. Only secrets (`config/*.env`, API keys) are gitignored. (Changes the earlier "personal configs gitignored" assumption; included in the git question.)
- *Cross-site dedupe.* The same flat often appears on several sites: dedupe key = normalized address + floor + m2 + rent band, with one canonical listing and many `listing_sources`.
- *Images.* Store photo and floor-plan URLs (thumbnails cached); the agent looks at floor plans only for shortlisted listings, since images are the most token-expensive input.
- *Scraping hygiene.* Per-site `politeness` (delay, max pages) and `auth` (none | browser_session) fields; login-walled sites (BankID) are scanned only by the agent in your own logged-in Chrome, never with stored credentials. Respect each site's terms.
- *Tasks folder.* Besides `tasks/init-project/`, init adds `tasks/README.md` (task folder convention: QA, notes, plan, status) and `tasks/BACKLOG.md` with the follow-ups (verify 4 sites, routing providers, scoring, map + POI, buy mode, notifications).
- *Smoke tests.* The walking skeleton includes pytest + one API smoke test and a `FH: Smoke check` VS Code task (compose healthy, migration applied, `/health` OK, CLI `--help`).
- *Notifications.* Not discussed. Left to the scheduled agent (it can report new top matches in its run summary); nothing in the app for init.

# Summary ######################

**Goal.** A Stockholm home-search project for the user and 2 cats: rent first (any contract, at least 1 bedroom), buy coming soon. It has three parts: a standalone evaluation app, open YAML/MD configs, and a skill that drives an outside agent (Claude Code or Codex). Init builds a **walking skeleton that runs**. No listing research yet.

**Architecture.**
1. *App, no GenAI inside:* Angular -> FastAPI (no BFF, `ng serve` proxy) -> Postgres 16, plus pgAdmin in Docker Compose. Poetry in-project `.venv`, plain SQL migrations. It runs deterministic crawlers manually (CLI, VS Code task, UI button) and holds the data, scoring, map views, config editing, feedback, and a "Run agent" button. That button spawns a configurable headless command (`claude -p` / `codex exec`) and logs the run.
2. *Open configs, schema-validated, committed in a local/private git repo:* `profile.yaml` (per listing kind: hard_filters + weighted preferences), `filters_catalog.yaml`, `locations.yaml`, `time_model.yaml`, `poi.yaml`, `tags.yaml`, `agent.yaml`, plus `sites/<slug>/site.yaml` + `NAVIGATION.md`. The UI saves with comments preserved. Every score stores its config hash. Only secrets (`config/*.env`) are gitignored.
3. *Skill + agent, local only:* canonical `.agents/skills/find-home/` (SKILL.md, prompts, references, scripts), with a `.claude/skills/find-home` symlink and thin `AGENTS.md` / `CLAUDE.md`. The agent reads the history digest first. It scans with browser or computer use only what the scripts cannot, onboards and repairs sites, evaluates using per-run scratchpads, and writes results through the `findhome` CLI to the local REST API. Scheduling is the user's own local Claude/Codex schedule.

**Listings.** One model with `listing_kind` rent|buy. Rent fields are implemented; buy fields exist as schema/config slots only. Cross-site dedupe keeps one canonical listing with many sources. Photo and floor-plan URLs are stored, and the agent looks at floor plans only for shortlisted listings. Lifecycle: new, shortlisted, contacted, viewing, applied, rejected, archived. Like/reject reason tags feed the digest's liked/disliked traits.

**Criteria.** Always on: rent, m2, price/m2, rooms (Swedish rok; mapping pending). Toggled and weighted in YAML: cat suitability, building/comfort, contract/availability, neighbourhood. `pet_status` is yes/no/ask/unknown: `no` excludes, ask/unknown gets a configurable penalty plus a pet-inquiry drafter (sv/en).

**Commute.** `locations.yaml` is an open list of points with user-defined categories (several workplaces, several partner places, transit hubs, generic points). Each point has weight, notes, modes and its own **trips**: direction (to point, from point, both), day types, and `arrive_by` / `depart_at` windows with their own weights and sampling steps. `time_model.yaml` only holds defaults (07:00-03:00 grid, denser 07:00-09:00). Providers sit behind one adapter: haversine prefilter, OSM for walk/bike/drive and geocoding, **ResRobot for transit (default)**, Google Routes optional (off). Evaluation is two-stage, results are cached in Postgres, and each run has a `max_routing_calls` budget. Reliability is reported per trip window (median, worst, spread); a realtime delay collector is in the backlog. Google cost notes: `notes/google_apis_costs_and_key.md`.

**Map and services.** MapLibre GL + OSM (2D, tilt, 3D extrusions) behind a provider switch. POIs (groceries, metro/bus, parks, vets, ...) come from OSM Overpass, with YAML categories and radii, cached. Google Maps JS and Places are documented as an option.

**Sites.** Unverified stubs for Blocket Bostad, Qasa, Samtrygg, Bostadsförmedlingen (rent). Each site has a fetch order (api -> http crawler -> playwright -> agent browser), a mapping from the filter catalog (unsupported filters marked `local_only`), politeness and auth fields, and an interval field. Scans are triggered manually. Login-walled sites are handled only via the agent in the user's own Chrome session.

**Tools (init: working stubs at least).** scan+normalize+dedupe, compact listing digest, site onboarding probe, commute matrix with cache, history digest, run scratchpad convention.

**VS Code and repo.** `find_home/.vscode/launch.json` + `tasks.json` with `FH:` labels and `${workspaceFolder}` paths. A sequence preLaunchTask runs free ports -> compose up -> migrate -> ng serve, uses background problemMatchers, and a postDebugTask stops the stack. Also a smoke-check task. Ports: Postgres 5434, pgAdmin 5052, FastAPI 8200, Angular 4400. telia_env stays untouched. `tasks/README.md` + `tasks/BACKLOG.md`.

**Guide.** After the skeleton runs, the guide skill is installed in the project and `guide/` is bootstrapped (overview, architecture introduction, proposed principles and issues for user confirmation, link check).

**Plan format.** Advanced: `master_plan.md` + `plans/subplan_NN_*.md` in `find_home/tasks/init-project/`.

**To verify during implementation.** ResRobot free status and arrive-by support, Google transit tier/pricing, Claude Code symlinked-skill discovery. **Pending from the user:** starting values (budget, min m2, move-in date, areas/max commute) and whether a 1 rok with sovalkov counts. Until then the values are placeholders in `profile.yaml`.
