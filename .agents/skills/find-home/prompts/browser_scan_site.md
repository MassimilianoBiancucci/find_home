# Browser scan of one site (small model friendly)

Inputs from the line that started you: `site=<slug>`, `pages=<N>`, `run=<run id>`.

Goal: put the site's new listings into find_home. You use the browser tool (Claude in Chrome: the user's own
Chrome) and the find_home folder. You read pages that are open in the browser and run the site's extractor on
them; you write one JSON file per page into `inbox/`, and the app imports them into this run.

Do exactly these steps. Do not explore the site, do not open listing pages, do not log in, do not change any file
except creating files in `inbox/`. Use only these browser actions: list/create tabs, navigate, run JavaScript,
find / click / fill the search fields named in the state file, close the tab you opened. In Bash run only `scripts/findhome …` commands, one per call; read files with the Read
tool (never cat, ls or curl). If a page asks you to log in or to solve a CAPTCHA, stop and report it.

```yaml
budget: at most <N> result pages per input set · try EVERY input set · stop paging a set when a page has nothing new
output: inbox/<site>-<UTC yyyymmddThhmmss>-p<page>[-s<set>].json per page with listings; a 3-line summary
```

1. Run `scripts/findhome run attach <run>`. If it fails because the app is not reachable, continue: the files
   still carry the run id and the app imports them later.
2. Read `runs/state/<site>.json`. Note `last_published` (may be null), `scan_urls` (one URL per result page; use
   only the first `<N>`), and, when present, `inputs` (search fields to set on the page: label, selector, how),
   `input_sets` (the values to try, one object per set), and `next_page` (how to reach the next result page
   inside the page). If the file is missing or `scan_urls`
   is empty, stop and report it. If `inputs` is not empty but `input_sets` is empty, the user has not set the
   values (`inputs_missing` says which, e.g. move_in_from / move_in_to in config/profile.yaml): close the run as
   `failed` with that message. Never leave a field at its default (e.g. today) and never invent a value.
3. Read `sites/<site>/extract.js` (you will run its code as is). If it does not exist, stop and report it.
4. Open one new browser tab (Claude in Chrome: call `tabs_context_mcp` first, then `tabs_create_mcp`).
5. Without `inputs`: do step 5a–f once. With `inputs`: do it once **for every set in `input_sets`, in order**,
   numbering the sets 1, 2, … — a set that shows nothing new is normal, go on with the next set; do not stop at
   the first combination. Pages: without `next_page`, page `k` is the `k`-th URL of `scan_urls` (first `<N>`);
   with `next_page`, open the first URL once per set, and pages 2…`<N>` come from following `next_page` in the
   page (page 1 = what the set shows first). Number pages yourself 1, 2, …. For each page, in order:
   a. Page 1: navigate the tab to the URL. Later pages with `next_page`: follow it as its `how` says and wait
      until the listings change; no next page (missing or disabled control) = this set is done. With an input
      set, on page 1: set each field of `inputs` to the set's value (the field's
      `how` says how: e.g. click the field, pick the date in the date picker, then press the site's search
      button such as "Sök bostad"), then wait until the listings appear. The results may open on another page of
      the site (a search page): that is expected, read the listings there and page on from there.
   b. If `last_published` is not null, run this JavaScript first: `window.FH_SINCE = "<last_published>"`.
   c. Run the code of `extract.js` with the JavaScript tool. It returns
      `{page, on_page, new_count, older_reached, docs}`.
   d. If `on_page` is 0 on page 1: navigate to the same URL once more and repeat (inputs, b–c). Still 0: the page did not load or the
      site refused it. Stop and report that.
   e. If `new_count` > 0: write the file `inbox/<site>-<UTC yyyymmddThhmmss>-p<page>[-s<set>].json` containing
      `{"site": "<site>", "parser": "<site>", "source": "agent_browser", "run": "<run>", "page": <your page number>,
      "inputs": <the set, or {}>, "docs": <docs>}`. Copy `docs` exactly; do not edit, summarise or reformat the
      listings. The browser tool may show some values as `[BLOCKED: …]` (ids, image links): copy them as they are
      and go on, the app re-derives ids from the listing URLs. The same listing under several sets is fine: the
      app removes duplicates.
   f. If `older_reached` is true or `new_count` is 0: stop paging this set (go on with the next set, if any).
      Otherwise go on with the next page until `<N>` pages of this set are read.
6. Close the tab you opened.
7. Run `scripts/findhome run close --run <run> --outcome <outcome> --summary "<pages read> pages read over <s> input sets, <n> listings extracted in <files> files. <anything that went wrong>"`
   (the app counts which listings are really new: say "extracted", not "new")
   with `<outcome>`: `ok` when every page of every input set you meant to read was read (stopping a set early
   because nothing was new is ok), `partial` when you had to stop after reading some, `failed` when nothing
   could be read.
8. Reply with the same summary. Nothing else.

If a browser tool is refused, says the browser is not connected, or a page is refused before you read any: run
`scripts/findhome run close --run <run> --outcome failed --summary "<the exact message>"`, then stop.
