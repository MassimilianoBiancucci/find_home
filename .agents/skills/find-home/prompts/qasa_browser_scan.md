# Qasa browser scan (Claude desktop app, small model friendly)

Goal: put new Qasa listings into find_home without Claude Code. You use the built-in browser and the connected
`find_home` folder. You never call the app's API; you write a file into `find_home/inbox/` and the app imports it.
Do exactly these steps. Do not explore the site, do not open listing pages, do not log in, do not change any file
except creating files in `inbox/`.

```yaml
budget: max 5 result pages · stop as soon as a page has nothing new
output: inbox/qasa-<UTC yyyymmddThhmmss>-p<N>.json per page with new listings; a 3-line summary
```

1. Read `find_home/runs/state/qasa.json`. Note `last_published` (may be null) and `scan_urls` (one URL per page).
   If the file is missing, use this single URL and treat `last_published` as null:
   `https://qasa.com/se/sv/find-home?searchAreas=Stockholms_l%C3%A4n~~se&sharedHome=privateHome&minRoomCount=2&rules=pets&page=1`
2. Read `find_home/sites/qasa/extract.js` (you will run its code as is).
3. For each URL in `scan_urls`, in order:
   a. Open it in the browser and wait until listings are visible (about 3 seconds).
   b. If `last_published` is not null, run this JavaScript first: `window.FH_SINCE = "<last_published>"`.
   c. Run the code of `extract.js` with the JavaScript tool. It returns
      `{page, on_page, new_count, older_reached, docs}`.
   d. If `on_page` is 0: the page did not load or Qasa refused it. Stop and report that.
   e. If `new_count` > 0: write the file `find_home/inbox/qasa-<UTC yyyymmddThhmmss>-p<page>.json` containing
      `{"site": "qasa", "parser": "qasa", "source": "agent_browser", "page": <page>, "docs": <docs>}`.
      Copy `docs` exactly; do not edit, summarise or reformat the listings.
   f. If `older_reached` is true or `new_count` is 0: stop, the next pages hold nothing new.
4. Reply with: pages read, new listings written, files created. Nothing else.

The app must be running to import the files right away; otherwise it imports them at its next start
(`scripts/findhome ingest inbox` imports by hand). Evaluating the new listings is a separate run
(`prompts/run_evaluate.md`).
