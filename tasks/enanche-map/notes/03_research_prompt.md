# Research prompt: geodata and services for the find_home map (Stockholm region)

Copy everything below the line into the research agent. It needs web search and page fetching. Save its answer as
`tasks/enanche-map/notes/04_data_sources.md`.

---

## Role and goal

You are a geodata research analyst. Find the **best free or low-cost data sources and services** to build an
interactive housing-search map for one person in the **Stockholm region, Sweden**. The app is personal and
non-commercial, runs locally (FastAPI + Python, Angular + MapLibre GL JS), stores static geodata as files and
does geometry in Python (`shapely`, `pyproj`, SWEREF 99 TM / EPSG:3006). No PostGIS.

The map will:
1. let the user toggle **named districts** on and off and draw shapes (brush, circle, freehand lasso, eraser) to
   define a weighted search area; a function then says whether an address is inside, or how far it is from the
   border;
2. show **transit lines and stops** (metro/tunnelbana, commuter rail/pendeltåg, tram/spårväg, light rail, local
   trains such as Roslagsbanan and Saltsjöbanan, buses, ferries) with official line colours;
3. show **points of interest** (supermarkets, gyms, vets, pharmacies, parks, and later custom categories) with
   walking minutes from any clicked point;
4. colour districts by **commute time** (public transport, with walking legs) to a few fixed points (two
   workplaces in Solna; a partner's place in southern Stockholm; Stockholm C), at given
   times of day.

Region of interest (municipalities): Stockholm, Solna, Sundbyberg, Lidingö, Danderyd, Sollentuna, Järfälla,
Huddinge, Nacka. Design for extension to the rest of Stockholm County later.

## Rules

- Cite a URL for every claim. Mark anything you could not confirm as **UNVERIFIED**.
- For each source give: **licence** (and attribution text), **access** (open download / free key / paid; rate
  limits and quotas), **format and CRS**, **coverage** of the region, **update cadence and last update seen**,
  **approx. size**, **quality notes** (gaps, naming, known problems), and a **sample download URL or API call**.
- Prefer official open data (municipalities, SCB, Lantmäteriet, Trafiklab/SL) and OpenStreetMap. Mention paid
  options only as a comparison, with prices.
- Respect terms of use: no source that forbids this use or requires scraping against its terms.
- Prefer sources current within the last 12 months. Note the date you checked each one.
- Be concrete: field names, layer names, feature counts where you can find them.

## Research questions

### A. District boundaries (the toggleable zones)
1. Stockholm stad: polygons for *stadsdelsområden* and *stadsdelar* (e.g. on the city's open data portal). Which
   layer best matches the names people use (Södermalm, Hornstull, Kungsholmen, Hammarby sjöstad)? Licence,
   format, count.
2. Each of the other municipalities in the region: is there an official district layer (kommundelar,
   stadsdelar, "nyckelkodsområden", planning areas)? Names, format, licence.
3. OpenStreetMap: `boundary=administrative` levels 9/10 and `place=suburb|neighbourhood|quarter` polygons in the
   region. How complete and consistent? Give an example Overpass query that returns them as polygons.
4. SCB statistical areas **RegSO** and **DeSO** (2025 edition if available): download, licence (CC0?), counts in
   the region, how their names relate to district names.
5. Lantmäteriet open data (e.g. district / registration area layers): anything useful and openly licensed?
6. **Recommendation**: which layer (or combination) to use for toggleable zones in each municipality, at a
   granularity useful for scoring (roughly 0.5-5 km² per zone), and how to handle gaps and overlaps.

### B. How listing sites name areas (to match listings to zones and to generate site searches)
1. Qasa (`searchAreas` parameter, e.g. `Stockholm~~se`), Blocket Bostad, Bostadsförmedlingen, Samtrygg,
   Hemnet/Booli (for a later buy mode): which area names or ids do they use, and is there a public list or
   autocomplete endpoint that is allowed by their terms and robots.txt? Only document; do not scrape.
2. Is there an open gazetteer that maps neighbourhood names and aliases (e.g. "SoFo", "Hornstull", "Hammarby
   sjöstad") to polygons or points? (OSM names, Wikidata, Lantmäteriet ortnamn.)

### C. Public transport network data (lines, stops, colours)
1. Trafiklab: **GTFS Regional Static** for SL (and "GTFS Sverige 2"): key registration, quotas, does it include
   `shapes.txt`, `route_color`, route types for metro/commuter rail/tram/bus/ferry? File size, update frequency,
   licence (CC0 / CC-BY?).
2. SL's newer open APIs (journey planner v2, transport/lines, departures): which need no key, what they return,
   limits.
3. OSM route relations (`type=route`, `route=subway|train|tram|light_rail|bus|ferry`) for the region: completeness
   versus SL, colours (`colour` tag), example Overpass query.
4. Official line colours for Stockholm metro (green, red, blue lines), pendeltåg, tram lines, Roslagsbanan,
   Saltsjöbanan, Lidingöbanan, Nockebybanan: source of truth.
5. Station entrances (metro *uppgångar*): available in GTFS (`location_type=2`) or OSM (`railway=subway_entrance`)?
6. Ready-made **vector tiles** with transit layers usable in MapLibre (free tier), so lines need not be built
   locally.
7. **Recommendation** for lines + stops, with a processing outline (e.g. GTFS → GeoJSON per mode, simplified).

### D. Routing: transit journeys and isochrones
1. Trafiklab **ResRobot v2.1** (Reseplanerare): does it return legs with walking parts and coordinates? Free tier
   limits. Can it do arrive-by?
2. SL journey planner v2: same questions, and whether it needs a key.
3. Isochrones / many-to-many travel times for ~150 district centres × 4 destinations × a few time windows:
   compare **OpenTripPlanner 2** (self-hosted with SL GTFS + OSM extract; memory/disk needs for this region),
   **r5py / R5**, **Valhalla** with transit, **TravelTime API** (free tier?), **Google Routes** (price per element).
   Give setup effort, cost, and accuracy for Stockholm.
4. **Recommendation**: cheapest reliable way to get (a) a detailed itinerary for one clicked point and (b) a
   travel-time matrix for all districts.

### E. Walking routing (POI distances)
1. **OpenRouteService** (free key quotas for directions, matrix and isochrones), **GraphHopper** (free tier),
   **Valhalla** public instance (terms), **OSRM** with the foot profile (self-hosted only?).
2. Is a straight-line × detour-factor estimate good enough within ~1 km in Stockholm (water, rail barriers)?
   Any published detour factors?
3. **Recommendation** with quotas versus expected use (one click = ~8 POI categories × 3 nearest).
4. **Address autocomplete** for a settings form (a few dozen lookups per week): ORS geocode/autocomplete (Pelias)
   quotas with the free key, Photon (photon.komoot.io) terms for a personal app, any other free option. Note that
   the public Nominatim API forbids autocomplete.

### F. Points of interest
1. OSM via Overpass for: supermarkets and grocery chains (ICA, Coop, Willys, Hemköp, Lidl, City Gross), gyms
   (SATS, Nordic Wellness, Friskis&Svettis, Actic, STC, EVO, climbing gyms), vets and animal hospitals,
   pharmacies (Apotek Hjärtat, Kronans, Apoteket), parks and nature reserves, libraries. Tagging used, estimated
   completeness in Stockholm, example queries. Overpass usage policy (rate limits, preferred instances).
2. Official or chain open data (store locator feeds with open licences) that could fill OSM gaps.
3. Google Places (New) and alternatives (Foursquare OS Places, Overture Maps places): licence, cost, quality in
   Stockholm. Overture **places** and **transportation** themes: licence and whether usable here.
4. **Recommendation**: primary source per category, refresh cadence, and a local cache format.

### G. Base map and context layers
1. Free MapLibre styles with a **dark** variant (OpenFreeMap liberty/positron/dark, Protomaps, MapTiler free
   tier, Stadia): terms, limits, attribution.
2. Optional context layers for a district inspector, each with licence and format: noise maps (Stockholm
   *bullerkartor*), green space, population/age/income per DeSO (SCB), rent levels per area (SCB, Hyresgästföreningen),
   the Police's list of vulnerable areas (*utsatta områden*), flood risk. Mark which are polygons and how current.

### H. Front-end tooling
1. Drawing in MapLibre GL JS: **Terra Draw** (freehand, circle, polygon, select, adapters), maplibre-gl-draw /
   mapbox-gl-draw compatibility, and how to implement a **brush** (paint) tool: buffer a stroke path, or paint a
   hex/H3 grid? Licence, maintenance status, bundle size, Angular integration notes.
2. Client-side geometry: **turf.js** modules needed (union, difference, buffer, point-in-polygon, distance to
   line), bundle impact; server-side equivalents in shapely.
3. Examples of map apps with a resizable three-panel layout (layers left, map centre, inspector right) worth
   copying.

## Output format

Markdown, in this order:
1. **Executive summary**: 10 bullets max, the recommended source for each need (A-H) and why.
2. **Decision table**: need · recommended source · runner-up · licence · access/key · cost · effort.
3. One section per letter (A-H) with the per-source details listed in Rules, then the recommendation.
4. **Keys to register**: list with signup URL, free quota and what the app uses it for.
5. **Attribution block**: the exact attribution strings the map must show.
6. **Risks and open questions**: what you could not verify.
7. **Sample commands**: curl/Overpass/download commands for the top recommendation of A, C, F.
