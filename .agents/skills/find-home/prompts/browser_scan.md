# Scan a site with the browser

For sites with `fetch.method: agent_browser` (login walls, heavy JS) and for verifying a new site.

```yaml
budget:  politeness.max_pages_per_run pages; never more than 5 listing detail pages per run
outputs: $FINDHOME_RUN_DIR/<slug>_listings.json ingested with --source agent_browser
```

Browser choice: in Claude (desktop/Cowork) use the built-in browser or Claude in Chrome, which may already be
logged in; in Claude Code or Codex use Playwright through a short script, or ask the user.

1. Read `sites/<slug>/NAVIGATION.md` §2-§7 and `site.yaml` `filter_map` (`ui_step` entries tell you what to
   click). Use the profile's hard filters from the history digest.
2. Open the result list with the filters applied. Read it with page text / find tools, not screenshots
   (screenshots only when the layout itself matters).
3. For each card, check first: `scripts/findhome listings exists <slug> <external id or URL>`. Skip known ones.
4. Collect the new ones into JSON (ListingIn, see references/data_contract.md): `source.site_slug`,
   `source.external_id`, `source.url`, rent, size, rooms, address, area, pets text → `pet_status` +
   `pet_evidence`, contract text, dates. Unknown stays null. Do not paste page text into the conversation.
5. Open a detail page only when the card lacks pets/contract/rooms information (max 5 per run).
6. `scripts/findhome ingest listings -f $FINDHOME_RUN_DIR/<slug>_listings.json --source agent_browser`.
7. Note in NAVIGATION.md anything that changed in the site's flow.
