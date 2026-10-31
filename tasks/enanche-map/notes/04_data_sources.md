# 04 · Data sources and services for the find_home map (Stockholm region)

Answer to [03_research_prompt.md](03_research_prompt.md). All sources checked **2026-10-31** unless noted.
**UNVERIFIED** = could not confirm from a primary source in this session (page was JS-only, blocked to
crawlers, or not found). Overpass and other live endpoints could not be queried from the research
environment, so feature counts from OSM are estimates to confirm with the sample queries in section 7.

---

## 1. Executive summary

1. **Districts (A)**: in Stockholm stad use the **117 *stadsdelar*** (OSM `admin_level=10`, mirrored from the
   city's Stadskarta); group them under the 14 *stadsdelsnämndsområden* (`admin_level=9`). Outside Stockholm
   use **OSM `admin_level=10` / `place=suburb|quarter` polygons** where they exist and **SCB RegSO 2025 (CC0)**
   as the uniform fallback, renamed after the dominant district. Keep a hand-written alias table for
   non-official names (Hornstull, SoFo, Hammarby sjöstad).
2. **Listing-site names (B)**: none of the sites publishes an open area list. Qasa only needs the coarse
   `searchAreas` value already in use; match listings to zones **by coordinates** (point-in-polygon), and
   use names only as a fallback via the alias table.
3. **Transit network (C)**: **Trafiklab GTFS Regional SL** (CC0, free key, daily update, 46 MB zip,
   614 routes, includes `shapes.txt`). It does **not** appear to carry `route_color`, so line colours come
   from a small hand-maintained config. OSM route relations are a cross-check only.
4. **Clicked-point itinerary (D-a)**: **ResRobot v2.1** (already integrated, CC0, coordinates as origin,
   `WALK` legs, `searchForArrival=1` for arrive-by). Use **SL Journey Planner v2** (no key) as a second
   provider when you need SL-specific detail.
5. **Travel-time matrix (D-b)**: ~150 centroids × 4 destinations × 3 windows ≈ **1,800 ResRobot calls per
   refresh**, inside the free quota you already have (30k/month). Self-hosted **r5py** or **OTP 2** only if
   you later want true isochrones or many more origins.
6. **Walking (E)**: straight-line × **1.3** detour factor for ranking, then **OpenRouteService matrix** (free:
   500 matrix calls/day, 40/min) for the 3 nearest per category: one click = 1 matrix call. Self-host OSRM
   foot only if you outgrow that.
7. **POIs (F)**: **OpenStreetMap**, fetched once a week for the whole region (Overpass with a User-Agent, or
   a Geofabrik extract filtered locally), cached as GeoParquet/GeoJSON per category. Overture Places as an
   optional gap-filler (mixed CDLA-Permissive-2.0 / Apache-2.0 / CC0). Google Places only as a paid
   comparison.
8. **Base map (G)**: keep **OpenFreeMap** (no key, no limits, commercial OK); `dark` or `fiord` for dark mode.
9. **Context layers (G)**: SCB DeSO 2025 statistics (CC0) are the easy win; noise, flood and *utsatta
   områden* exist but mostly as viewers/PDFs, not open vector downloads.
10. **Front end (H)**: **Terra Draw** (MIT, v1.5.0, MapLibre adapter) for polygon/circle/freehand/select;
    implement the **brush** yourself as a buffered stroke unioned server-side in shapely (EPSG:3006);
    add `@turf/*` per-module only for instant client previews.

---

## 2. Decision table

| Need | Recommended source | Runner-up | Licence | Access / key | Cost | Effort |
|---|---|---|---|---|---|---|
| District polygons, Stockholm stad | OSM `admin_level=10` stadsdelar (117) | Stadskarta "Stadsdelar" layer from dataportalen | ODbL (OSM) | Overpass / extract, no key | 0 | Low |
| District polygons, other kommuner | OSM `admin_level=10` + `place=suburb\|quarter` | SCB RegSO 2025 | ODbL / CC0 | no key | 0 | Medium (gap filling) |
| Uniform statistical zones | SCB RegSO 2025 / DeSO 2025 | Lantmäteriet Distrikt (2,523, static) | CC0 | WFS, no key | 0 | Low |
| Neighbourhood aliases | Own alias table + OSM `name`/`alt_name` + Wikidata | Lantmäteriet Ortnamn | ODbL / CC0 | no key | 0 | Low |
| Lines, stops, shapes | Trafiklab GTFS Regional SL | OSM route relations | CC0 | free Trafiklab key | 0 | Medium |
| Line colours | Hand config (from SL network map) | OSM `colour` tag | n/a | n/a | 0 | Low |
| Ready-made transit tiles | Transitland vector tiles | Thunderforest Transport | Transitland terms (attribution) | free key | 0 within fair use | Low |
| Clicked-point itinerary | ResRobot v2.1 `/trip` | SL Journey Planner v2 | CC0 | free key / no key | 0 | Low (exists) |
| District × destination matrix | ResRobot from centroids, cached | r5py (self-host) | CC0 / MIT-GPL | key / local | 0 | Low / Medium |
| Isochrones (optional) | r5py or OTP 2 `SandboxAPITravelTime` | TravelTime API (free key, non-commercial) | MIT/GPL, LGPL | local | 0 | Medium-High |
| Walking minutes to POIs | ORS Matrix (foot-walking) | Self-hosted OSRM foot / GraphHopper free | ORS terms, OSM ODbL | free key | 0 | Low |
| POIs | OSM (weekly regional fetch) | Overture Places | ODbL / mixed permissive | no key | 0 | Low |
| Base map + dark | OpenFreeMap liberty / dark / fiord | Protomaps API (free non-commercial) | OpenMapTiles + OSM attribution | no key | 0 | None |
| Drawing | Terra Draw + MapLibre adapter | maplibre-gl-draw | MIT | npm | 0 | Medium |
| Geometry | shapely + pyproj server-side; `@turf/*` client previews | — | BSD / MIT | pip / npm | 0 | Low |

---

## 3. Details by topic

### A. District boundaries

#### A1. Stockholm stad: *stadsdelsnämndsområden* and *stadsdelar*

- **What exists**: the city's Stadskarta product has layers *Stadsdel* ("Stockholms stads 117 stadsdelar") and
  *Stadsdelsnämndsområde* (14 board areas, each containing several stadsdelar)
  ([product spec, 2018](https://dataportalen.stockholm.se/dataportalen/Data/Stadsbyggnadskontoret/Allm%C3%A4n-Produktspecifikation_SK_p84.pdf)).
  Both are listed on Dataportalen as "SBK Stadskarta - Stadsdelar"
  ([metadata](https://dataportalen.stockholm.se/dataportalen/GetMetaDataById?id=a7b641e1-1310-4ca6-9b32-87b9482262db))
  and "SBK Stadskarta - Stadsdelsnämndsområden"
  ([metadata](https://dataportalen.stockholm.se/dataportalen/GetMetaDataById?id=719b8823-a3f2-41a1-9b32-0259e60afda7)).
  Since 2023 Rinkeby-Kista + Spånga-Tensta became **Järva stadsdelsområde** (OSM relation start_date 2023-07-01,
  [rel 16255029](https://www.openstreetmap.org/relation/16255029/)).
- **Licence**: **conflicting**. The 2018 spec says CC BY; the community repo
  [krasch/stockholm-stadsdelar](https://github.com/krasch/stockholm-stadsdelar) says the 2021 source was CC0.
  Dataportalen metadata pages are JS-only; licence of the current release **UNVERIFIED**. Use CC BY attribution
  ("© Stockholms stad") to be safe.
- **Access/format/CRS**: zip of shapefiles, e.g.
  `https://dataportalen.stockholm.se/dataportalen/Data/Stadsbyggnadskontoret/SHP_utanfastigheter_nya_granser.zip`
  (layer `stadsdelar (Polygon)`, file `Adm_area.shp`), CRS **SWEREF 99 18 00** (EPSG:3011), not 3006
  ([krasch README](https://github.com/krasch/stockholm-stadsdelar); [spec](https://dataportalen.stockholm.se/dataportalen/Data/Stadsbyggnadskontoret/Allm%C3%A4n-Produktspecifikation_SK_p84.pdf)).
  Whether this URL still serves a current file: **UNVERIFIED**.
- **Update cadence**: continuous for the map; district boundaries change rarely. Last dated release seen: 2021-04-13 (krasch).
- **Quality notes**: the krasch README reports one mislabelled polygon (VASASTADEN labelled HÄSSELBY GÅRD) in the
  2021 file. Attribute field names are not documented in the spec.
- **Naming fit**: *stadsdelar* are the official names (Kungsholmen, Kristineberg, Stadshagen, Marieberg, Fredhäll;
  on Södermalm: Högalid, Maria, Katarina, Sofia, Långholmen, Reimersholme). Popular names are **not** all stadsdelar:
  Hornstull is inside Högalid, SoFo inside Sofia/Katarina, Hammarby sjöstad spans Södra Hammarbyhamnen/Sickla etc.
  ("Södermalm" is the stadsdelsområde). So: toggle at stadsdel level, and use an alias table for the popular names
  (general knowledge; check names against the layer — **UNVERIFIED** for exact membership).
- **OSM mirror**: Stockholm is fully structured in OSM: `admin_level=7` kommun (`ref:scb=0180`,
  [rel 398021](https://www.openstreetmap.org/relation/398021/history/26)), `admin_level=9` stadsdelsområde
  (e.g. Järva), `admin_level=10` stadsdel, with `subarea` roles (e.g. Midsommarkransen, admin_level 10,
  `place=suburb`, parent Hägersten-Älvsjö stadsdelsområde, [rel 16441493](https://www.openstreetmap.org/relation/16441493)).
  This is the easiest source (ODbL, already in EPSG:4326, has `wikidata` ids).
- **Size**: 117 polygons; a few MB as shapefile, < 1 MB simplified GeoJSON (krasch repo provides both).

#### A2. Other municipalities

| Kommun (SCB code) | Official open district layer found? | Notes |
|---|---|---|
| Solna (0184) | No open download found | Solna has named *stadsdelar* (Råsunda, Hagalund, Huvudsta, Frösunda, Bergshamra, Ulriksdal, Järva, Skytteholm, Västra Skogen…), check OSM. **UNVERIFIED** |
| Sundbyberg (0183) | No | Police split Rissne/Hallonbergen into two areas in 2025 ([Polisen 2025](https://polisen.se/siteassets/dokument/organiserad_brottslighet/utsatta-omraden/lagesbild-over-utsatta-omraden-2025.pdf)), useful naming hint |
| Lidingö (0186) | Possibly via the regional CKAN `ckan-storsthlm.dataplattform.se` (listed in [OSM Datakällor](https://wiki.openstreetmap.org/wiki/Sv:Sverige/Datak%C3%A4llor)); robots-blocked, **UNVERIFIED** | |
| Huddinge (0126) | Geodata page `huddinge.se/psi/geodata/` exists ([OSM Datakällor](https://wiki.openstreetmap.org/wiki/Sv:Sverige/Datak%C3%A4llor)); content not reachable, **UNVERIFIED** | Has *kommundelar* (Flemingsberg, Skogås, Trångsund, Vårby, Stuvsta-Snättringe…) |
| Nacka (0182), Danderyd (0162), Sollentuna (0163), Järfälla (0123) | None found | NYKO (*nyckelkodsområden*) exist per municipality but are distributed via SCB statistics packages, not as open polygons ([SCB NYKO](https://www.scb.se/vara-tjanster/bestall-data-och-statistik/regionala-statistikprodukter/statistikpaket/nyckelkodsystemet-nyko/)) |

Conclusion: outside Stockholm stad, rely on OSM + RegSO.

#### A3. OpenStreetMap

- Tagging: `boundary=administrative` + `admin_level=9` (stadsdelsområde) and `10` (stadsdel) in Stockholm;
  2008 Swedish proposal set `admin_level=8` for stadsdelsområde
  ([forum](https://community.openstreetmap.org/t/forslag-pa-administrativa-indelningar-i-sverige/35676)) but current
  Stockholm data uses 9/10 (relations above). For other kommuner, expect a mix of `admin_level=10` relations and
  `place=suburb|quarter|neighbourhood` areas, or only `place` **nodes** (points, no polygon). Completeness per
  kommun: **UNVERIFIED**, run the query in §7.
- Licence: ODbL 1.0, attribution "© OpenStreetMap contributors".
- Example Overpass query (polygons via `out geom`, convert with `osmtogeojson` or Python `osm2geojson`): see §7.

#### A4. SCB RegSO and DeSO

- **Versions**: RegSO 2025 and DeSO 2025 are current (boundaries as of 2025-01-01); 2020/2018 versions are frozen
  ([RegSO](https://scb.se/vara-tjanster/oppna-data/oppna-geodata/regso/),
  [DeSO](https://www.scb.se/vara-tjanster/oppna-data/oppna-geodata/demografiska-statistikomraden-deso/)).
- **Counts**: DeSO 2025 = **6,160** areas nationally
  ([SCB DeSO tables](https://www.scb.se/hitta-statistik/regional-statistik-och-kartor/regionala-indelningar/demografiska-statistikomraden-deso/deso-tabellerna-i-ssd--information-och-instruktioner/)).
  RegSO 2025 national count and counts in the 9 kommuner: **UNVERIFIED** (count after download).
- **Licence**: SCB open data is **CC0**; suggested credit "Source: Statistics Sweden"
  ([SCB terms](https://www.scb.se/en/About-us/about-the-website-and-terms-of-use/open-data-api/)).
- **Access**: WFS/GeoPackage, no key:
  `https://geodata.scb.se/geoserver/stat/wfs?service=WFS&REQUEST=GetFeature&version=1.1.0&TYPENAMES=stat%3ARegSO_2025&outputFormat=geopackage`
  (same with `stat%3ADeSO_2025`). Crosswalk DeSO→RegSO 2025:
  `https://www.scb.se/contentassets/e3b2f06da62046ba93ff58af1b845c7e/koppling-deso2025-regso2025_2026-03-25.xlsx`.
- **CRS**: not stated on the page; expected SWEREF 99 TM (EPSG:3006), **UNVERIFIED** (check with `ogrinfo`).
- **Update**: per division revision (crosswalks dated 2026-03-25).
- **Names**: RegSO names are composed by SCB from local place names, e.g. "Solna – Råsunda"-style labels are typical
  but the naming rule is not documented on the page: **UNVERIFIED**. DeSO only has codes (e.g. `0180C1234`).
- **Size**: national GeoPackage tens of MB (**UNVERIFIED**); filter to the 9 kommun codes after download.

#### A5. Lantmäteriet

- **Distriktsindelning** (2,523 *distrikt*, based on 1999 parishes, static since 2016): CC0, GeoPackage, EPSG:3006,
  order via Geotorget
  ([product page](https://lantmateriet.se/en/geodata/geodata-products/product-list/division-of-district-download-vector)).
  Too coarse in the suburbs, parish-shaped in the city (e.g. Stockholms Högalid, Sofia). Useful as an
  official name cross-check.
- **Socken och stad** (~2,350 parishes, ~130 cities): CC0, GeoPackage, EPSG:3006
  ([page](https://lantmateriet.se/en/geodata/geodata-products/product-list/parish-and-city-download-vektor)). Not useful for zones.
- **Ortnamn nedladdning** (~980,000 names, points at label position, GeoPackage/CSV, daily updates): licence
  not stated on the product page, **UNVERIFIED** ([page](https://www2.lantmateriet.se/en/geodata/geodata-products/product-list/place-name-download-vector)).

#### A6. Recommendation for zones

1. **Stockholm stad**: OSM `admin_level=10` (117 stadsdelar), grouped by `admin_level=9`. Large outer stadsdelar
   (> 5 km², e.g. in Bromma or Skarpnäck forest areas) can be clipped to built-up land if needed.
2. **Other 8 kommuner**: take OSM `admin_level=10` and `place=suburb|quarter` polygons; where a kommun has
   none, use **RegSO 2025** clipped to the kommun and renamed after the OSM `place` node(s) it contains.
3. **Overlaps/gaps** (all in EPSG:3006 with shapely): build a single planar coverage per kommun: priority
   OSM admin > OSM place polygon > RegSO; subtract higher-priority polygons from lower ones, drop slivers
   < 0.05 km², assign uncovered land to the RegSO piece. Clip everything to the kommun boundary and remove
   water with OSM `natural=water` or SCB land area.
4. **Target size**: 0.5-5 km² holds for most stadsdelar; merge pieces < 0.3 km² into their neighbour,
   split > 8 km² by RegSO.
5. Store as `data/geo/zones.parquet` (or GeoJSON) with `zone_id, name, aliases[], kommun_code, source,
   area_km2, centroid_3006, geometry`.

### B. How listing sites name areas

Only robots.txt / public documentation checked; no scraping.

| Site | Area naming | Public list / autocomplete | robots.txt notes |
|---|---|---|---|
| Qasa | `searchAreas=<Name>~~se` (e.g. `Stockholms_län~~se`, already in `sites/qasa/site.yaml`) | No documented public endpoint. **UNVERIFIED** | Filtered search URLs (price, size, rooms…) disallowed; `Content-Signal: ai-train=no, search=yes, ai-input=yes` ([robots](https://qasa.se/robots.txt)) |
| Blocket Bostad | Kommun-level selection on the site (**UNVERIFIED**) | none found | blocket.se blocks automated fetching (fetch refused) |
| Bostadsförmedlingen | Kommun / stadsdel in listings (**UNVERIFIED**) | none found | robots.txt not reachable |
| Samtrygg | free text | none | `/RentalObject/Search` and `NewSearch` disallowed ([robots](https://www.samtrygg.se/robots.txt)) |
| Hemnet (buy mode) | `location_ids` from an internal autocomplete (municipality/district/area) as used by third-party tools ([hemnet-mcp](https://glama.ai/mcp/servers/chrischall/hemnet-mcp/tools/hemnet_autocomplete_location)) | internal, not a public API; terms **UNVERIFIED** | no Disallow on search paths ([robots](https://www.hemnet.se/robots.txt)) |
| Booli (buy mode) | `areaIds` (e.g. `areaIds=1`) for municipalities/districts/streets ([booli-mcp](https://glama.ai/mcp/servers/chrischall/booli-mcp/tools/booli_search_areas)) | internal; the old public Booli API status **UNVERIFIED** | only `/auth/`, `/user/` etc. disallowed ([robots](https://www.booli.se/robots.txt)) |

Svensk Mäklarstatistik groups Stockholm into ~11 "stadsdelar" built from *distrikt* codes (e.g. 215003 Essingen)
([page](https://www.maklarstatistik.se/om-statistiken/geografisk-indelning/)), a useful mapping for price stats.

**Open gazetteer for aliases**: no single open source maps "SoFo", "Hornstull", "Hammarby sjöstad" to polygons.
Best combination: OSM `name`, `alt_name`, `place=neighbourhood` nodes (+ `wikidata`), Wikidata labels/aliases,
and a hand-maintained `config/area_aliases.yaml` (alias → zone ids). Lantmäteriet Ortnamn gives points only.

**Recommendation**: match listings to zones by `lat/lon` (point-in-polygon); use the `area` text only when
coordinates are missing, through the alias table. For site searches, generate kommun-level parameters
(that is what sites accept) and filter by zone locally.

### C. Public transport network

#### C1. Trafiklab GTFS Regional (SL) and GTFS Sverige 2

| | GTFS Regional SL | GTFS Sverige 2 |
|---|---|---|
| URL | `https://opendata.samtrafiken.se/gtfs/sl/sl.zip?key={apikey}` ([Trafiklab](https://www.trafiklab.se/api/gtfs-datasets/gtfs-regional/)) | `https://api.resrobot.se/gtfs/sweden.zip?key={apikey}` ([Trafiklab](https://www.trafiklab.se/api/gtfs-datasets/gtfs-sverige-2/)) |
| Licence | CC0 1.0 | CC0 1.0 |
| Key / quota | free key; static Bronze 10/min, 50/month (Silver 250, Gold 2,500) | free key; Bronze 1/min, 50/month |
| Update | daily 03:00-07:00 | when changed, max daily |
| Size | 46 MB zip / 282 MB unzipped, **614 routes**, service window ~7 weeks (dataset of 2026-10-27) ([Mobility DB mdb-3237](https://mobilitydatabase.org/feeds/gtfs/mdb-3237)) | 60 MB / 522 MB, 8,888 routes ([mdb-2661](https://mobilitydatabase.org/feeds/gtfs/mdb-2661)) |
| `shapes.txt` | **Yes** (Mobility DB features: Shapes, Location Types, Transfers…) | not listed |
| `route_color` | **not listed**, assume absent | not listed |
| Route types | extended types; examples in feed 100, 401, 700, 900, 1000 (rail, metro, bus, tram, water) | extended |
| Quality | 1 validator error (`equal_shape_distance_diff_coordinates`, reported as an SL data issue, [Trafiklab support](https://support.trafiklab.se/org/trafiklabse/d/gtfs-validator-detects-1-error-in-gtfs-sl-preventi/)) | 1 error |

Which `route_type` Roslagsbanan, Saltsjöbanan, Lidingöbanan, Nockebybanan and Tvärbanan use: **UNVERIFIED**
(read `routes.txt`; group by `agency_id` + `route_short_name` instead of trusting type alone).

#### C2. SL open APIs (no key)

- **SL Transport API** (`transport.integration.sl.se/v1/…`): `/sites`, `/lines`, `/stop-points`,
  `/transport-authorities`, `/sites/{id}/departures`; **no key** ("SL's integration APIs are open")
  ([sl-mcp-server docs](https://pkg.go.dev/github.com/henrrrik/sl-mcp-server), [transit-se](https://github.com/rebelliard/transit-se)).
  Replaced Departures v4 in 2024 ([Trafiklab news](https://www.trafiklab.se/sv/nyheter/2024/03/sl-transport-api-replaces-departures-v4/)).
  Whether `/lines` returns colours: **UNVERIFIED** (probably not).
- **SL Journey Planner v2** (`journeyplanner.integration.sl.se/v2/…`): `/trips`, `/stop-finder`, `/system-info`;
  no key; leg modes bus/train/metro/tram/ship/walk; arrive-by via `itd_trip_date_time_dep_arr=arr` (undocumented)
  ([traveler](https://github.com/kristofferremback/traveler), [sl-mcp-server](https://pkg.go.dev/github.com/henrrrik/sl-mcp-server)).
- Rate limits: none published (**UNVERIFIED**); cache catalogs (sites/lines) for ≥ 1 h.
- Official Trafiklab doc pages render client-side and could not be read here.

#### C3. OSM route relations

- `type=route` + `route=subway|train|tram|light_rail|bus|ferry`, grouped by `route_master`. Example
  T11: `ref=T11`, `colour=blue`, `network=Stockholms tunnelbana`
  ([rel 6286471](https://www.openstreetmap.org/relation/6286471/history/11)). Note `colour` can be a **name**, not hex.
  Inner-city SL buses use a simplified bus model (route_master + routes, stops but no platforms)
  ([OSM Sweden PT](https://wiki.openstreetmap.org/wiki/Sv:Sverige/Kollektivtrafik)).
- Completeness vs SL for 600+ lines: **UNVERIFIED**; rail is likely complete, suburban buses less so. Use OSM rail
  geometry only if GTFS shapes look wrong.

#### C4. Line colours

No machine-readable official source found (SL graphic manual not public; GTFS lacks `route_color`;
Wikipedia infoboxes give only colour names). Known colour identities: metro **green** (T17/T18/T19),
**red** (T13/T14), **blue** (T10/T11); pendeltåg **pink**; Roslagsbanan **purple**; Saltsjöbanan **turquoise**;
Tvärbanan **orange**; Lidingöbanan, Nockebybanan, Spårväg City, Djurgårdslinjen own tram colours. Line numbers:
pendeltåg 40/41/43/48, Tvärbanan 30/31, Saltsjöbanan 25/26, Roslagsbanan 27/28/29, Lidingöbanan 21,
Nockebybanan 12, Spårväg City 7 ([Transport in Stockholm](https://en.wikipedia.org/wiki/Transport_in_Stockholm)).
Colour assignments and hex values: **UNVERIFIED**. Action: sample hex from SL's official network map
(sl.se) into `config/transit_colours.yaml` keyed by `route_short_name`.
Note: the **yellow line** (Odenplan-Hagastaden-Arenastaden, near Råsta strandväg) is under construction; opening
date **UNVERIFIED**, plan a slot for it.

#### C5. Station entrances

- GTFS SL lists "Location Types" as a feature, but entrances (`location_type=2`) are not confirmed
  ([mdb-3237](https://mobilitydatabase.org/feeds/gtfs/mdb-3237)): **UNVERIFIED**, check `stops.txt`.
- OSM `railway=subway_entrance` nodes are the standard tagging; Stockholm coverage **UNVERIFIED** (query in §7).

#### C6. Ready-made transit vector tiles

| Option | What | Access | Notes |
|---|---|---|---|
| Transitland | `routes` (with `route_color`, `route_type`) and `stops` layers, MapLibre-ready, z0-14, daily rebuild | free key (`apikey`), fair-use limit; attribution to Transitland required ([docs](https://www.transit.land/documentation/vector-tiles), [plans](https://www.transit.land/documentation/plans-and-billing)) | Free quota numbers **UNVERIFIED**; route colours blank where the feed has none (SL) |
| Thunderforest Transport (vector) | full transit basemap style for MapLibre (2026-04) | free Hobby 150k tiles/month; vector request = 10 tiles ([pricing](https://www.thunderforest.com/pricing/), [blog](https://www.thunderforest.com/blog/transport-vector/)) | Replaces basemap; less control |
| OpenFreeMap (OpenMapTiles schema) | rail/subway lines as `transportation` class, no routes | free | No line identity or colours |

#### C7. Recommendation and processing outline

1. Weekly (not daily) download of `sl.zip` (4 calls/month, within Bronze 50).
2. `routes.txt` → map to modes: metro (401), commuter rail (100/109 + agency/name rules), tram/light rail (900, Tvärbanan,
   Lidingöbanan, Nockebybanan, Spårväg City), local rail (Roslagsbanan, Saltsjöbanan), bus (700), ferry (1000).
3. For each `route_id` + `direction_id`, take the most frequent `shape_id` from `trips.txt`; build LineStrings from
   `shapes.txt`; reproject to EPSG:3006; `simplify(5 m)` for rail, `10 m` for bus; merge directions.
4. Stops: `stops.txt` parents (`location_type=1`) for stations, children for platforms, `2` for entrances if present;
   attach served `route_short_name`s via `stop_times`.
5. Output `data/geo/transit_<mode>.geojson` (EPSG:4326 for MapLibre) + `transit_stops.geojson`; buses as a separate,
   zoom-gated layer (bus lines are most of the 614 routes).
6. Colours from `config/transit_colours.yaml`, fallback by mode.

### D. Routing: transit journeys and travel-time matrix

#### D1. ResRobot v2.1 (already integrated)

- `https://api.resrobot.se/v2.1/trip`, params `originCoordLat/Long`, `destCoordLat/Long`, `date`, `time`,
  `searchForArrival=1` (arrive-by), `passlist=1` (intermediate stops with lat/lon), `originWalk`/`destWalk`,
  `format=json` ([route planner docs](https://www.trafiklab.se/api/our-apis/resrobot-v21/route-planner/)).
- Legs: `WALK` (first/last mile, with `dist` in m) and `TRSF` (transfer walks). Walking-leg geometry/polyline is
  **not documented**: draw walks as straight lines or route them with ORS.
- Licence CC0 ([license](https://www.trafiklab.se/sv/api/our-apis/resrobot-v21/license/)).
- Quota: your config says 45 calls/min, 30,000/month (`config/providers.yaml`); the official tier table could not be
  read (**UNVERIFIED**).

#### D2. SL Journey Planner v2

No key, SL-only, walk/transit legs, arrive-by via `itd_trip_date_time_dep_arr=arr`. Whether legs carry full
coordinate sequences: **UNVERIFIED** (the MCP wrapper returns endpoint coords). Good as a second provider and for
SL-specific line names.

#### D3. Matrix and isochrones

| Option | Setup | Cost | Fit for 150 × 4 × 3 | Notes |
|---|---|---|---|---|
| **ResRobot from centroids** | none (exists) | 0 | 1,800 calls ≈ 40 min at 45/min; ~6% of monthly quota | Real timetable; one sample per window; cache |
| **r5py / R5** | Python + Java, OSM `.pbf` + SL GTFS | 0 | seconds; full matrices and percentiles over a time window | Licence GPL-3.0-or-later OR MIT ([repo](https://github.com/r5py/r5py)); default JVM uses 80% RAM ([docs](https://r5py.readthedocs.io/stable/_sources/user-guide/user-manual/advanced-use.md)) |
| **OpenTripPlanner 2** | Java server, graph build | 0 | via GraphQL per pair or `SandboxAPITravelTime` isochrones/GeoTIFF surfaces ([docs](https://docs.opentripplanner.org/en/latest/sandbox/TravelTime/)) | Memory: Finland ~10 GB, Germany ~95 GB ([requirements](https://docs.opentripplanner.org/en/latest/System-Requirements/)); Stockholm county estimate 2-4 GB (**UNVERIFIED**) |
| **Valhalla + transit** | self-host, GTFS ingest | 0 | possible | GTFS support "still beta" (maintainer, 2023) ([discussion](https://github.com/valhalla/valhalla/discussions/4056)) |
| **TravelTime API** | key | free Basic key: 120 hits/min, not for commercial use; a matrix origin = 1 hit ([pricing](https://traveltime.com/analytics/api-pricing), [limits](https://docs.traveltime.com/api/overview/usage-limits)) | trivial | Sweden PT coverage **UNVERIFIED**; personal non-commercial use seems allowed |
| **Google Routes** | key + billing | Compute Route Matrix: 10k free/month (Essentials), then $5/1,000 elements; Pro $10 ([pricing](https://developers.google.com/maps/billing-and-pricing/pricing?hl=de)) | 1,800 elements free | Transit matrix SKU tier **UNVERIFIED** |

#### D4. Recommendation

- **(a) Clicked point → itinerary**: ResRobot `/trip` with coordinates (+ `passlist=1`); draw transit legs by
  slicing GTFS shapes between boarding/alighting stops; draw walks via ORS directions (foot) or straight lines.
- **(b) District matrix**: ResRobot from each zone's **population-weighted centroid** (use DeSO population to place
  it), 4 destinations × windows (e.g. Tue 07:45 arrive-by 08:30, 17:00 depart, Sat 12:00), refreshed monthly,
  stored in the existing `routing_cache`. Move to **r5py** if you want median-over-window times, isochrones or
  > 1,000 origins.

### E. Walking routing

| Service | Free quota | Terms |
|---|---|---|
| **OpenRouteService** | Directions 2,000/day (40/min), **Matrix 500/day (40/min)**, Isochrones 500/day (20/min) ([plans](https://openrouteservice.org/plans/)); matrix ≤ 3,500 locations per request, isochrones ≤ 5 locations ([restrictions](https://openrouteservice.org/restrictions/)) | free key, OSM data |
| **GraphHopper** | 500 credits/day, **non-commercial only** ([pricing](https://www.graphhopper.com/pricing/)) | key |
| **FOSSGIS OSRM** (`routing.openstreetmap.de`, has foot) | max 1 req/s, "no scraping, no heavy usage", attribution + fix-the-map link ([about](https://routing.openstreetmap.de/about.html)) | no key; the Valhalla public instance terms page was bot-blocked (**UNVERIFIED**) |
| **OSRM self-hosted** | unlimited | Docker + regional `.pbf`; foot profile built in |

**Detour factor**: walking circuity in 40 cities ranges 1.14-1.49, median ≈ 1.26 (Boeing 2019,
[arXiv 1708.00836](https://arxiv.org/pdf/1708.00836)); no published value for Stockholm under 1 km. Water
(Söder/Kungsholmen bridges), rail corridors and motorways make short-distance circuity in Stockholm much higher
locally (can exceed 2×). Use 1.3 only for **ranking candidates**, never for the displayed minutes.

**Recommendation**: per click, take the ~5 nearest per category by straight line (8 categories → ≤ 40 points),
send **one ORS matrix call** (1 source × ≤ 40 destinations, `foot-walking`), keep the 3 fastest per category.
Cache by rounded origin (≈ 25 m grid). 500 clicks/day is far above expected use. If you also want walking
minutes per listing in batch, self-host OSRM foot.

### F. Points of interest

#### F1. OSM via Overpass

| Category | Tags | Chains (use `brand` / `brand:wikidata`) |
|---|---|---|
| Supermarkets | `shop=supermarket`, `shop=convenience` | ICA (Nära/Supermarket/Kvantum/Maxi), Coop, Willys, Hemköp, Lidl, City Gross |
| Gyms | `leisure=fitness_centre`, `leisure=sports_centre` + `sport=climbing` | SATS, Nordic Wellness, Friskis&Svettis, Actic, STC, EVO |
| Vets | `amenity=veterinary` | Evidensia, AniCura (animal hospitals have `healthcare=` too) |
| Pharmacies | `amenity=pharmacy` (+ `healthcare=pharmacy`) | Apotek Hjärtat, Kronans Apotek, Apoteket, Apotek 365 |
| Parks / nature | `leisure=park`, `boundary=protected_area`, `leisure=nature_reserve` | — |
| Libraries | `amenity=library` | — |

Brand tags follow the Name Suggestion Index; completeness in Stockholm for chains is high but **UNVERIFIED**
(compare with chain store counts). **Overpass policy** (main instance): < 10,000 queries and < 1 GB per day,
for regular use divide by 100; send a `User-Agent`; back off 30 s on 429/406. `private.coffee` has no rate
limit ([Overpass wiki](https://wiki.openstreetmap.org/wiki/Overpass_API)). Your current per-listing query pattern
(config/poi.yaml) should become a **weekly region-wide fetch** to stay within this.

#### F2. Chain / open feeds

No chain publishes an open-licensed store feed (**UNVERIFIED** per chain). AllThePlaces (CC0 output) scrapes chain
store locators; it is one of Overture's sources, so use it only indirectly through Overture.

#### F3. Commercial and other open places

| Source | Licence | Cost | Notes |
|---|---|---|---|
| **Overture Places** | per source: CDLA-Permissive-2.0 (Meta, Microsoft…), Apache-2.0 (Foursquare), CC0 (AllThePlaces) ([attribution](https://docs.overturemaps.org/attribution/)) | free (GeoParquet on S3/Azure) | Good brand coverage; categories differ from OSM; dedupe against OSM |
| **Overture Transportation** | ODbL (OSM + TomTom) | free | Not needed; same as OSM roads |
| **Foursquare OS Places** | Apache-2.0, 1,000+ categories ([docs](https://docs.foursquare.com/data-products/docs/fsq-places-open-source)) | free (Hugging Face, contact-share gate) | Included in Overture anyway |
| **Google Places (New)** | Google ToS (no caching beyond place_id) | Nearby Search Pro 5,000 free/month then $32/1,000 ([pricing](https://developers.google.com/maps/billing-and-pricing/pricing?hl=de)) | Best opening hours/ratings; ToS limits storage |

#### F4. Recommendation

OSM primary for every category; Overture Places as a monthly gap check for supermarkets, gyms and vets (flag
places present in Overture but not in OSM within 50 m). Refresh OSM weekly, Overture monthly. Cache as
`data/poi/<category>.parquet` (EPSG:3006 x/y + lon/lat, `name`, `brand`, `osm_id`, `source`, `fetched_at`)
and an in-memory `shapely.STRtree` for nearest queries.

### G. Base map and context layers

#### G1. Base maps

| Provider | Dark style | Limits | Terms |
|---|---|---|---|
| **OpenFreeMap** | `dark`, `fiord` (+ positron, bright, liberty) | none for map views; offline downloads ≤ 3,000 tiles/50 MB | no key, commercial OK, attribution OpenMapTiles + OSM ([site](https://openfreemap.org/)) |
| Protomaps API | 5 default flavours (light confirmed) | not stated | free key, **non-commercial**, or self-host a `.pmtiles` extract ([api](https://protomaps.com/api)) |
| Stadia Maps | custom styles | monthly credits | free for non-commercial individuals; 429 when exhausted ([FAQ](https://stadiamaps.com/faqs/)) |
| MapTiler | yes | free plan limits **UNVERIFIED** | key |

#### G2. Context layers

| Layer | Source | Geometry | Licence | Current? |
|---|---|---|---|---|
| Population, age, income, education, tenure, cars per DeSO/RegSO | SCB Statistikdatabasen DeSO tables (latest years 2024-2025) ([SCB](https://www.scb.se/hitta-statistik/regional-statistik-och-kartor/regionala-indelningar/demografiska-statistikomraden-deso/deso-tabellerna-i-ssd--information-och-instruktioner/)); API limit 10 calls / 10 s, 100k values/table ([terms](https://www.scb.se/en/About-us/about-the-website-and-terms-of-use/open-data-api/)) | polygons (join to DeSO 2025) | CC0 | yes |
| *Utsatta områden* | Polisen Lägesbild 2025: 65 areas (46 utsatta, 19 särskilt utsatta), several Stockholm areas split ([PDF](https://polisen.se/siteassets/dokument/organiserad_brottslighet/utsatta-omraden/lagesbild-over-utsatta-omraden-2025.pdf)); boundaries only as PDF maps (2023: [region Stockholm](https://polisen.se/siteassets/dokument/informationsmaterial/utsatta-omraden---kartgranser/kartgranser-for-utsatta-omraden-region-stockholm-2023.pdf/download/)) | PDF → would need manual digitising | public document, no data licence | Dec 2025 |
| Flood risk | MCF (ex-MSB) Översvämningsportalen, new hazard/risk maps for Stockholms län (Östersjön, Mälaren, Bällstaån, skyfall) published 2026-06-22 ([Länsstyrelsen](https://www.lansstyrelsen.se/stockholm/om-oss/om-lansstyrelsen-stockholm/nyheter/nyheter---stockholm/2026-06-22-nya-hot--och-riskkartor-for-oversvamning-i-stockholms-lan-underlattar-planering.html)) | viewer; WMS/download **UNVERIFIED** | **UNVERIFIED** | 2026 |
| Noise | EU noise mapping 2022 by municipalities/Trafikverket ([Naturvårdsverket](https://www.naturvardsverket.se/vagledning-och-stod/buller/kartlaggning-av-buller/)); Stockholm open download **not found** (Malmö publishes theirs openly, [example](https://opendata-api.malmo.se/dataset/bullerkartlaggning-2022)) | polygons/raster | **UNVERIFIED** | 2022 round |
| Green space | OSM `leisure=park`, `landuse=grass|forest`, `boundary=protected_area`; SCB "Grönområden i tätorter" ([OSM Datakällor](https://wiki.openstreetmap.org/wiki/Sv:Sverige/Datak%C3%A4llor)) | polygons | ODbL / CC0 | yes |
| Rent levels | SCB rents per region (not per DeSO), Hyresgästföreningen reports | tables | **UNVERIFIED** | — |

### H. Front-end tooling

- **Terra Draw**: MIT, npm `terra-draw` **1.5.0** (3.1 MB unpacked, ~5k weekly downloads)
  ([npm](https://npmjs.com/package/terra-draw)); adapter `terra-draw-maplibre-gl-adapter` (MapLibre v4/5)
  ([repo](https://github.com/jameslmilner/terra-draw)); modes include Polygon, Rectangle, LineString, Freehand,
  Select, Render ([guide](https://github.com/JamesLMilner/terra-draw/blob/master/guides/1.GETTING_STARTED.md)), plus
  Circle, Point, Sector, Sensor, AngledRectangle (**UNVERIFIED** in this session). MapLibre lists a wrapper
  plugin `maplibre-gl-terradraw` ([example](https://maplibre.org/maplibre-gl-js/docs/examples/draw-geometries-with-terra-draw/)).
  No brush/paint mode and no boolean ops. Angular: instantiate outside the zone (`NgZone.runOutsideAngular`)
  after `map.on('load')`, and keep features in a signal/store.
- **mapbox-gl-draw / maplibre-gl-draw**: older, no freehand/circle without plugins; skip.
- **Brush tool**: record pointer path → send LineString to the backend → `LineString(...).buffer(r_m, cap_style=round)`
  in EPSG:3006 → `unary_union` with the current piece (eraser = `difference`). Simpler and more exact than an H3/hex
  grid; for a live preview, draw the stroke as a MapLibre `line` layer with `line-width` in metres
  (zoom-interpolated) and swap in the server polygon on pointer-up.
- **turf.js** (client previews only): `@turf/buffer`, `@turf/union`, `@turf/difference`,
  `@turf/boolean-point-in-polygon`, `@turf/point-to-line-distance`, `@turf/polygon-to-line`, `@turf/area`.
  Import per module to limit bundle size (sizes **UNVERIFIED**). Server equivalents: `shapely.buffer`,
  `unary_union`, `difference`, `contains`/`STRtree`, `distance` on `exterior`, `pyproj.Transformer`.
- **Three-panel layouts**: your own Telia debug UI pattern (flex columns + drag handles) is enough; other references
  (kepler.gl, Felt) are **UNVERIFIED** as copyable code. A map-first SL app with walking neighbourhoods on MapLibre +
  OpenFreeMap dark (`fiord`) is a useful reference: [traveler](https://github.com/kristofferremback/traveler).

---

## 4. Keys to register

| Key | Signup | Free quota | Used for |
|---|---|---|---|
| Trafiklab: GTFS Regional | https://developer.trafiklab.se (via [trafiklab.se](https://www.trafiklab.se/api/gtfs-datasets/gtfs-regional/)) | static 50 calls/month (Bronze) | weekly `sl.zip` |
| Trafiklab: ResRobot v2.1 | same | 45/min, 30k/month (per your config, **UNVERIFIED** officially) | itineraries + district matrix (exists) |
| OpenRouteService | https://openrouteservice.org/plans/ | Matrix 500/day, Directions 2,000/day | walking minutes, walk-leg geometry |
| Transitland (optional) | https://www.transit.land/plans-pricing/ | fair use, **UNVERIFIED** | ready-made transit tiles |
| TravelTime (optional) | https://traveltime.com/get-started | 120 hits/min, non-commercial | isochrone experiments |
| Google Maps (optional, exists) | Google Cloud console | Route Matrix 10k/month Essentials; Places Nearby 5k/month Pro | comparison only |

No key: OpenFreeMap, SL Transport / Journey Planner v2, SCB WFS, Overpass.

## 5. Attribution block

Show in the MapLibre attribution control (plus an "About data" page):

```
© OpenStreetMap contributors (ODbL) · © OpenMapTiles · OpenFreeMap
Transit data: Trafiklab.se / Samtrafiken (CC0) · Journey planning: ResRobot (Trafiklab) and SL
Statistical areas: Source: Statistics Sweden (SCB)
District boundaries: © Stockholms stad (Stadskarta)          [only if the city layer is used]
Walking routes: © openrouteservice.org by HeiGIT | Map data © OpenStreetMap contributors
Places: Overture Maps Foundation (CDLA-Permissive-2.0, Apache-2.0 © 2024 Foursquare Labs, CC0)   [if used]
Transit tiles: Transitland                                    [if used]
```

## 6. Risks and open questions

1. Licence of current Stockholm Dataportalen district layers (CC0 vs CC BY) and whether the 2021 zip URL is still live.
2. District polygons for Solna, Sundbyberg, Nacka, Huddinge, Lidingö, Danderyd, Sollentuna, Järfälla in OSM: unknown completeness; run the §7 query and count per kommun.
3. RegSO 2025 counts per kommun, attribute names and CRS (run `ogrinfo -so`).
4. GTFS SL: `route_color`, entrances (`location_type=2`), and exact `route_type` per rail line.
5. Official SL line hex colours (no public machine-readable source found).
6. SL Journey Planner v2: rate limits, leg coordinate detail, stability of the undocumented arrive-by parameter.
7. ResRobot official quota per level (Trafiklab page unreadable here).
8. Transitland free-tier quota; TravelTime Sweden PT coverage.
9. Noise and flood layers: whether WMS/WFS or downloads are open, and their licences.
10. Listing-site terms of use for area autocompletes (Hemnet, Booli, Qasa): not checked beyond robots.txt; treat as off-limits.
11. Yellow metro line opening date (affects the Solna commute layer).

## 7. Sample commands

### A. Districts

```bash
# OSM: admin_level 9/10 + place polygons in the 9 kommuner (ref:scb may be missing on some kommun relations; fall back to name)
cat > districts.overpassql <<'EOF'
[out:json][timeout:180];
area["boundary"="administrative"]["admin_level"="7"]
    ["ref:scb"~"^(0180|0184|0183|0186|0162|0163|0123|0126|0182)$"]->.k;
(
  relation(area.k)["boundary"="administrative"]["admin_level"~"^(9|10)$"];
  relation(area.k)["place"~"^(suburb|quarter|neighbourhood)$"];
  way(area.k)["place"~"^(suburb|quarter|neighbourhood)$"];
  node(area.k)["place"~"^(suburb|quarter|neighbourhood)$"];
);
out geom;
EOF
curl -sS -A "find_home/0.1 (personal)" --data-urlencode data@districts.overpassql \
  https://overpass-api.de/api/interpreter -o districts.osm.json
npx osmtogeojson districts.osm.json > districts.geojson     # or python: osm2geojson

# SCB RegSO 2025 and DeSO 2025 (CC0), then filter to the 9 kommun codes in Python
curl -sS -o regso_2025.gpkg "https://geodata.scb.se/geoserver/stat/wfs?service=WFS&REQUEST=GetFeature&version=1.1.0&TYPENAMES=stat%3ARegSO_2025&outputFormat=geopackage"
curl -sS -o deso_2025.gpkg  "https://geodata.scb.se/geoserver/stat/wfs?service=WFS&REQUEST=GetFeature&version=1.1.0&TYPENAMES=stat%3ADeSO_2025&outputFormat=geopackage"
ogrinfo -so regso_2025.gpkg -al | head -40      # confirm CRS + field names
```

### C. Transit

```bash
# Weekly GTFS Regional SL (key in config/providers.env as TRAFIKLAB_GTFS_KEY)
curl -sS --compressed -o sl.zip "https://opendata.samtrafiken.se/gtfs/sl/sl.zip?key=${TRAFIKLAB_GTFS_KEY}"
unzip -l sl.zip        # expect agency, routes, trips, stops, stop_times, shapes, calendar_dates, transfers...

# SL catalog, no key
curl -sS "https://transport.integration.sl.se/v1/lines"  | jq 'keys'
curl -sS "https://transport.integration.sl.se/v1/sites?expand=true" | jq '.[0]'

# ResRobot itinerary from a clicked point to Råsunda, arrive-by 08:30
curl -sS "https://api.resrobot.se/v2.1/trip?format=json&accessId=${TRAFIKLAB_RESROBOT_KEY}\
&originCoordLat=59.3105&originCoordLong=18.0745&destCoordLat=59.3637&destCoordLong=17.9990\
&date=2026-11-03&time=08:30&searchForArrival=1&passlist=1"
```

```python
# GTFS -> GeoJSON per mode (sketch)
import pandas as pd, geopandas as gpd
from shapely.geometry import LineString
z = "sl/"
routes = pd.read_csv(z+"routes.txt"); trips = pd.read_csv(z+"trips.txt"); shapes = pd.read_csv(z+"shapes.txt")
main = (trips.groupby(["route_id","direction_id","shape_id"]).size().reset_index(name="n")
             .sort_values("n").groupby(["route_id","direction_id"]).tail(1))
lines = (shapes.sort_values(["shape_id","shape_pt_sequence"]).groupby("shape_id")
               .apply(lambda d: LineString(zip(d.shape_pt_lon, d.shape_pt_lat))))
g = gpd.GeoDataFrame(main.merge(routes, on="route_id"), geometry=main.shape_id.map(lines), crs=4326).to_crs(3006)
g["geometry"] = g.simplify(5)
for t, part in g.groupby("route_type"):
    part.to_crs(4326).to_file(f"data/geo/transit_{t}.geojson", driver="GeoJSON")
```

### F. POIs

```bash
cat > poi.overpassql <<'EOF'
[out:json][timeout:300];
area["boundary"="administrative"]["admin_level"="7"]
    ["ref:scb"~"^(0180|0184|0183|0186|0162|0163|0123|0126|0182)$"]->.k;
(
  nwr(area.k)["shop"~"^(supermarket|convenience)$"];
  nwr(area.k)["leisure"="fitness_centre"];
  nwr(area.k)["sport"="climbing"];
  nwr(area.k)["amenity"~"^(veterinary|pharmacy|library)$"];
  nwr(area.k)["leisure"~"^(park|nature_reserve)$"];
  nwr(area.k)["boundary"="protected_area"];
  node(area.k)["railway"="subway_entrance"];
);
out center tags;
EOF
curl -sS -A "find_home/0.1 (personal)" --data-urlencode data@poi.overpassql \
  https://overpass-api.de/api/interpreter -o poi.osm.json

# ORS walking matrix: 1 origin, N destinations (lon,lat order)
curl -sS -X POST "https://api.openrouteservice.org/v2/matrix/foot-walking" \
  -H "Authorization: ${ORS_KEY}" -H "Content-Type: application/json" \
  -d '{"locations":[[18.0745,59.3105],[18.0712,59.3130],[18.0790,59.3080]],"sources":[0],"metrics":["duration","distance"]}'
```
