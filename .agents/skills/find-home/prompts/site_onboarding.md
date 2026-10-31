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
