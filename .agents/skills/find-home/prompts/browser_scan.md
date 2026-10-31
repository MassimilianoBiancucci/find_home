# Scan a site with the browser

For sites with `fetch.method: agent_browser` (login walls, heavy JS) and for verifying a new site.

```yaml
budget:  politeness.max_pages_per_run pages; never more than 5 listing detail pages per run
outputs: $FINDHOME_RUN_DIR/<slug>_listings.json ingested with --source agent_browser
```

Browser choice: the user's own browser session (the Claude desktop browser or Claude in Chrome). Never try to get
around a site's bot protection (spoofed user agents, headless browsers, private APIs); if a page is refused, stop
and report it.

1. Read `sites/<slug>/NAVIGATION.md` §2-§7 and `site.yaml` `filter_map` (`ui_step` entries tell you what to
   click). Use the profile's hard filters from the history digest.
2. If the site folder has an `extract.js` (e.g. `sites/qasa/extract.js`), use it: open each result page, run the
   file's code with the browser's JavaScript tool, save the returned JSON to the run folder and ingest it with
   `scripts/findhome ingest listings -f <file> --parser <slug> --source agent_browser`. Then skip steps 3-6.
   Otherwise open the result list with the filters applied. Read it with page text / find tools, not screenshots
   (screenshots only when the layout itself matters).
3. For each card, check first: `scripts/findhome listings exists <slug> <external id or URL>`. Skip known ones.
4. Collect the new ones into JSON (ListingIn, see references/data_contract.md): `source.site_slug`,
   `source.external_id`, `source.url`, rent, size, rooms, address, area, pets text → `pet_status` +
   `pet_evidence`, contract text, dates. Unknown stays null. Do not paste page text into the conversation.
5. Open a detail page only when the card lacks pets/contract/rooms information (max 5 per run).
6. `scripts/findhome ingest listings -f $FINDHOME_RUN_DIR/<slug>_listings.json --source agent_browser`.
7. Note in NAVIGATION.md anything that changed in the site's flow.
