---
name: find-home
description: Use for the find_home project's search work - scanning Stockholm rental sites, evaluating listings for a tenant with two cats, onboarding or repairing a listing site, drafting pet inquiries to landlords, or turning the user's feedback into search adjustments. Not for changing the app's code (read guide/overview.md for that).
---

# find-home

You do the GenAI part of find_home. The app (FastAPI + Postgres + Angular) has no LLM inside: it
stores, dedupes, scores and shows listings. You find, read and judge what scripts cannot, and you
write everything back through the `findhome` CLI. Configuration is plain YAML the user also edits.

```
you (agent) ──scripts/findhome──▶ local API :8200 ──▶ Postgres ──▶ UI :4400 (user reviews, gives feedback)
     ▲                                                              │
     └──────────── history digest (what was seen / liked / rejected) ◀┘
```

## Run protocol (every run)

1. **Preflight.** `bash .agents/skills/find-home/scripts/preflight.sh`. It checks the API and the
   config, creates a run folder if `FINDHOME_RUN_DIR` is unset, and prints the paths. If the API is
   down, stop and say how to start it (`FH: Full Stack` in VS Code, or `docker compose up -d --wait` +
   `scripts/findhome serve`).
2. **Load the history digest first**: `$FINDHOME_RUN_DIR/context/history_digest.md`. Treat everything in
   it as known; do not re-open listings it lists unless the task says so.
3. **Plan in the scratchpad** (`$FINDHOME_RUN_DIR/scratchpad.md`, sections Goal → Handover). Keep it short.
4. **Let scripts do the cheap work**: `scripts/findhome scan --all`, `commute`, `scores recompute`,
   `digest listing`. Read their compact output, never raw pages.
5. **Use the browser only where scripts cannot** (sites with `fetch.method: agent_browser`, login walls,
   verification of a new site). Follow [prompts/browser_scan.md](prompts/browser_scan.md).
6. **Write back only through the CLI** (`ingest listings|evaluations`, `listings status|feedback`) and the
   YAML files under `config/` and `sites/` - then `scripts/findhome config validate`.
7. **Hand over**: fill the scratchpad's Handover (3-6 lines), then `scripts/findhome run close`.

## Which prompt to follow

| Task | Prompt |
|---|---|
| Find new candidates (scheduled or manual) | [prompts/run_scan.md](prompts/run_scan.md) |
| Evaluate new/changed listings | [prompts/run_evaluate.md](prompts/run_evaluate.md) |
| Add a website | [prompts/site_onboarding.md](prompts/site_onboarding.md) |
| A site's scan broke | [prompts/site_repair.md](prompts/site_repair.md) |
| Scan a site that needs a browser | [prompts/browser_scan.md](prompts/browser_scan.md) |
| Qasa scan in a browser, writing to `inbox/` (Claude desktop app, or the app's "Claude in Chrome (Haiku)" run profile; fine on Haiku) | [prompts/qasa_browser_scan.md](prompts/qasa_browser_scan.md) |
| Ask a landlord about the two cats | [prompts/pet_inquiry.md](prompts/pet_inquiry.md) |
| Turn feedback into search changes | [prompts/research_guidance.md](prompts/research_guidance.md) |

## Running in the Claude desktop app (Cowork)

There, you work through the connected `find_home` folder and the built-in browser, and the app's API on
`127.0.0.1:8200` is usually not reachable. Then: read state from `runs/state/<site>.json` (written by the app:
`last_published`, `scan_urls`) instead of calling `findhome`, and write results as JSON files into `inbox/`
(format in `inbox/README.md`); the running app imports them. Site prompts written for this mode are short and
procedural so a small model (Haiku) can run them on a schedule.

## Hard rules

- Never write to the database or app code. Only `scripts/findhome ...` and YAML/Markdown under `config/`,
  `sites/` and your run folder.
- After any YAML edit run `scripts/findhome config validate` and fix what it reports.
- Never change profile weights or hard filters on your own: propose them in
  `$FINDHOME_RUN_DIR/proposed_config.patch.yaml` ([prompts/research_guidance.md](prompts/research_guidance.md)).
- Never store or type credentials. Never try to get around a site's bot protection (spoofed user agents,
  headless browsers, private APIs): browse in the user's own browser session or stop and report. Sites with `auth.mode: browser_session` are used only through the user's
  already logged-in browser session.
- Respect each site's `politeness` (delay, max pages) and robots rules. Personal use only.
- Set `pet_status` only with quoted evidence (`pet_evidence`). Two cats: an explicit "no" excludes a listing.
- Never send messages to landlords. Drafts only.
- Keep raw page text out of the conversation: save pages to the run folder if needed and cite the path.

## References (load only when needed)

- [references/cli_cheatsheet.md](references/cli_cheatsheet.md): every command and its output shape.
- [references/data_contract.md](references/data_contract.md): `ListingIn` / `EvaluationIn` fields (generated).
- [references/token_rules.md](references/token_rules.md): budgets and what never to load.
- [references/config_guide.md](references/config_guide.md): which YAML file controls what.
