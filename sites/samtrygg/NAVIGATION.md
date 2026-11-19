# Samtrygg — navigation guide

Status: **unverified stub**. Second-hand rentals with landlord vetting and contract handling. Hypothesis: public result list, pets shown on listing pages.

How to use this site effectively for the find_home search. Keep each section short; update one
section at a time. Mark anything not yet confirmed with **To verify**.

## 1. Purpose and coverage
**To verify.** Rent or buy, regions covered, first-hand / second-hand / sublet, typical listing volume for Stockholm.

## 2. Access
**To verify.** Login needed? BankID? Cookie wall? Rate limits seen? (`auth.mode` in site.yaml must match.)

## 3. Search flow
By URL only: `https://www.samtrygg.se/RentalObject/NewSearch?place=Stockholm&sort=newest&page=N` lists every
Stockholm ad, newest first, 24 cards per page, with a counter above the cards: "Visar 259 bostäder", or "Visar 68 av
259 bostäder" when a search narrows it (extract.js reads both forms: `total_shown`, `total_city`). The last page has
a disabled "›" (`last_page`). Never type into the form: the "Önskat tillträde" field is **read-only** (typed dates
never applied: run `c7ebb96c` saw the same 6 cards for 4 dates), and the city page /hyra-bostad/stockholm shows only
the newest 6. robots.txt disallows the search pages: read anyway by your decision (`risk_note`).

## 4. Filters
None in the URL (`url_filter_policy: never`): the whole set (259 on 2026-11-16, 11 pages) fits the 20-page cap, and
every filter is applied in the database. A `from=` date would have kept 68 of 259 and dropped every "Nu" and
December start.

## 5. Listing page anatomy
Object page `/object/<id>/<city>/<area>/<street>/<rooms>` (investigation 2026-11-15/16):
- A `RealEstateListing` JSON-LD holds `offers.price`, `offers.availabilityStarts` / `availabilityEnds` (absent when
  open-ended), `offers.availability` (`InStock` when open), `about.geo`, `about.address` (street, postcode, locality),
  `about.numberOfRooms`, `about.floorSize.value`, `image[]` (every photo, `samtryggdata.s3.amazonaws.com/images/1600x1600/<hash>.jpg`),
  `description` and `about.amenityFeature[]` (only the features present).
- The facts block shows `BOENDEFORM`, `MÖBLERING` (Möblerad, Delvis möblerad, Omöblerad, Flexibelt), `STORLEK`,
  `RUM`, `VÅNING`, `FRÅN`, `TILL`. `FRÅN` shows today's date once the start has passed: the start is
  `availabilityStarts`. The rent may carry a note of what it includes ("inkl. serviceavgift, el & bredband").
- The visible gallery has 5 `img`; "Visa alla (N)" and `image[]` give the full count. No floor plans, deposit or
  notice period.
- The visible amenity rows are richer than the JSON-LD list: "Diskmaskin" (ticked), "Diskmaskin — saknas" (off),
  "Värme — ingår", "El — tillgängligt mot kostnad". Ticked rows without a note are `amenities`; rows with a note are
  `utilities`. The heading starts with the landlord's district label ("Norrmalm - 3rok - …"), kept as
  `district_label` (not always the true district); JSON-LD's locality is only the city.
- `detail_extract.js` reads all of this; `detail_to_listing` maps it. Below the ad, "Liknande (lediga) bostäder"
  cards carry their own dates and pet tags: never read them as the ad.

## 6. Pet wording
The amenity list has a row "Husdjur tillåtet": ticked (`li.amenity`, plus the card tag "Husdjur ok" and a JSON-LD
amenity) → `yes`; unticked (`li.amenity.amenity--off`, "Husdjur tillåtet — saknas", like "Diskmaskin — saknas") →
`ask`: the landlord did not tick it, and the site's help says to ask in the viewing chat, as landlords are often
flexible. A card without the "Husdjur ok" tag is not evidence: the object page decides. The search's pet filter
(`features=10`) is not used, so the `ask` listings are scanned too.

## 7. Pagination and limits
`page=N` in the URL, 24 cards per page, at most 20 pages per scan (`max_pages`), 3 s between pages.

## 8. Known traps
- Listing pages show "Liknande lediga bostäder" cards with their own prices, dates, pets tags and "Boka visning"
  buttons: never read them as the ad (the scripts read JSON-LD and the facts block outside `.listing-card`).
- The facts block's FRÅN shows today's date once the start has passed: the real start is JSON-LD
  `availabilityStarts`.
- The gallery mixes S3 photos with `www.samtrygg.se/Content/GetImage.ashx?…` ones; the browser tool masks the latter
  as `[BLOCKED: …]` when they pass through the agent, so pages are posted to the app directly.
- "Husdjur tillåtet — saknas" (an unticked amenity) means the landlord did not say: pets **ask**, not yes.
- Early starts let fast: 4 of 5 early-start ads were let within 11 days.

### Ad status ([`status_check.js`](status_check.js), iteration 2 and gate E: 10 pages)
A let ad answers **HTTP 410** with the gone page (badge `.gone-summary__badge` "Uthyrd", h1 "Den här bostaden är
uthyrd", no listing JSON-LD) → let; 410 without "Uthyrd" → removed (not seen yet); 404 → not found; JSON-LD
`offers.availability` InStock → open. A plain HTTP check would keep let ads alive: read the code from
`performance.getEntriesByType('navigation')[0].responseStatus`.

## 9. Probe history
**To verify.** Links to `probe/*.md` reports.

## 10. Last verified
**To verify.** Agent run id and date.
