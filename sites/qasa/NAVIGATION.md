# Qasa — navigation guide

Status: **active** (onboarded 2026-10-31 by browser exploration; the first scripted dry run must run on the
Mac, see §10). Qasa (qasa.com, formerly qasa.se) is a rental marketplace for second-hand (andrahand) and some
first-hand homes. It also publishes **Blocket Bostad** listings (`attributes.platform = "blocket"`), so a
separate Blocket Bostad scan would mostly find the same flats.

## 1. Purpose and coverage
Rentals only, Sweden-wide. Stockholms län had 5 162 listings on 2026-10-31; 2 320 with "own home + pets allowed";
1 149 when adding ≥2 rooms, ≤20 000 kr/month, ≥40 m². Home types: apartment, terrace_house (radhus), house/villa,
cottage (stuga), corridor rooms. Contract dates: `startDate`, `endDate` (null = "Tillsvidare", open-ended).

## 2. Access
Search results and listing pages are public, no login, no cookie wall blocking content. A Qasa account
(BankID verification) is needed only to contact landlords or sign — that is the user's job, never the agent's.
`.se` URLs redirect to `qasa.com` (an old `/find-home?...` link on qasa.se may 404: use the qasa.com URL below).

## 3. Search flow
Start page `https://qasa.com/se/sv/find-home`. Type an area in "Sök på stad eller område" and pick
**Stockholms län** → URL gets `searchAreas=Stockholms_län~~se`. "Filter" opens a dialog (Hyra, Storlek, Datum och
hyresperiod, Typ av boende, Möblering, Kategori, Tillgänglighet, Regler). Applying it rewrites the URL query.
Default sort is **Nyast** (newest first), which is what incremental scans want. Moving the map adds
`ne_lat/ne_lng/sw_lat/sw_lng` bounds to the URL: do not keep those in scan URLs.

Scripted scan URL (built from `site.yaml`):
`https://qasa.com/se/sv/find-home?searchAreas=Stockholms_l%C3%A4n~~se&sharedHome=privateHome&minRoomCount=2&rules=pets&page=1`

## 4. Filters
| Canonical filter | Qasa URL parameter | Verified |
|---|---|---|
| `max_rent_sek` | `maxMonthlyCost` (monthly cost incl. tenant fee) | yes (count changed) |
| `min_size_m2` | `minSquareMeters` | yes |
| `min_rooms_rok` | `minRoomCount` (rum, kitchen not counted) | yes |
| `pets_allowed` | `rules=pets` ("Husdjur tillåtet") | yes |
| own home, not shared | `sharedHome=privateHome` ("Eget boende"), fixed | yes |
| `move_in_from` | `earliestMoveIn` exists in the site code, value format not verified | local only |
| `contract_types` | `contractTypes` exists, values not verified; `firstHand` is in the data | local only |
| areas | `searchAreas` fixed to Stockholms län; districts filtered locally | local only |

Other parameters seen in the site code: `maxRoomCount`, `maxSquareMeters`, `minRentalLength`, `householdSize`,
`furniture`, `homeTypes`, `wheelchairAccessible`, `order`/`orderBy`, `page`.

## 5. Listing page anatomy
**Result pages** are server-rendered and embed the whole result as Apollo SSR data in a
`<script>(window[Symbol.for("ApolloSSRDataTransport")] ??= []).push({...})</script>` block:
`rehydrate.<key>.data.homeIndexSearch.documents = {nodes, totalCount, pagesCount, hasNextPage}`, about 59 nodes
per page. Each `HomeDocument` has: `id`, `monthlyCost` (rent + `tenantBaseFee`), `rent`, `roomCount`,
`bedroomCount`, `squareMeters`, `petsAllowed`, `firstHand`, `shared`, `furnished`, `homeType`, `startDate`,
`endDate`, `description`, `location {route, streetNumber (often null), locality, point {lat, lon}}`,
`uploads [{type: home_picture | home_layout_picture, order, url}]`, `platform` (qasa | blocket), `publishedAt`.
`sites/qasa/scanner.py` maps them to `ListingIn`; nothing is read from the visible HTML.

**Detail pages** `https://qasa.com/se/sv/home/<id>` carry, in Next.js flight data, the `Home` object with
`floor`, `buildingFloors`, `buildYear`, renovation years, additional costs and `traits` (balcony, french_balcony,
elevator, pets, washing_machine, dish_washer, bike_room, storage, parking ...). The scanner's `enrich` reads them
for new listings only (`fetch.details.max_per_run`). The page also shows the landlord's first name: not stored.

## 6. Pet wording
The filter "Husdjur tillåtet" (`rules=pets`) and the per-listing `petsAllowed` flag come from the landlord's house
rules; the trait `pets` appears on the detail page when allowed. Mapping: `petsAllowed: true` → `pet_status: yes`
(evidence "Qasa house rules"); `false` → `unknown` (false is also the default, so it is not treated as a "no";
the landlord is asked). Free text in descriptions may still say "inga husdjur": the evaluation run checks it.

## 7. Pagination and limits
`page=N`, about 59 listings per page, `pagesCount` in the data. Newest first, so 5 pages (≈300 listings) cover
several days of new ads. Politeness in `site.yaml`: 3 s between requests, max 5 result pages and 15 detail pages
per run. robots.txt disallows `find-home` URLs with filter parameters; the user chose to ignore it
(`respect_robots: false`) for this personal, low-volume use.

## 8. Known traps
- The same flat can come from Qasa and Blocket (`platform`), and landlords re-post ads (`lastBumpedAt`): the app's
  cross-site dedupe uses address + size + rent band, but Qasa often hides the street number, so near-identical
  flats on the same street can be merged or kept apart less reliably.
- `monthlyCost` includes the tenant service fee; `rent` alone is lower. The app uses `monthlyCost`.
- Short contracts are common (`endDate` a few months out): the contract score penalises them.
- Rooms in shared homes are excluded by `sharedHome=privateHome`; remove it to see them.

## 9. Probe history
Onboarded by browser exploration (no `findhome site probe` report: the probe cannot reach qasa.com from the
agent sandbox). Findings above, recorded 2026-10-31.

## 10. Last verified
2026-10-31, browser session (Claude desktop). **Pending:** first scripted dry run on the Mac:
`scripts/findhome scan qasa --dry-run --max-pages 1`. If it returns 0 items or an HTTP error, Qasa may reject
non-browser clients: set `status: broken` and follow `prompts/site_repair.md`.
