# Add a listing site

```yaml
inputs:  a URL (search result page for Stockholm rentals) and a slug
outputs: sites/<slug>/site.yaml (validated), NAVIGATION.md, probe report, field report; status active only when the
         field report's coverage passes (step 8)
stop:    the site forbids automated access and the user has not accepted it (risk_note) → status disabled, explain
```

Read [sites/README.md](../../../../sites/README.md) and [sites/_template/site.yaml](../../../../sites/_template/site.yaml)
first: they describe every key below.

1. **Probe.** `scripts/findhome site probe <url> --slug <slug> --name "<Name>"`; with few price or rooms signals, again
   with `--browser`. Read `sites/<slug>/probe/<latest>.md`.
2. **Method**, the cheapest that works: `api` (JSON calls) > `http` (data in the HTML) > `playwright` (needs
   `scanner.py`) > `agent_browser` (refuses scripts, login wall). `scan.script` / `scan.browser` say what may scan
   it and why not. robots.txt or terms against it: stop and ask; scanning anyway is the user's decision, written in
   `risk_note` (who, when, limits).
3. **Search by URL.** `fetch.list_url_template` + `fixed_params` + `pagination: {type: page_param, param,
   page_size, max_pages}`: every result page is a URL. **The volume rule:** read everything the site lists while it
   fits the page cap (20) and filter in the database. `url_filter_policy`: `never` when the whole set fits, or
   `when_over_cap` with the measured `expected_total_unfiltered`, and then only hard filters of the profile go in
   the URL. **Never a pet or a date filter** (the app refuses them anyway). `filter_map` names every catalog key:
   a `param` or `local_only: true`.
4. **Other keys.** `local_filter` (feed-side exclusions), `platforms` / `role: origin` for an aggregator's sources,
   `brand` (`logo` file or `favicon`), `pets`, `auth` (`none`, or `browser_session`: never store or ask for
   credentials), `politeness` (≥ 3 s), `fetch.details` for scripted sites (`only_passing`, `max_per_run`,
   `refresh_days`), `ad_status` (step 6), `notes`. Mark what is not confirmed `# UNVERIFIED`.
5. **Extraction.** Scripted sites: `selectors` / `field_map` or `scanner.py`. Browser sites: below. Either way the
   listing carries id, URL, rent, size, rooms, the address **as the site gives it** (never complete a missing
   street or number; parts into `attributes.address_parts`, the rest null), area, coordinates, move-in date and its
   wording (`attributes.move_in_raw`), contract dates and terms, every photo, floor plans (`attributes.floorplans`
   with `kind` image / pdf / viewer), the full description, pets wording (raw), and the other fields in the fixed
   attribute keys (`references/data_contract.md`).
6. **Ad status.** How the site shows open, applications closed, let, removed, not found. Scripted sites: rules in
   `site.yaml` `ad_status` (`removed_url`, `box_selector` + `box` prefixes; a whole-region feed sets
   `feed_complete_min`). Browser sites: `sites/<slug>/status_check.js` (below).
7. **Dry run.** `scripts/findhome config validate`, then `scripts/findhome scan <slug> --dry-run --max-pages 1
   --json` (scripted) or one result page in the browser (browser sites) until rent, size, rooms, address and URL are
   right.
8. **Field report** ([site_field_report.md](site_field_report.md)) on 3–5 listing pages of different types.
   `status: active` only with move-in on ≥ 80 % and photos on ≥ 50 % of the pages read, or a "not in source"
   reason written in NAVIGATION.md for each field below that.
9. **NAVIGATION.md**, section by section (keep the template headings): search flow, filters, listing anatomy, pet
   wording, pagination, ad status, traps. Then `status: active`, `last_verified: <date and run id>`, the probe and
   field report links under §9.

## Browser-only sites (`fetch.method: agent_browser`, `scan.script.enabled: false`)

The site is scanned by the browser agent in the user's Chrome ([browser_scan_site.md](browser_scan_site.md)), which
opens each URL of `scan_urls` and runs the site's scripts. Each script reads a page that is **already loaded**,
starts with the **translation check** (`html.translated-ltr` or a non-Swedish `lang` → `{translated: true}`), reads
structured data first (page state, JSON-LD) and the DOM with `textContent`, and never calls the site's endpoints.
Its one request, with `window.FH_POST` set, posts its result to the local app (`POST <api>/api/inbox/raw`); end
every script like `sites/qasa/extract.js` does.

1. `sites/<slug>/extract.js` (a result page): `{page, on_page, total_shown or totalCount, last_page, docs}`; kind
   `page` when posted. Each doc is the whole card or search node.
2. `sites/<slug>/detail_extract.js` (one listing page, the details job): every field of step 5; `{listing: false}` on
   a missing ad only with positive evidence, `{listing: null, status: 'unknown'}` when unreadable. Kind `detail`.
3. `sites/<slug>/status_check.js` (one listing page, the status job): `{status, evidence: {rule, value, http,
   url_final}, price?}` by rules that do not trust a plain 404 alone. Kind `status`.
4. `sites/<slug>/scanner.py`: `to_listing(doc)` (cards), `detail_to_listing(doc)` (listing pages), `id_from_url(url)`,
   and optionally `ad_status_of(doc)`. A structured pet badge goes to `attributes["pets_flag"] = {"value": true |
   false | "ask", "evidence": "<text>"}`, free wording to `attributes["pets_text"]`; never set `pet_status` yourself.
5. `site.yaml`: `scan.browser: {enabled: true, extractor: extract.js, default_pages, max_pages}` and
   `politeness.max_pages_per_run` = `max_pages`.
6. Verify in the browser on one result page and one listing page, then steps 8–9.
