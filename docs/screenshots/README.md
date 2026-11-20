# README screenshots

These images capture the running Angular app at `http://localhost:4400/` (dark theme unless noted, 1600 × 1000 at
1.5× scale, WebP):

| Image | Page | Shows |
|---|---|---|
| [candidates.webp](candidates.webp) | Candidates | The table, the filters bubble, the home card on hover |
| [tooltips.webp](tooltips.webp) | Candidates | The home card, the ad-freshness clock, the contract and the issues tooltips |
| [listing.webp](listing.webp) | A listing | Photos, facts, issues, map with walks, this home against its zone, routes, score, sources |
| [explore.webp](explore.webp) | Map → Explore | Houses by score, a pinned home in the Inspector, the Layers sheet |
| [area.webp](area.webp) | Map → Area | A search area of the zones within 25 minutes (Reach), and the listings inside it |
| [connectivity.webp](connectivity.webp) | Map → Connectivity | Every zone by its weighted minutes to the points |
| [zone.webp](zone.webp) | Map → Zone | The 3D zone view focused on a home |
| [locations.webp](locations.webp) | Locations (light) | Points, their maps, trips and time windows |
| [sites.webp](sites.webp) | Sites | Website integrations and their scan methods |
| [runs.webp](runs.webp) | Runs | Scans and agent runs |
| [jobs.webp](jobs.webp) | Jobs | The jobs and their last runs |
| [settings.webp](settings.webp) | Settings (light) | `zone.yaml` in the editor |

Capture the UI after its data and map tiles finish loading. Crop out browser tabs, bookmarks and other browser
chrome. Keep map attribution visible. Use public or fictional data only, following the
[personal-data principle](../../guide/principles/personal_data.md):

- Listings are public ads from the rental sites.
- Personal map points, commute minutes to them and drawn search areas never appear. These images replace them in
  the browser while capturing (nothing is saved): the points and their trips come from
  [`config/locations.example.yaml`](../../config/locations.example.yaml), the commute matrix (every zone's minutes to
  the example points) is computed from their distance with some spread, the search area is the Reach of those
  minutes, the point names in the house analyses are renamed to the example ones and their minutes recomputed the
  same way. All of these minutes are illustrative.
- Settings shows a non-personal file (`zone.yaml`), never `profile.yaml`, `locations.yaml`, `search_area.yaml` or
  the `.env` files. No private notes, agent logs or score tooltips with personal targets.

The sidebar and README share the [dark wordmark](../../frontend/public/brand.svg) and
[light wordmark](../../frontend/public/brand-light.svg), including the same [house icon](../../frontend/public/favicon.svg)
used for the browser tab.
