# QA Planning: Enhance the map (explorer, search area, transit and POI layers)

**Objective:** Plan an interactive 3-panel map with switchable modes: explore transit lines and POIs with an
inspector, define the search area (brush, circle, freehand lasso, toggleable districts) that becomes an
`address → inside / distance to border` function used by scoring, derive search-area lists for sites, and write
a rich research prompt for an external agent to find the data sources.
**Started:** 2026-10-31
**Status:** Done (plan generated: [master_plan.md](master_plan.md))

Research so far: [notes/01_current_state.md](notes/01_current_state.md).

# Topic (1): Search area model and scoring ######################

## Q1:
What geographic extent and zone level should the toggleable zones use?
- Extent: Stockholm municipality only, or the core of Stockholm county too (Solna and Sundbyberg, where both your
  workplaces are, plus Nacka, Lidingö, Danderyd ...)?
- Zone level: Stockholm's ~13 *stadsdelsområden* (too coarse), ~130 *stadsdelar* (district names people and sites
  use: Hornstull is in Södermalm, etc.), or SCB statistical areas *RegSO* / *DeSO* (uniform across every
  municipality, but their names are not what listing sites show).
Suggestion: core county municipalities, with named districts (stadsdelar / kommundelar) as the toggle level.

## A1:
Something that is usable to define a zone but not too fine-grained for practical scoring and visualization. I trust your judgment on the appropriate level of granularity. I think that depends also on the available information from listing sites and other data sources, even to delimitate that area accurately.

## R1:
Decision (delegated): **named districts** as the toggle level, because they are what listing sites and people use
("Hagalund", "Hornstull" style names), so the same zones can match a listing's `area` text and generate site
search lists (Topic 5). Stockholm municipality: *stadsdelar*; other municipalities: their district division
(kommundelar / OSM `admin_level` 9-10 or `place=suburb` polygons). Fallback where no usable district layer
exists: SCB *RegSO* (CC0, uniform), renamed after the dominant district. The research prompt asks the external
agent to confirm which layer exists per municipality. Extent: a `geo.region` list of municipalities, defaulting to
the ones within the commute prefilter radius of your points (Stockholm, Solna, Sundbyberg, Lidingö, Danderyd,
Sollentuna, Järfälla, Huddinge, Nacka), extendable later.
**Update after research** ([notes/05_research_review.md](notes/05_research_review.md)): OSM has district
polygons only for 47 of Stockholm's 117 stadsdelar and none in the other 8 kommuner, so the toggle level becomes
**SCB RegSO 2025** everywhere: 263 zones in the region (Stockholm 127, Solna 22, Sundbyberg 11 ...), CC0, one
consistent coverage, mostly familiar names ("Arenastaden", "Hallonbergen Västra"). Grouped in the panel by
kommun → Stockholm stadsdelsområde → zone, with an alias file for popular names (Hornstull, SoFo).

## Q2:
How should the drawn and toggled pieces combine, and what happens outside?
Suggestion:
- area = union of "include" shapes minus "exclude" shapes (an eraser brush);
- inside → full credit;
- outside but within a buffer (for example 1.5 km from the border) → credit falls linearly to 0, and the listing
  stays visible so you can still evaluate it;
- beyond the buffer → hard reject `outside_search_area`.
Does that match what you want, and roughly what buffer distance? Should a defined area replace the text
`areas_include` / `areas_exclude` filters?

## A2:
yeeess.

## R2:
Accepted. Buffer not specified: default 1.5 km, configurable. When a search area is defined it replaces the
text `areas_include` / `areas_exclude` filters; with no area defined the text filters keep working as today.

## Q3:
One search area, or several named areas with their own weight (e.g. "Core" 1.0, "Acceptable" 0.7, "Only if
great" 0.4), where a listing gets the best one that contains it?

## A3:
I think one search area but actually being able to apply different weights to different selected areas is interesting and could give more flexibility in scoring and visualization. I think we can exploit the 2 new boxes we are going to add to the visualization to show the weighted contributions of each area. also to show how each listing is affected by the different areas it falls into.

## R3:
One search area made of **weighted pieces** (toggled districts, brush/circle/lasso shapes, eraser shapes).
Proposed function for a location p: `area_score(p) = max_i( w_i × f(d_i) )`, where `d_i` is the distance from p
to piece i (0 inside), `f` falls linearly from 1 at the edge to 0 at the buffer. Overlaps take the best piece;
erasers cut every piece. The right panel shows each piece's contribution for a listing or a test point, and the
winning piece. See Topic 1 Q4 to confirm.

# Topic (2): Map modes and panels ######################

## Q1:
Proposed modes, switched from a bar at the top of the map:
1. **Explore**: listings, transit lines and stations, POIs; click anything to inspect it in the right panel.
2. **Area**: draw / erase (brush, circle, freehand lasso) and toggle districts on and off; the right panel shows
   area size, the district list and how many listings fall inside, near or outside.
3. **Connectivity**: each district coloured by commute time to your points (work, girlfriend), using the existing
   commute engine from each district's centre (one sample per time window, cached).
Is this the right set? Anything missing (for example a Listings mode, or comparing two districts side by side)?
What must the inspector show when you click a district or an arbitrary spot: commute times to your points,
nearest POI per category with walking minutes, transit lines nearby, listings inside?

## A1:
I think would be helpful also to being able to test random points within the map to see how they score and how they are affected by the different areas and weights. Would be intersting to being able to also visualize the near points of interest and their walking distances from those points, and how we can reach this points if with a combination of walking and transit options. maybe we can keep explore and connectivity modes separate but allow some interaction between them for better analysis, I don't know we set a point and then we can switch mode or we should have some small insight from the connectivity mode overlaid in the explore mode, amybe as a mini-overlay or tooltip, and when you change the mode we should update the overlay accordingly. But your point sounds realy good.

## R1:
Keep the three modes and add a **test point (probe) tool** available in every mode: drop a pin anywhere and the
right panel shows its area score with per-piece breakdown, the nearest POIs per category with walking minutes
(drawn as lines on the map), and the commute to your points as an itinerary (walk + transit legs, from ResRobot's
journey legs). The pin survives a mode switch; each mode adds its own view of it (Area: which pieces it falls in;
Connectivity: travel times; Explore: POIs and lines nearby). Explore shows a small connectivity overlay (legend
chip + tooltip with the district's commute minutes) so you get the insight without switching mode.
Note: the work points are missing from the map today because of a geocoding bug, see
[notes/02_geocode_bug.md](notes/02_geocode_bug.md) and Topic 3 Q2.

# Topic (3): Data sources and storage ######################

## Q1:
Storage and geometry stack. Suggestion: static geodata (district polygons, transit lines and stops) as files
under `data/geo/` downloaded by a fetch script (with licence and attribution), the search area as a YAML/GeoJSON
config file (validated and part of the config hash, so scores go stale when it changes), and geometry in Python
with `shapely` + `pyproj` (accurate metres in SWEREF 99 TM). No PostGIS for now (a few thousand listings at
most). OK, or would you rather add PostGIS?

## A1:
I think make sense to keep the geometry stack simple with static geodata files and Python libraries for now. just rember that for now the target is the area areound Stockholm, so we don't need everything we can focus on the relevant geodata for that region for now, leaving the door open to explan the configuration and available data as needed in the future.

## R1:
Accepted: static files + `shapely`/`pyproj`, no PostGIS. Scope the datasets to the Stockholm region (Topic 1 R1)
behind a `geo` config section (region, datasets, attribution) so other regions can be added later.

## Q2:
The geocoding bug ([notes/02_geocode_bug.md](notes/02_geocode_bug.md)): both work addresses end in "Sweden",
the geocoder appends ", Sverige" anyway, Nominatim finds nothing, and the miss is cached for 365 days. Fix it
now as a small separate change (suffix rule, short TTL for misses, CLI uses the same path, unit test), or make it
step 0 of this plan? Quick unblock either way: add `coords` to both work points in `locations.yaml`.

## A2:
ok, I removed ",Sweeden" suffix and now seems to work correctly, I can see the points on the map.
Shold we fix it anyway? maybe we can just add a sugegstion, is it possible to find close matches for the addresses automatically while we are writing? that could help avoid future geocoding misses and avoid to add fancy logic.

## R2:
Yes, still fix it, but minimally: the same suffix rule geocodes **listing** addresses too
([api/routers/scoring.py](../../backend/src/findhome/api/routers/scoring.py) L31), so any listing whose address
contains "Sweden" would silently fail and stay cached as a miss for a year. Fix = treat "sweden" like "sverige"
and cache misses for one day. That is two lines plus a test: step 0 of the plan.
Address suggestions while typing: good idea, but **not with Nominatim**. Its usage policy forbids autocomplete
("Auto-complete search ... you must not implement such a service on the client side using the API",
operations.osmfoundation.org/policies/nominatim, checked 2026-10-31). Options: OpenRouteService's geocoder
(Pelias, has an autocomplete endpoint, uses the ORS key you will register anyway, see Topic 4) or Photon
(komoot, OSM-based, built for search-as-you-type, fair-use public instance). Proposed flow in the Locations
editor: debounced suggestions as you type → you pick one → a small map preview shows the pin → Save writes both
`address` and `coords` to `locations.yaml`, so points never depend on runtime geocoding again. The research
agent should confirm ORS geocode quotas and Photon's terms (added to the prompt, section E).
# Topic (4): Routing and transit data quality ######################

## Q1:
The probe and the Connectivity mode need data the app does not have yet:
- **Walking minutes to POIs**: a straight-line estimate (free, instant, less accurate around water and rail) or
  real walking routes (OpenRouteService free key, ~2,000 requests/day, or a self-hosted router)?
- **Transit lines on the map**: SL's GTFS feed from Trafiklab (free key, "GTFS Regional Static": official line
  shapes, colours, stops) or OSM route relations (no key, completeness varies)?
Are you OK registering for free Trafiklab and OpenRouteService keys? The research prompt compares the options.

## A1:
Open route service seems like a reasonable choice for walking minutes, given the free key and request limits. We can register for the free key and integrate it into the app. does it make sense to cache them locally to avoid hitting the request limit repeatedly on the same ones? amybe let's add the cache on the db or in gitignored files

## R1:
ORS for walking. Cache: in the database, reusing the existing `routing_cache` table (provider `ors`, mode
`walk`, rounded origin/destination, TTL from `cache.routing_ttl_days`, 30 days): same pattern as the other
providers, survives restarts, no extra files. One test-point click uses one ORS **matrix** call (origin × nearest
POIs of every category) instead of one call per POI; the research prompt asks for the exact matrix quota. The
straight-line estimate stays as fallback when the key is missing or the quota is used up (same "three errors
then haversine" rule as routing). ORS has no public transport: transit itineraries stay on ResRobot.
Transit lines (not answered): you already have a Trafiklab account (the ResRobot key), so the plan assumes a
second free Trafiklab key for **GTFS Regional Static** (SL lines, shapes, colours, stops), converted once by a
script into GeoJSON under `data/geo/`, with OSM route relations as fallback. Say so if you disagree.

# Topic (5): Search area to site searches ######################

## Q1:
"Generate a list of areas where to search": should the plan (a) only show and export the district names inside
the area (for you and the agent), or (b) also translate them into each site's own search parameter (e.g. Qasa
`searchAreas`, Bostadsförmedlingen area ids) through a per-site alias table, written into `sites/*/site.yaml`?
(b) needs the district names each site uses, which the research prompt also asks for.

## A1:
I think for now we can pass the district names directly and let the agent relate the ones available in the site-specific search parameters as needed. in any case for each houes we will extract the address anyway extract the geo coordinates from it and compare it with the coordinates of the selected area in the app to ensure it falls within the intended search area. the geo location tool wiil take care of this automatically. this approach avoids the need for maintaining a separate alias table for each site, simplifying the workflow while still ensuring accurate search area matching. Of course the extrractor agent anyway should try to search for houses near the suggested regions not on the other side of sweeden..

## R1:
Option (a), no per-site alias tables. Plan:
- `findhome area show` (and the history digest) list the search area for agents: district names with weight, the
  bounding box, and the centre, so a scan stays in the region even on sites with their own area names.
- Every listing is geocoded (coordinates from the site when present, else `address_raw`) and scored by the
  geometric area function; the text match on the `area` field is no longer used once an area is defined.
- Listings without coordinates after geocoding get `area_unknown` (not rejected, shown in the inspector) so a bad
  address never hides a listing silently.
- The run_scan / browser_scan prompts get one rule: search only the listed districts or the nearest wider area the
  site offers (e.g. "Stockholm" or "Solna"), never outside the bounding box.

# Topic (6): Confirmations before the plan ######################

## Q1:
Area function (from Topic 1 R3): `area_score = max over pieces of (piece weight × distance falloff)`, falloff 1 at
the edge → 0 at the buffer (default 1.5 km). Beyond the buffer: **reject** (`outside_search_area`, hidden unless
"show rejected") or **score 0** but still listed? And how does the area enter the total score: a new preference
group `area` with its own weight in `profile.yaml` (suggested 3, like cost)?

## A1:
The area function should reject listings outside the buffer by default, hiding them from the main listing but keeping them accessible in the inspector. The total score incorporates the area score as a separate preference group `area` with its own weight in `profile.yaml`.

## R1:
Decided:
- Beyond the buffer: hard filter reason `outside_search_area` in `rejected_by` (hidden by "hide rejected" on
  Candidates and by the map's rejected layer toggle). The inspector still lists rejected listings when you click a
  zone or a test point, greyed, with the distance to the border.
- New preference group `area` (default weight 3) scored by the area function; `None` when the listing has no
  coordinates (`area_unknown`), so it drops out of the weighted mean instead of scoring 0.
- Buffer in the area config file (default 1500 m). Changing the area changes the config hash, so scores go stale
  and the UI offers "Recompute scores".
## Q2:
Panel layout on the Map page. Suggestion: the app's left menu collapses to an icon rail on this page; three
resizable boxes (left controls, centre map, right inspector), each side box collapsible, widths remembered per
browser (like the debug UI). On narrow screens the side boxes become drawers. OK?

## A2:
the layout seems good, I just have another suggestion for the left menu, it becomes part of the left box, like in the debug Ui there should be a bubble containing the pages, and they should be allowed to have childs like the tools section, then in the map scenario the controls append with collapasable bubbles under the menu ones that can be collpsed as well but as bubbles inside the left box. Same setup of the debug UI.

## R2:
This becomes an **app-wide shell change**, not only the Map page, matching the debug UI:
- Box 1 (left, resizable, collapsible): a **navigation bubble** (pages, with child entries) followed by
  **page bubbles** that the active page contributes (Map: layers, tools, area pieces, legend). Every bubble is
  collapsible; collapsed state and box widths are remembered in localStorage.
- Box 2 (centre): the routed page.
- Box 3 (right, resizable, collapsible): optional per page; the Map uses it as the inspector. Other pages leave it
  closed (Detail could use it later).
- Map modes become child routes (`/map/explore`, `/map/area`, `/map/connectivity`) shown as children of "Map" in
  the nav bubble, plus a compact switch above the map; the route is the single source of truth, so a mode can be
  bookmarked.
- Mechanism: a small layout service where a page registers `TemplateRef`s for its left bubbles and right panel
  (Angular `ngTemplateOutlet`), removed on destroy. The dark steel/violet theme carries over (bubbles = the debug
  UI's settings-card look).
## Q3:
Test points: keep them only for the session, or save named test points ("Friend's street", "Hornstull idea")
so you can reopen and compare two or three side by side in the right panel? Saved ones would live in a small
gitignored file or a DB table, not in the scoring config.

## A3:
yeah make sense, let's add it as alpha feature not sure if we are going ot keep it, but for now we can add it.

## R3:
Alpha, isolated so it is easy to drop: one DB table `probes` (name, lat, lon, note, created_at) in its own
migration, one small router (`/api/probes`), one right-panel compare view (2-3 probes side by side: area score,
commute minutes, nearest POIs). Marked "alpha" in the UI. Nothing in scoring depends on it.
## Q4:
POI categories: the inspector starts from `config/poi.yaml` (groceries, metro, pendeltåg, bus stop, park, vet,
pharmacy, gym). Do you want specific chains or extras from day one (e.g. only SATS / Nordic Wellness gyms,
climbing, swimming pools, libraries, pet shops), and should the POI layer also feed the currently disabled
`neighbourhood` score group, or stay visual only in this task?

## A4:
for now I need SATS as I have a membership there and want to track its locations. if necessary we will add other in the future. Can you add a fancy icon for sats gyms? would be preaty or add a dumbel on the map for that, also for other things I would like personalized icons as well to make things clear and more GTA map like.

## R4:
- New POI category `sats` in `config/poi.yaml`: OSM `leisure=fitness_centre` + `brand=SATS` (verify the tag on a
  few Stockholm clubs with the first fetch; fall back to `name~SATS`).
- **Icon system** for every marker (POIs, your points, listings, stations): round "blip" badges in the category
  colour with a white glyph, a dark outline and a soft glow, drawn from SVG into MapLibre images at runtime
  (`map.addImage`), so they stay crisp on the dark map. `poi.yaml` and `locations.yaml` categories get `icon` +
  `color`; the legend bubble shows them.
- SATS: a **dumbbell glyph on a SATS-red badge**, not the SATS logo (trademark; keep it out of the repo).
- Glyph source: an open icon set (Tabler Icons MIT, or Maki/Temaki CC0) copied as SVG into the frontend
  assets with its licence file.
- `neighbourhood` scoring was not answered: POIs stay **visual + inspector only** in this task; the score group
  stays disabled (backlog `poi-layer` keeps that part).
## Q5:
Scope and order. Proposed delivery in this order, each usable on its own:
0. geocode fix + address suggestions in Locations;
1. 3-box layout + mode bar + layer panel (existing layers);
2. district data + search area editor + area function in scoring;
3. POIs + ORS walking + test point inspector;
4. transit lines/stops layer;
5. Connectivity mode (district commute matrix).
Anything to move earlier, or drop from this task (e.g. Connectivity to the `map-3d` backlog item)?

## A5:
no i think it's fine

## R5:
Order confirmed. With R2 the first step grows: step 1 is the app-wide 3-box shell (nav bubble + page bubbles +
optional right box), then the Map page moves into it. Output mode: **advanced** (master plan + one sub-plan per
step), as proposed at the start; nobody objected.

# Summary ######################

**Goal:** turn the Map page into an exploration and search-area tool, inside an app-wide 3-box layout.

**Layout (all pages):** left box = nav bubble (pages with child entries) + collapsible page bubbles; centre =
page; right box = optional inspector. Resizable, collapsible, remembered per browser. Debug UI look, dark
steel/violet theme.

**Map modes** (child routes): Explore (listings, transit, POIs, small connectivity overlay), Area (editor),
Connectivity (zones coloured by commute time to your points). A **test point** works in every mode and survives
mode switches; saved, named test points with side-by-side compare are an **alpha** feature.

**Search area:** one area made of weighted pieces: toggled **RegSO 2025 zones** (263 in Stockholm, Solna,
Sundbyberg, Lidingö, Danderyd, Sollentuna, Järfälla, Huddinge, Nacka; grouped kommun → stadsdelsområde → zone;
alias file for popular names), plus brush / circle / freehand lasso shapes and eraser shapes.
`area_score = max(weight × linear falloff to 0 at the buffer)`, buffer default 1.5 km. Beyond the buffer:
reject `outside_search_area`; no coordinates: `area_unknown` (not rejected). New `area` preference group
(default weight 3). A defined area replaces the text `areas_include` / `areas_exclude` filters. The area is a
config file in the config hash.

**Agents and sites:** no per-site alias tables. Agents get the zone names, bounding box and centre
(`findhome area show`, history digest) and must stay inside; every listing is checked by coordinates.

**Data:** static files under `data/geo/` from fetch scripts: SCB RegSO 2025 (CC0), Stockholm stadsdelsområden
from OSM (grouping only), SL GTFS Regional (new free Trafiklab key, weekly), line colours in a config file, OSM
POIs fetched region-wide on a schedule. Geometry with shapely + pyproj (EPSG:3006); no PostGIS.

**Services:** ResRobot for test-point itineraries and the zone × point matrix (~2,100 calls per refresh, cached in
`routing_cache`); OpenRouteService (new free key) matrix for walking minutes, cached in `routing_cache`,
straight-line fallback. Address suggestions in Locations via ORS geocode or Photon (never Nominatim), saving
both address and coords.

**POIs and icons:** `poi.yaml` categories plus `sats` (dumbbell on SATS-red badge, no logo). GTA-style round
blip icons for all markers from an open icon set. POIs are visual + inspector only; `neighbourhood` scoring stays
out of scope.

**Order:** 0 geocode fix + address suggestions → 1 3-box shell + map in it + mode routes + layer bubble →
2 zones + area editor + area scoring → 3 POIs + icons + ORS + test point (+ alpha saved probes) → 4 transit layer
→ 5 Connectivity mode. Each step usable on its own; the guide is updated with each.