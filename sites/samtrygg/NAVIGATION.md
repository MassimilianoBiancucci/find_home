# Samtrygg — navigation guide

Status: **unverified stub**. Second-hand rentals with landlord vetting and contract handling. Hypothesis: public result list, pets shown on listing pages.

How to use this site effectively for the find_home search. Keep each section short; update one
section at a time. Mark anything not yet confirmed with **To verify**.

## 1. Purpose and coverage
**To verify.** Rent or buy, regions covered, first-hand / second-hand / sublet, typical listing volume for Stockholm.

## 2. Access
**To verify.** Login needed? BankID? Cookie wall? Rate limits seen? (`auth.mode` in site.yaml must match.)

## 3. Search flow
**To verify.** Step-by-step clicks or URL parameters to reach a filtered Stockholm result list.

## 4. Filters
**To verify.** Which canonical filters (config/filters_catalog.yaml) the site can apply and how; which are `local_only`.

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
- `detail_extract.js` reads all of this; `detail_to_listing` maps it. Below the ad, "Liknande (lediga) bostäder"
  cards carry their own dates and pet tags: never read them as the ad.

## 6. Pet wording
The amenity list has a row "Husdjur tillåtet": ticked (`li.amenity`, plus the card tag "Husdjur ok" and a JSON-LD
amenity) → `yes`; unticked (`li.amenity.amenity--off`, "Husdjur tillåtet — saknas", like "Diskmaskin — saknas") →
`ask`: the landlord did not tick it, and the site's help says to ask in the viewing chat, as landlords are often
flexible. A card without the "Husdjur ok" tag is not evidence: the object page decides. The search's pet filter
(`features=10`) is not used, so the `ask` listings are scanned too.

## 7. Pagination and limits
**To verify.** How pages work, items per page, maximum pages, infinite scroll.

## 8. Known traps
**To verify.** Duplicates, sponsored items, stale ads, scam patterns, listings that redirect elsewhere.

## 9. Probe history
**To verify.** Links to `probe/*.md` reports.

## 10. Last verified
**To verify.** Agent run id and date.
