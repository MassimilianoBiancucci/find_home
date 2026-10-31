## Plan: find-home skill and agent prompts

All GenAI work lives here, outside the app. A single skill folder is the source of truth for both Claude Code and Codex. According to Codex's docs, Codex discovers `.agents/skills/` and follows symlinks; Claude Code reads `.claude/skills/`. The skill teaches the agent the run protocol:

1. load the history digest;
2. plan with a scratchpad;
3. let scripts do the cheap work;
4. browse only what scripts can't do;
5. write everything back through the `findhome` CLI;
6. hand over a short summary.

Prompts are plain Markdown files, so the "Run agent" button (`config/agent.yaml`), a scheduled task you set up yourself, or a manual chat can all start the same procedures.

### Layout

```
.agents/skills/find-home/
  SKILL.md
  prompts/
    run_scan.md            # scheduled/manual "find new candidates" run
    run_evaluate.md        # evaluate new/changed listings, fill evaluations
    site_onboarding.md     # add a site: probe -> site.yaml -> NAVIGATION.md -> dry run
    site_repair.md         # fix a broken site config
    browser_scan.md        # scan a site that needs the agent browser (login/JS-heavy)
    pet_inquiry.md         # draft landlord message (sv + en) for pet_status ask/unknown
    research_guidance.md   # turn feedback/liked traits into search adjustments (proposes config diffs)
  references/
    data_contract.md       # ListingIn / EvaluationIn fields, pet_status rules, examples
    cli_cheatsheet.md      # every findhome command with one-line purpose and output shape
    token_rules.md         # what to never load, digest-first rule, budgets
    config_guide.md        # which YAML file controls what; validate-after-edit rule
  scripts/
    preflight.sh           # backend up? config valid? prints history digest path
.claude/skills/find-home -> ../../.agents/skills/find-home   (symlink, via scripts/sync-skills.sh)
AGENTS.md, CLAUDE.md       # thin pointers
```

### Steps

1. **Write `SKILL.md`.**
   - Frontmatter:
     - `name: find-home`
     - `description`: "Use for the find_home project: scanning Stockholm rental sites, evaluating listings for a tenant with two cats, onboarding or repairing a listing site, drafting pet inquiries, or turning user feedback into search adjustments. Not for app code changes; use the guide for that."
   - The body is short, about 150 lines:
     - the three-layer architecture in five lines;
     - the run protocol above as numbered steps;
     - when to use each prompt file;
     - hard rules.
   - Hard rules:
     - Never write to the database or app files except through `findhome` and the YAML configs.
     - Always run `findhome config validate` after editing YAML.
     - Never store credentials.
     - Use the user's logged-in browser session only for `auth: browser_session` sites.
     - Respect each site's `politeness` settings.
     - Never re-evaluate a listing the digest marks unchanged.
     - Keep raw page text out of the conversation and save it to the run folder.
   - Link to the `references/` files for detail (progressive disclosure).

2. **Write the run prompts.**
   - `run_scan.md`:
     1. Run `scripts/preflight.sh`.
     2. Read `$FINDHOME_RUN_DIR/context/history_digest.md`.
     3. Run `findhome scan --all` for sites with `status: active`.
     4. For sites with `fetch.method: agent_browser`, follow `browser_scan.md`.
     5. For new or changed listings, run `findhome commute <ids> --dry-run`, then compute within the budget.
     6. Run `findhome scores recompute`.
     7. Write the Findings and Handover sections of the scratchpad.
     8. Run `findhome run close`.
   - `run_evaluate.md`: take listings in status `new` without an evaluation and load `findhome digest listing --fields full` for at most N per run (budget in the prompt header). Look at floor plans only for listings above a score threshold. Post evaluations with pros, cons, questions for the landlord and extracted attributes (balcony safety, sovalkov, floor). Update `pet_status` only with quoted evidence.
   - Each prompt starts with a header block (`inputs`, `budget`, `outputs`, `stop conditions`) so scheduled runs end predictably.

3. **Write the site prompts.**
   - `site_onboarding.md`: run `findhome site probe` (and `--browser` if the HTML is empty). Pick the cheapest working method. Fill `site.yaml` (`filter_map` against `filters_catalog.yaml`, `field_map`, `selectors` or API path). Write `NAVIGATION.md` section by section, using the browser to confirm filter steps and the pet wording. Run `findhome scan <slug> --dry-run --max-pages 1`. Set `status: active` only when parsing succeeds, then record the probe and the run id.
   - `site_repair.md`: compare the latest probe with the stored config, change the minimum needed, and re-run the dry run.
   - `browser_scan.md`: tells the agent which browser to use: Claude in Chrome or the built-in browser in Cowork/Claude, or Playwright via a script in Codex. It sets the per-page read rule (extract the listing cards via page text or `find`, never full screenshots unless the layout matters) and says to post through `findhome ingest` with `--source agent_browser`.

4. **Write the guidance prompts.**
   - `pet_inquiry.md` drafts a short, polite message in Swedish with an English copy. It introduces two indoor cats (spayed or neutered, vaccinated, insured: fill in or confirm with the user), offers a deposit or references, and asks clearly whether two cats are accepted. Output goes into the evaluation's `questions_for_landlord`. It is never sent automatically.
   - `research_guidance.md` reads liked and disliked traits from the history digest and proposes concrete config changes as a diff (weights, areas, POI radius, new generic points). It writes them to the run folder as `proposed_config.patch.yaml` for the user to approve in the UI or the chat, and never applies weight changes on its own.

5. **Wire up both agents.**
   - `scripts/sync-skills.sh` (01) creates `.claude/skills/find-home` → `.agents/skills/find-home`.
   - `AGENTS.md` and `CLAUDE.md`, about 20 lines each, give the project purpose in two lines, point to the skill for search work and to `guide/overview.md` for code work (added in 08), and list the setup commands (`scripts/install.sh`, F5 `FH: Full Stack` or `findhome serve`).
   - Verify that Claude Code lists the skill through the symlink. If it doesn't, switch `sync-skills.sh` to `--copy` mode, add a check to `scripts/smoke-check.sh` that warns when the copies differ, and log this in `guide/issues/issues.md`.
   - Verify that Codex lists the skill from `.agents/skills/`.

6. **Write the references** from the code built in 03/04: `data_contract.md` is generated from the pydantic models (`findhome config schema ingest --markdown`, a small helper) so it can't drift. `cli_cheatsheet.md` is generated from `findhome --help`. `token_rules.md` lists budgets: max listings per evaluate run, max floor-plan views, max browser pages per site.

7. **Test the skill without real sites.**
   - Seed the DB from a fixture file with `findhome ingest --file tests/fixtures/listings_sample.json`.
   - Run `run_evaluate.md` manually with Claude Code against those fake listings, and check that it reads the digest first, stays within budget, posts evaluations and writes a scratchpad.
   - Check that `pet_inquiry.md` produces a draft for an `ask` listing.
   - Record the outcome in the init task's `STATUS.md`.
   - Commit as `feat(skill): find-home skill, prompts, agent wiring (init-project 06)`.
