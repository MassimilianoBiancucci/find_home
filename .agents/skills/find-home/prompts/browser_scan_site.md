# Browser scan of one site (small model friendly)

Inputs from the line that started you: `site=<slug>`, `pages=<N>`, `run=<run id>`.

Goal: put the site's new listings into find_home. You use the browser tool (Claude in Chrome: the user's own
Chrome) and the find_home folder. You read pages that are open in the browser and run the site's extractor on
them; you write one JSON file per page into `inbox/`, and the app imports them into this run.

Do exactly these steps. Do not explore the site, do not open listing pages, do not log in, do not change any file
except creating files in `inbox/`. Use only these browser actions: list/create tabs, navigate, run JavaScript,
close the tab you opened. Never try to get around a refusal, a CAPTCHA or a login wall: stop and report it.

```yaml
budget: at most <N> result pages · stop as soon as a page has nothing new
output: inbox/<site>-<UTC yyyymmddThhmmss>-p<page>.json per page with new listings; a 3-line summary
```

1. Run `scripts/findhome run attach <run>`. If it fails because the app is not reachable, continue: the files
   still carry the run id and the app imports them later.
2. Read `runs/state/<site>.json`. Note `last_published` (may be null) and `scan_urls` (one URL per result page).
   Use only the first `<N>` URLs. If the file is missing or `scan_urls` is empty, stop and report it.
3. Read `sites/<site>/extract.js` (you will run its code as is). If it does not exist, stop and report it.
4. Open one new browser tab (Claude in Chrome: call `tabs_context_mcp` first, then `tabs_create_mcp`).
5. For each of the first `<N>` URLs, in order:
   a. Navigate the tab to it.
   b. If `last_published` is not null, run this JavaScript first: `window.FH_SINCE = "<last_published>"`.
   c. Run the code of `extract.js` with the JavaScript tool. It returns
      `{page, on_page, new_count, older_reached, docs}`.
   d. If `on_page` is 0: navigate to the same URL once more and repeat b–c. Still 0: the page did not load or the
      site refused it. Stop and report that.
   e. If `new_count` > 0: write the file `inbox/<site>-<UTC yyyymmddThhmmss>-p<page>.json` containing
      `{"site": "<site>", "parser": "<site>", "source": "agent_browser", "run": "<run>", "page": <page>, "docs": <docs>}`.
      Copy `docs` exactly; do not edit, summarise or reformat the listings.
   f. If `older_reached` is true or `new_count` is 0: stop, the next pages hold nothing new.
6. Close the tab you opened.
7. Run `scripts/findhome run close --run <run> --summary "<pages read> pages read, <n> new listings in <files> files. <anything that went wrong>"`.
8. Reply with the same summary. Nothing else.

If a browser tool is refused or says the browser is not connected, run step 7 with that exact message as the
summary, then stop.
