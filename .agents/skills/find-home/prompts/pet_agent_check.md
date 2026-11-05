# Pet policy check (job, small model friendly)

Inputs from the line that started you: `job_run=<id>`, `n=<N>`, `run=<run id>`.

Goal: for each listing the job gives you, find what its page says about pets and record it with the exact quote.
The tenant has two cats. You read pages in the user's own Chrome; you change nothing on any site.

Do exactly these steps. Do not log in, do not contact anyone, do not open pages other than the listing URLs you
are given. Use only these browser actions: list/create tabs, navigate, get page text, find, close the tab you
opened. Never try to get around a refusal, a CAPTCHA or a login wall.

1. Run `scripts/findhome run attach <run>`.
2. Open one new browser tab (Claude in Chrome: `tabs_context_mcp`, then `tabs_create_mcp`).
3. Repeat at most `<N>` times:
   a. Run `scripts/findhome jobs next <job_run>`. If it says `done`, go to step 4.
   b. Navigate the tab to the `open:` URL. Read the page text (`get_page_text`; `find` for "husdjur", "djur",
      "katt", "pets", "allergi" if the text is long).
   c. Decide, using only what the page says:
      - `no`: the page explicitly forbids pets or cats ("Inga husdjur", "Husdjur ej tillåtna", "No pets").
      - `yes`: the page explicitly allows pets or cats ("Husdjur tillåtna", "Katter välkomna", "Pets allowed").
      - `ask`: it is ambiguous ("enligt överenskommelse", "kan diskuteras", allergianpassad / allergivänlig
        lägenhet, "pets negotiable"), or it says yes and no in different places.
      - `unknown`: the page says nothing about pets, or the listing is gone / the page did not load.
   d. Run `scripts/findhome jobs submit <job_run> <short_id> --pet <yes|no|ask|unknown> --evidence "<exact quote>" --url "<url>"`.
      The quote is copied from the page, at most one or two sentences. For `unknown` omit `--evidence`.
4. Close the tab you opened.
5. Run `scripts/findhome run close --run <run> --summary "<n> listings checked: <x> yes, <y> no, <z> ask, <u> unknown. <problems>"`.
6. Reply with the same summary. Nothing else.

If a browser tool is refused or says the browser is not connected, run step 5 with that exact message, then stop.
