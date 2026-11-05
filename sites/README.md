# sites/ — listing site registry

One folder per website: `sites/<slug>/`

| File | Purpose |
|---|---|
| `site.yaml` | Machine-readable scan rules: fetch method, URL template / API, selectors or field map, pagination, `filter_map`, politeness, auth. Validated by [`config/schemas/site.schema.json`](../config/schemas/site.schema.json). |
| `NAVIGATION.md` | How to use the site well: search flow, filters, listing anatomy, pet wording, traps. Written and kept current by the agent. |
| `scanner.py` | Optional. `make_scanner(site)` for sites the generic scanner cannot handle (Playwright, embedded JSON, a whole-region feed); `to_listing(doc)` converts browser-extracted items from `inbox/`. |
| `extract.js` | Browser-only sites: run by the browser agent on a result page already loaded in your Chrome (reads the page, sends no requests). |
| `logo.svg` / `logo.png` | Optional. The site's logo for the app (`brand.logo`); without it the app falls back to `brand.favicon` or the site's favicon. |
| `probe/*.md` | Reports from `findhome site probe` (committed; raw dumps under `probe/raw/` are not). |

[`_template/`](_template/) is the starting point.

| Site | Status | How it is scanned |
|---|---|---|
| [Qasa](qasa/site.yaml) | active | browser agent only ([`extract.js`](qasa/extract.js)): qasa.com answers scripts with 429; manual start, ≤ 20 pages (`risk_note`) |
| [Bostadsförmedlingen](bostadsformedlingen/site.yaml) | active | script: one request to the region-wide JSON feed ([`scanner.py`](bostadsformedlingen/scanner.py)), new listings' pages read for the description |
| [Samtrygg](samtrygg/site.yaml) | active | browser agent only ([`extract.js`](samtrygg/extract.js) on the rendered city page, the newest 6 listings): robots.txt disallows the search pages |
| [Blocket Bostad](blocket-bostad/site.yaml), [HomeQ](homeq/site.yaml) | disabled, `role: origin` | never scanned: their listings arrive through Qasa (`platforms`) |

## What may scan a site

`scan.script` and `scan.browser` each have `enabled` and a `reason` shown in the app when off. A site keeps its
`scanner.py` when scripts are refused (Qasa): the engine checks `scan.script` first and never loads it.
`role: origin` sites are never scanned; an aggregator's `platforms` maps its `attributes.platform` values to them,
so a listing shows where it was first published. `risk_note` records a decision to scan despite robots.txt or the
terms (who, when, limits). `local_filter` holds scanner-side filters (`exclude_flags`, `search_area_buffer_m`).
`scan.browser.inputs` lists search fields the browser agent sets on the result page before extracting (label,
selector, how); the app derives the values to try from the profile (e.g. every month of the move-in window).
`scan.browser.avoid_paths` are URL paths the agent must not read even when an input leads there (robots.txt).
`scan.browser.next_page` says how to reach further result pages inside the page (a next-page control) when they
have no URL of their own; the browser agent then reads up to the chosen number of pages for every input set.

## General filters → site filters

Your hard limits live in `config/profile.yaml` (personal, gitignored; see [`config/README.md`](../config/README.md)) using the canonical keys of
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
4. `agent_browser` — pages scripts may not or cannot read: the browser agent runs `extract.js` on each result page
   in your Chrome ([`browser_scan_site.md`](../.agents/skills/find-home/prompts/browser_scan_site.md)), started
   from the Sites page (Claude CLI in the background, or a prefilled Claude Code tab in VS Code), and writes
   `inbox/` files the app imports into the run.

Scripted methods use no tokens. Only `active` sites with `scan.script` enabled are scanned (`findhome scan --all`);
`--dry-run` works on any status and is how a scripted site is verified.

## Add a site

1. `findhome site probe <url> --slug <slug> [--browser]` → `probe/<ts>.md` + draft `site.yaml` and `NAVIGATION.md`.
2. Follow `.agents/skills/find-home/prompts/site_onboarding.md` (fills `site.yaml`, writes `NAVIGATION.md`; for
   browser-only sites also `extract.js` and `to_listing`). The Sites page starts it with the `site_onboarding` profile.
3. `findhome config validate`.
4. `findhome scan <slug> --dry-run --max-pages 1` until the preview parses correctly.
5. Set `status: active` and `last_verified` (browser-only sites: one 1-page browser scan instead of the dry run).

## Repair a site

A scan with parse errors or zero items → set `status: broken`, then follow `prompts/site_repair.md`
(re-probe, compare, change the minimum, dry run, re-activate).

## Retire a site

Set `status: disabled` (history is kept). Delete the folder only if you never want its history in the digest.

## Rules

Personal use only. Respect each site's terms and robots.txt (`politeness.respect_robots`), keep the polite
delay, never store credentials (`auth.mode: browser_session` means the agent uses your own logged-in browser).
