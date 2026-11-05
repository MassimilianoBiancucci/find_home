# Add a listing site

```yaml
inputs:  a URL (search result page for Stockholm rentals) and a slug
outputs: sites/<slug>/site.yaml (validated), NAVIGATION.md, probe report; status active only if a dry run parses
stop:    the site forbids automated access (robots/terms) → set status disabled and explain
```

1. `scripts/findhome site probe <url> --slug <slug> --name "<Name>"`. If the report shows few
   price/rooms signals, run it again with `--browser` (needs Playwright: `poetry install -E scrape`).
2. Read `sites/<slug>/probe/<latest>.md`. Pick the cheapest method that works:
   `api` (JSON calls listed) > `http` (data in HTML) > `playwright` (needs `sites/<slug>/scanner.py`) >
   `agent_browser` (login wall / hostile).
3. Fill `site.yaml`:
   - `fetch`: `list_url_template` (with `{page}` if pages are a path part) or `api.endpoint` + `items_path`;
     `selectors` (CSS, `css@attr`) or `field_map` (ListingIn field → JSON path); `pagination`.
   - `filter_map`: for every key in config/filters_catalog.yaml that the site can filter, its `param`
     (+ `value_map`); everything else `local_only: true`.
   - `pets`, `auth`, `politeness` (keep at least 3 s delay), `notes`.
   Mark anything not confirmed `# UNVERIFIED`.
4. Use the browser to confirm the search flow and the pet wording, then write `NAVIGATION.md` section by
   section (keep the template headings). Never log in with credentials; if login is needed, set
   `auth.mode: browser_session` and say so.
5. `scripts/findhome config validate`, then `scripts/findhome scan <slug> --dry-run --max-pages 1 --json`
   until the preview shows correct rent, size, rooms, address and URL.
6. Set `status: active` and `last_verified: <run id>`. Add the probe report link under NAVIGATION.md §9.

## Browser-only sites (`fetch.method: agent_browser`, `scan.script.enabled: false`)

When robots.txt, the terms or the site's protection rule out a scripted scanner, the site is scanned by the
browser agent in the user's Chrome ([browser_scan_site.md](browser_scan_site.md)). Onboarding then produces:

1. `sites/<slug>/extract.js`, run on a result page that is **already loaded** (no requests of its own). Read the
   rendered DOM (cards) or data the page embeds; never call private endpoints. Same output as
   `sites/qasa/extract.js`: `{page, on_page, new_count, older_reached, docs}`, honouring `window.FH_SINCE`
   when the site shows a published date. Each doc carries the site id, URL, rent, size, rooms, address, area,
   coordinates when present, the description excerpt, and the pet badge/text as `pets` (raw wording).
2. `sites/<slug>/scanner.py` with `to_listing(doc) -> ListingIn` only (the inbox parser). Put a structured pet
   badge into `attributes["pets_flag"] = {"value": true|false, "evidence": "<badge text>"}` and free pet wording
   into `attributes["pets_text"]`; never set `pet_status` yourself (findhome.pets decides at ingest).
3. `site.yaml`: `list_url_template` (a URL robots.txt allows), `scan.browser: {enabled: true, extractor: extract.js,
   default_pages, max_pages}` and `politeness.max_pages_per_run` = `max_pages`.
4. Verify: run `extract.js` on one result page in the browser, save the output as
   `inbox/<slug>-<UTC yyyymmddThhmmss>-p1.json` with `"run": "<run id>"`, and check the import
   (`scripts/findhome ingest inbox`). Then `status: active` and `last_verified`.
