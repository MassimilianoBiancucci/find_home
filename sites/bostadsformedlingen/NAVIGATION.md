# Bostadsförmedlingen Stockholm — navigation guide

Municipal queue for **first-hand** contracts in the Stockholm region (queue points). Listings are public; applying
needs your registration and BankID, which you do yourself, never the agent. Verified by gates A and E
(2026-11-17, 2026-11-19).

## 1. Purpose and coverage
Rentals only, first-hand, the whole Stockholm region (kommuner of Stockholms län). About 350–520 ads at a time; the
feed holds exactly the ads **open for applications**. Special queues (student, youth, senior) are dropped locally
(`local_filter.exclude_flags`); short-term ads (Korttid) are kept.

## 2. Access
No login to read, no cookie wall for the feed, no bot protection, no robots.txt (404), no terms clause on automated
access (probe 2026-11-05). `auth.mode: none`. Politeness: 3 s between page reads.

## 3. Search flow
No search form: one request to the JSON feed `GET https://bostad.stockholm.se/AllaAnnonser/` returns every open ad
of the region ([`scanner.py`](scanner.py) `to_listing`). The listing page is `/bostad/<LagenhetId>/`.

## 4. Filters
None on the site: every hard filter is applied locally after parsing (`filter_map`: all `local_only`), plus the
search-area buffer (`local_filter.search_area_buffer_m`). The feed gives rent, size, rooms, floor, lift, balcony,
coordinates, the application deadline (`AnnonseradTill`) and the queue type; for a project ad (several flats,
`Antal` > 1) the lowest and highest rent, size and rooms (`attributes.ranges`).

## 5. Listing page anatomy
Server-rendered Swedish HTML, read by the scan for every listing that passes the hard filters (`fetch.details`,
`parse_page`):
- facts boxes `.apartment-facts__text` (label + value): **Inflytt** (move-in), floor, size, rent;
- the ad text `.main-body__content` (description; "Boendetid: Från: 2027-01-18" and "Det här är ett
  korttidskontrakt" on short-term ads; "Beräknad boendetid: 5 månader" is an estimate, not a guarantee);
- photos: `picture img` and the gallery modal `.custom-modal__content img`;
- floor plans: links whose own text says "planritning" (image, PDF or an interactive viewer; PDFs often without
  `.pdf` in the URL);
- lists `.tag-list` with an `h2`: amenities, "Förbrukning" (what the rent includes), storage, accessibility;
- requirements in the text: "Lägsta årsinkomst", "Max antal hushållsmedlemmar", the amount to have left after rent
  ("bestämt belopp kvar … för en ensamstående / två sammanboende");
- project ads: one row per flat with its own rent, size, floor and plan (`attributes.units`);
- the status box `.house-body-intresseanmalan .house-content > strong` (§8).

## 6. Pet wording
Never in the feed and rarely on the page. When the description mentions pets ("Husdjur", "allergianpassad"), the
pet rules judge it; otherwise the status stays `unknown` and the pet job or a question to the landlord decides.

## 7. Pagination and limits
None: the feed is one response. The scan reads at most 100 listing pages per run (`fetch.details.max_per_run`),
each again after 30 days (`refresh_days`).

## 8. Known traps
- **Photos**: some ads have photo slots with an empty `src`, also when logged in: the site has no public photo
  (21 of 44 passing ads at gate A). Not an extraction error.
- **Floor plans** come as images, PDFs and viewer links; the "exempelbild" PDF is a sample, not the flat's plan.
- **"Korttidskontrakt"** also appears in the site menu: only the ad's own text decides short-term.
- **Status**: the feed holds only open ads. Once applications close, the page stays reachable and its status box
  says "Annonseringen är avslutad" (applications closed), later "Bostaden är förmedlad" (let, with the queue time),
  or "Annonsen är avregistrerad" (removed); a removed ad may also redirect to
  `/annonsen-ar-inte-langre-tillganglig/`. "För att anmäla intresse …" means open. Rules: `site.yaml` `ad_status`.
  A complete feed (≥ 100 ads, no errors) closes the open sources it no longer holds.
- **Chrome translation**: the scan reads the Swedish HTML itself, but a person or agent in a translated Chrome sees
  translated labels, dates and even street names.

## 9. Probe history
- Probe 2026-11-05 (feed `/AllaAnnonser/` 200, JSON list; listing pages carry the description).
- Gate A report (page parse, 2026-11-17) and gate E report (ad status, 2026-11-19) in the task folder
  `tasks/improve-site-extraction/gates/`.

## 10. Last verified
2026-11-19 (gate E: status box texts on 6 live pages; a scan of 353 ads).
