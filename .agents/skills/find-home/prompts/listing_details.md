# Listing details (job)

Inputs from the line that started you: `job_run=<id>`, `n=<N>`, `run=<run id>`, `api=<app URL>`.

Goal: for each listing the job gives you, read its own page so the app stores what the page shows (move-in, photos,
floor, contract, description …). The site's script reads the page and hands the data to the app itself; you add only
what is still missing and appears in the page's free text, each value with its exact quote. The tenant has two
cats. You read pages in the user's own Chrome; you change nothing on any site.

Do exactly these steps. Do not log in, do not contact anyone, do not open pages other than the listing URLs you are
given. Use only these browser actions: list/create tabs, navigate, run JavaScript, get page text, find, close the tab
you opened. In Bash run only `scripts/findhome …` commands, one per call; read and write files with the Read and Write
tools (write only under `runs/details/`). Never try to get around a refusal, a CAPTCHA or a login wall.

1. Run `scripts/findhome run attach <run>`.
2. Read `sites/samtrygg/detail_extract.js` and `sites/qasa/detail_extract.js` with the Read tool (once).
3. Open one new browser tab (Claude in Chrome: `tabs_context_mcp`, then `tabs_create_mcp`).
4. Repeat at most `<N>` times:
   a. Run `scripts/findhome jobs next <job_run>`. If it says `done`, go to step 5. Note the `short_id`, the `open:`
      URL, the `site:` and what is `missing:`.
   b. Navigate the tab to the `open:` URL and wait until the page has rendered.
   c. Run the site's script with the JavaScript tool: first the line
      `window.FH_POST = {api: "<api>", site: "<site>", run: "<run>", job_run: "<job_run>"};`
      then the whole text of `sites/<site>/detail_extract.js`, unchanged (without the Read tool's line numbers).
      The answer is short: `{posted: true, short_id, outcome, changed, missing}`.
      - `outcome: "translated"` (or `{translated: true}`): Chrome has translated the page. Stop the whole run at
        step 6 with `--outcome failed` and the summary "page translated: turn off Chrome translation for Swedish".
      - `outcome: "gone"` or `"unread"`: nothing to add; go to the next listing.
      - `posted: false`: the page could not send its data. Save the answer's `doc` with the Write tool as
        `runs/details/<short_id>.json` and run
        `scripts/findhome jobs post-detail <job_run> --site <site> --url "<url>" --doc-file runs/details/<short_id>.json`.
   d. If `missing` lists `available_from` or the page shows contract terms the script cannot read: read the page
      text (`get_page_text`; `find` for "tillträde", "inflytt", "uppsägning", "deposition", "hyresgäster" when the
      text is long). Record only values the page states in words, each with its exact quote (one or two sentences):
      - `available_from` / `contract_start` / `contract_end`: a date YYYY-MM-DD the text gives ("Tillträde 1 mars
        2027"). "Enligt överenskommelse" or "snarast" is not a date: record it as `move_in_raw`.
      - `contract_terms`: `{"notice_raw": "…", "guaranteed_raw": "…", "extension_raw": "…"}` (the raw wording).
      - `deposit_sek`, `max_tenants`, `other_costs`, `has_sovalkov`, `floor`, `furnished` when stated in words.
      - `pet`: `yes` / `no` / `ask` only when the text says so explicitly (the same rules as the pet check).
      Write `runs/details/<short_id>-fields.json` as
      `{"fields": {...}, "evidence": {"<field>": "<exact quote>", ...}, "page_url": "<url>"}` and run
      `scripts/findhome jobs submit <job_run> <short_id> --fields-file runs/details/<short_id>-fields.json`.
      If the text adds nothing, skip this step. Never invent a value, never complete an address.
5. Close the tab you opened.
6. Run `scripts/findhome run close --run <run> --outcome <outcome> --summary "<n> listings read: <c> changed, <u> unchanged, <g> gone, <a> with added free-text values. <problems>"`
   with `<outcome>`: `ok` when `jobs next` said done or you read `<N>` listings, `partial` when you had to stop
   earlier, `failed` when you could not read any.
7. Reply with the same summary. Nothing else.

If a browser tool is refused or says the browser is not connected, or a command answers 409 "run cancelled": run
`scripts/findhome run close --run <run> --outcome failed --summary "<the exact message>"` (skip it after a 409), then
stop.
