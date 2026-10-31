# Status: enanche-map

**State:** done on branch `feat/enhance-map` (not merged). Real timetable and walking numbers need the keys below.

Plan: [master_plan.md](master_plan.md) with sub-plans 00-05 in [plans/](plans/). Decisions: [QA_planning.md](QA_planning.md).

| # | Sub-plan | State |
|---|---|---|
| 0 | geocode fix + address suggestions | done |
| 1 | three-box shell + map modes | done |
| 2 | zones + search area + area scoring | done |
| 3 | POIs + icons + test point (+ alpha probes) | done |
| 4 | transit layer | done (built from OSM until `TRAFIKLAB_GTFS_KEY` is set) |
| 5 | connectivity mode | done (estimates until `TRAFIKLAB_RESROBOT_KEY` is set) |

Keys needed: `ORS_API_KEY` (real walking minutes; estimates without it), `TRAFIKLAB_GTFS_KEY` (sub-plan 4),
`TRAFIKLAB_RESROBOT_KEY` (itineraries; estimates without it), all in `config/providers.env`.

Deviations from the plan:
- 3: glyphs are own simple SVG paths drawn on a canvas (no third-party icon set, no licence file needed).
- 3: the "Train" POI category covers pendeltåg plus local rail (Roslagsbanan, Saltsjöbanan); metro excluded.
- 4: OSM route relations are a full source (not only a cross-check) so the layer works without a key; stations are
  matched to lines by distance instead of stop_times; GTFS path is unit-tested on a fixture, not on the real feed yet.
- 4: no line frequencies in the inspector (needs GTFS stop_times); line card shows the stations in order instead.
- 5: zone origin is the centroid (or a point inside the zone), not a population-weighted centre (DeSO population
  not fetched); results keyed by a locations + time_model hash instead of the full config hash, so search-area
  edits do not discard the matrix.
