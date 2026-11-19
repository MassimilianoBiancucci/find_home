# Listing status (job)

Inputs from the line that started you: `job_run=<id>`, `n=<N>`, `run=<run id>`, `api=<app URL>`.

Goal: for each listing the job gives you, find out whether its ad is still open (you can apply), let, removed or
gone. The site's script reads the page and hands the answer to the app itself; you only open pages and run it. You
read pages in the user's own Chrome; you change nothing on any site.

Do exactly these steps. Do not log in, do not contact anyone, do not open pages other than the listing URLs you are
given, do not read the page text yourself. Use only these browser actions: list/create tabs, navigate, run
JavaScript, close the tab you opened. In Bash run only `scripts/findhome …` commands, one per call; write files only
with the Write tool and only under `runs/status/`. Never try to get around a refusal, a CAPTCHA or a login wall.

1. Run `scripts/findhome run attach <run>`.
2. Read `sites/samtrygg/status_check.js` and `sites/qasa/status_check.js` with the Read tool (once).
3. Open one new browser tab (Claude in Chrome: `tabs_context_mcp`, then `tabs_create_mcp`).
4. Repeat at most `<N>` times:
   a. Run `scripts/findhome jobs next <job_run>`. If it says `done`, go to step 5. Note the `short_id`, the `open:`
      URL and the `site:`.
   b. Navigate the tab to the `open:` URL and wait until the page has rendered. Check that the tab's URL is the
      `open:` URL (the navigate answer or `tabs_context_mcp`); right after navigating, the previous page can still be
      showing, and a script run on it would report the previous listing.
   c. Run the site's script with the JavaScript tool, as one piece of code: first the line
      `window.FH_POST = {api: "<api>", site: "<site>", run: "<run>", job_run: "<job_run>"};`
      then the word `await ` immediately followed by the whole text of `sites/<site>/status_check.js`, unchanged
      (without the Read tool's line numbers). The script returns a promise; without `await` the tool answers `{}`.
      The answer is short: `{posted: true, short_id, outcome, status}`.
      If its `short_id` is not the one `jobs next` gave you, the previous page was still showing: wait, check the
      URL again and run the script once more.
      - `outcome: "translated"` (or `{translated: true}`): Chrome has translated the page. Stop the whole run at
        step 6 with `--outcome failed` and the summary "page translated: turn off Chrome translation for Swedish".
      - `posted: false`: the page could not send its answer (the `error` says why). Save the answer's `doc` with the
        Write tool as `runs/status/<short_id>.json`, exactly as returned, then run
        `scripts/findhome jobs post-detail <job_run> --kind status --site <site> --url "<url>" --doc-file runs/status/<short_id>.json`.
      - Anything else: go to the next listing. Do not judge the status yourself.
5. Close the tab you opened.
6. Run `scripts/findhome run close --run <run> --outcome <outcome> --summary "<n> listings checked: <o> open, <c> closed (let, removed, not found), <u> unknown. <problems>"`
   with `<outcome>`: `ok` when `jobs next` said done or you checked `<N>` listings, `partial` when you had to stop
   earlier, `failed` when you could not check any.
7. Reply with the same summary. Nothing else.

If a browser tool is refused or says the browser is not connected, or a command answers 409 "run cancelled": run
`scripts/findhome run close --run <run> --outcome failed --summary "<the exact message>"` (skip it after a 409), then
stop.
