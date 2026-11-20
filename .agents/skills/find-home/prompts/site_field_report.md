# Field report of one site

Inputs: `site=<slug>`, and 3–5 listing page URLs of **different types** (ordinary, short-term, new build or project
ad, one that looks closed if you can find it), given by the user or picked from the site's search page. Required
before onboarding sets `status: active` ([site_onboarding.md](site_onboarding.md)); a repair runs it again
([site_repair.md](site_repair.md)).

Goal: list **every** field the site's listing pages show, where it is, how often it is there, and whether the app
stores it; record how the site shows an ad's status. You only observe and report: you change no code, config or data.

```yaml
outputs: sites/<slug>/reports/fields-<UTC yyyymmdd>.md   (one Markdown report, the format below; no raw page text)
budget:  the 3–5 listing pages + one search page; one tab
stop:    login wall, CAPTCHA, "access denied", a translated page you cannot avoid, or the browser tool not connected
         → write what you have, say so in §1, stop
```

## Rules

- Use the browser tool on the user's own Chrome (Claude in Chrome): `tabs_context_mcp` first, then **one** new tab
  with `tabs_create_mcp`; work only in it and close it at the end.
- Open only the given pages and the site's public search page. Never log in, fill or send a form, contact anyone or
  download files. A floor plan link: record its href, text and kind (image, PDF, viewer); do not open it.
- **Structured data first.** Read the page state (`__NEXT_DATA__`, `self.__next_f`, Apollo state), JSON-LD
  (`script[type="application/ld+json"]`) and `og:` meta before the visible text, with read-only `javascript_tool`
  calls (`textContent`, never `innerText`). No `fetch`, no XHR.
- **A translated page is not read.** `html.translated-ltr` or a `lang` that is not Swedish: say so in §1 and ask the
  user to turn off Chrome translation for Swedish; do not report fields from it.
- Values masked as `[BLOCKED: …]` by the browser tool: report the masking, never work around it.
- **Seen or inferred.** Mark every claim `seen` (with the selector, JSON path or a quote of at most 200 characters)
  or `inferred` (with the reasoning). Prefer "unknown" to a guess. Personal data in examples (names, phone numbers,
  e-mail) is replaced by fictional values.
- **The address rule.** Report the address as the site gives it; never complete a missing street or number.
- Write only the report file. In Bash run only `scripts/findhome …`.

## Procedure

1. Open the tab. For each page, in order: navigate, wait until rendered, check the translation, scroll once; record
   the final URL (a redirect?) and the title.
2. For each page, list every field shown: price parts, size, rooms, floor, move-in and contract dates (their wording
   as well: "Nu", "enligt överenskommelse"), contract terms (guaranteed length, notice, extension), requirements,
   furnishing, amenities and what the rent includes, photos (count, where the full gallery is), floor plans (kind),
   description (full or cut), address parts and coordinates, pets wording, landlord type, project units, and
   anything else.
3. Record the **ad status** signals: open (an apply or contact button, InStock), applications closed, let, removed,
   not found; the HTTP code (`performance.getEntriesByType('navigation')[0].responseStatus`), banners, headings, a
   status field in the page state, a redirect. Say which a script could read and whether each was there on every
   page of that status.
4. Close the tab. Write the report.

## Report format (`sites/<slug>/reports/fields-<UTC yyyymmdd>.md`)

```
# <Site> · field report
Run: <date, model> · Pages read: <n> (types) · Stopped early: <no | why> · Translated: <no | which>

## 1. Summary (max 7 bullets, problems first; each seen / inferred)
## 2. Fields
| field | where (selector / JSON path) | example (fictional if personal) | pages with it (n/N) | maps to (column, attributes.<key>, proposed new key, ignore) | stored by the app today? |
## 3. Coverage and gaps
Per field missing on a page: not_in_source (the page does not give it) or not extracted (the page has it, the
app does not store it). Move-in, photos, rent, size, rooms and address first.
## 4. Ad status
| status | signal (selector / JSON path / HTTP / text) | seen on n pages | reliable? |
Plus the order a status script should test them in, and what it returns when none matches.
## 5. Traps and surprises
## 6. Proposals
One line each: extractor or detail_extract.js changes, site.yaml, and fields for the cross-site schema.
```
