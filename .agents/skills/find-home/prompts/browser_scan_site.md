# Browser scan of one site (small model friendly)

Inputs from the line that started you: `site=<slug>`, `pages=<N>`, `run=<run id>`, `api=<app URL>`.

Goal: put every listing the site shows into find_home. You open the site's result pages in the user's own Chrome
(Claude in Chrome) one URL at a time and run the site's extractor on each; the extractor hands the page to the app
itself and answers with one short line. You never type into the site's search fields and never click its pager:
the next page is the next URL.

Do exactly these steps. Do not explore the site, do not open listing pages, do not log in. Use only these browser
actions: list/create tabs, navigate, run JavaScript, close the tab you opened. In Bash run only
`scripts/findhome …` commands, one per call; read files with the Read tool. If a page asks you to log in or to solve
a CAPTCHA, stop and report it.

1. Run `scripts/findhome run attach <run>`.
2. Read `runs/state/<site>.json`: `scan_urls` (one URL per result page, in order), `page_size` (cards on a full
   page, may be missing) and `last_total` (the site's counter last time, may be null). If the file is missing or
   `scan_urls` is empty, close the run as `failed` with that message.
3. Read `sites/<site>/extract.js` once with the Read tool.
4. Open one new browser tab (Claude in Chrome: `tabs_context_mcp`, then `tabs_create_mcp`).
5. For k = 1, 2, … up to `<N>` (and never past the last URL of `scan_urls`):
   a. Navigate the tab to `scan_urls[k]` and wait until the page has rendered. Check that the tab's URL is that URL.
      Samtrygg: wait 3 seconds between pages.
   b. Run with the JavaScript tool, as one piece of code: first the line
      `window.FH_POST = {api: "<api>", site: "<site>", run: "<run>"};`
      then the word `await ` immediately followed by the whole text of `extract.js`, unchanged (without the Read
      tool's line numbers). Without `await` the tool answers `{}`.
      The answer is short: `{posted: true, page, on_page, cards, new, total, last_page}`.
   c. `{translated: true}`: Chrome has translated the page. Close the run as `failed` with "page translated: turn
      off Chrome translation for Swedish" and stop.
   d. `posted: false`: the page could not reach the app (the `error` says why). Close the run as `failed` with
      "<error>: in Chrome allow Local network access for this site, see guide/documentation/agent-permissions.md"
      and stop. Never copy the page's listings yourself.
   e. `on_page` 0 on page 1: navigate once more and repeat b. Still 0: close the run as `failed` ("page 1 shows no
      listings") and stop.
   f. Stop paging after this page when `last_page` is true, or `on_page` is smaller than `page_size`, or `on_page`
      is 0. Otherwise go on with the next URL.
6. Close the tab you opened.
7. Run `scripts/findhome run close --run <run> --outcome <outcome> --summary "<p> pages read, <c> cards, <n> new; counter <total>. <anything that went wrong>"`
   with `<outcome>`: `ok` when you reached the last page (or read `<N>` pages), `partial` when you had to stop
   earlier, `failed` when no page could be read. The app adds the coverage (cards read against the counter).
8. Reply with the same summary. Nothing else.

If a browser tool is refused, says the browser is not connected, or a command answers 409 "run cancelled": run
`scripts/findhome run close --run <run> --outcome failed --summary "<the exact message>"` (skip it after a 409), then
stop.
