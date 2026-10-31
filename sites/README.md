# sites/ — listing site registry

One folder per website: `sites/<slug>/`

| File | Purpose |
|---|---|
| `site.yaml` | Machine-readable scan rules: fetch method, URL template / API, selectors or field map, pagination, `filter_map`, politeness, auth. Validated by [`config/schemas/site.schema.json`](../config/schemas/site.schema.json). |
| `NAVIGATION.md` | How to use the site well: search flow, filters, listing anatomy, pet wording, traps. Written and kept current by the agent. |
| `scanner.py` | Optional. `make_scanner(site)` for sites the generic scanner cannot handle (Playwright, embedded JSON). |
| `probe/*.md` | Reports from `findhome site probe` (committed; raw dumps under `probe/raw/` are not). |

[`_template/`](_template/) is the starting point. The four stubs (Qasa, Blocket Bostad, Samtrygg,
Bostadsförmedlingen) are **unverified**: nothing in them has been checked on the live sites.

## General filters → site filters

Your hard limits live in [`config/profile.yaml`](../config/profile.yaml) using the canonical keys of
[`config/filters_catalog.yaml`](../config/filters_catalog.yaml). Each site's `filter_map` says what to do with
every key:

- `param: <name>` (+ optional `value_map`): sent as a query parameter / API field,
- `ui_step: <text>`: applied by the agent in the browser (agent_browser sites),
- `local_only: true`: the site cannot filter it; the listing is still ingested and the score's hard filters
  reject it.

`findhome config validate` fails if a `filter_map` key is not in the catalog.

## Fetch methods (cheapest first)

1. `api` — a JSON endpoint behind the result list (`fetch.api` + `field_map`).
2. `http` — plain HTML result pages (`fetch.list_url_template` + `fetch.selectors`).
3. `playwright` — JS-rendered pages: needs `scanner.py`.
4. `agent_browser` — login-walled or hostile pages: the agent scans with your browser session following
   `.agents/skills/find-home/prompts/browser_scan.md` and ingests with `findhome ingest listings --source agent_browser`.

Scripted methods use no tokens. Only `active` sites are scanned (`findhome scan --all`); `--dry-run` works on
any status and is how a site is verified.

## Add a site

1. `findhome site probe <url> --slug <slug> [--browser]` → `probe/<ts>.md` + draft `site.yaml` and `NAVIGATION.md`.
2. Follow `.agents/skills/find-home/prompts/site_onboarding.md` (fills `site.yaml`, writes `NAVIGATION.md`).
3. `findhome config validate`.
4. `findhome scan <slug> --dry-run --max-pages 1` until the preview parses correctly.
5. Set `status: active` and `last_verified`.

## Repair a site

A scan with parse errors or zero items → set `status: broken`, then follow `prompts/site_repair.md`
(re-probe, compare, change the minimum, dry run, re-activate).

## Retire a site

Set `status: disabled` (history is kept). Delete the folder only if you never want its history in the digest.

## Rules

Personal use only. Respect each site's terms and robots.txt (`politeness.respect_robots`), keep the polite
delay, never store credentials (`auth.mode: browser_session` means the agent uses your own logged-in browser).
