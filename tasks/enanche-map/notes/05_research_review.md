# Review of 04_data_sources.md (checked 2026-10-31)

Verified with [scripts/osm_district_coverage.py](../scripts/osm_district_coverage.py) (one Overpass request) and
[scripts/regso_coverage.py](../scripts/regso_coverage.py) (SCB WFS, attributes only), plus `npm view`.

## Corrections

### 1. OSM district polygons are sparse outside central Stockholm (report §1.1, A3, A6)
| Kommun | adm9 | adm10 | place polygons | place nodes |
|---|---|---|---|---|
| Stockholm | 11 | **47** (report: 117) | 28 | 158 |
| Solna | 8* | 0 | 1 | 20 |
| Sundbyberg | 11* | 0 | 0 | 19 |
| Lidingö | 0 | 0 | 0 | 29 |
| Danderyd | 0 | 0 | 0 | 13 |
| Sollentuna | 0 | 0 | 2 | 23 |
| Järfälla | 0 | 0 | 2 | 13 |
| Huddinge | 0 | 0 | 2 | 40 |
| Nacka | 0 | 0 | 7 | 55 |
\* `area` filters catch Stockholm's adm9 relations that touch these borders; not their own districts.

Consequence: the "OSM first, RegSO for gaps" coverage algorithm (A6.3) would be RegSO almost everywhere outside
Stockholm and a patchwork inside it (47 of 117 stadsdelar).

### 2. RegSO 2025 is a good uniform toggle level (report treats it as fallback)
- 3,363 nationally; **263 in the region**: Stockholm 127, Järfälla 25, Solna 22, Huddinge 22, Sollentuna 20,
  Nacka 16, Lidingö 13, Sundbyberg 11, Danderyd 7.
- Attributes: `regsokod`, `regsonamn`, `kommunkod`, `lanskod`, `version`, `referensdatum`, geometry `sp_geometry`.
- Names are mostly the neighbourhood names people and sites use ("Arenastaden", "Hallonbergen Västra",
  "Flemingsberg östra", "Kvarnholmen-Henriksdal", "Hammarbyhöjden"); some inner-city ones are parish names
  ("Hedvig Eleonora" = part of Östermalm), which is what the alias table is for.
- CC0, one WFS request, no key, one consistent planar coverage (no overlap/gap stitching).

### 3. Terra Draw version (report H)
`terra-draw` is **1.39.0**; **1.5.0** is `terra-draw-maplibre-gl-adapter` (peer deps `terra-draw ^1.0.0`,
`maplibre-gl >=4`; we have 5.24). Compatible.

## Accepted as is
- GTFS Regional SL (CC0, shapes.txt, weekly download within the 50/month Bronze quota); line colours from a small
  config file; ResRobot for itineraries and the district matrix (~1,800 calls per refresh at 263 zones × 4 points
  × ~2 windows ≈ 2,100, still ~7% of the monthly quota).
- ORS matrix 500/day, 1 call per probe click, cache by rounded origin.
- OSM POIs fetched region-wide on a schedule (not per listing, Overpass policy), Overture optional.
- OpenFreeMap `dark`/`fiord` for dark mode.
- Brush = buffered stroke unioned in shapely (EPSG:3006); turf only for client previews.
- Attribution block (§5).

## Still open (needs the keys or a download, not more web research)
- GTFS SL `route_color`, entrances (`location_type=2`), route_type per rail line: check `routes.txt`/`stops.txt`
  after downloading `sl.zip` with the new key.
- RegSO CRS (expected EPSG:3006): `ogrinfo` after download.
- ORS geocode/autocomplete quota and Photon terms (asked in prompt E.4; the report did not answer).

## Proposed zone model
- Toggle level: **RegSO 2025** for all 9 kommuner (263 zones, CC0).
- Grouping in the left panel: kommun → Stockholm's 14 stadsdelsområden (OSM adm9, spatial join by centroid) →
  RegSO. Lets you toggle "Södermalm" or "Solna" in one click.
- Names: `regsonamn` plus `config/area_aliases.yaml` (alias → regsokod list) seeded from OSM `place` nodes inside
  each zone (Hornstull, SoFo, Hammarby sjöstad) so listing `area` texts and agent instructions resolve to zones.
