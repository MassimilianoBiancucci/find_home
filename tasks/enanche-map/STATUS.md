# Status: enanche-map

**State:** in-progress (branch `feat/enhance-map`)

Plan: [master_plan.md](master_plan.md) with sub-plans 00-05 in [plans/](plans/). Decisions: [QA_planning.md](QA_planning.md).

| # | Sub-plan | State |
|---|---|---|
| 0 | geocode fix + address suggestions | done |
| 1 | three-box shell + map modes | done |
| 2 | zones + search area + area scoring | done |
| 3 | POIs + icons + test point (+ alpha probes) | done |
| 4 | transit layer | planned |
| 5 | connectivity mode | planned |

Keys needed: `ORS_API_KEY` (real walking minutes; estimates without it), `TRAFIKLAB_GTFS_KEY` (sub-plan 4),
`TRAFIKLAB_RESROBOT_KEY` (itineraries; estimates without it), all in `config/providers.env`.

Deviations from the plan:
- 3: glyphs are own simple SVG paths drawn on a canvas (no third-party icon set, no licence file needed).
- 3: the "Train" POI category covers pendeltåg plus local rail (Roslagsbanan, Saltsjöbanan); metro excluded.
