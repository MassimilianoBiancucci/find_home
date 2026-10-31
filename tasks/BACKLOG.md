# Backlog

Follow-up tasks after `init-project`. Order is a suggestion; each becomes `tasks/<slug>/` when started.

| Slug | What | Notes |
|---|---|---|
| `fill-profile-values` | Fill `config/profile.yaml` TODO(user) values: max rent, min m², move-in window, areas; decide whether 1 rok + sovalkov counts | Pending user input |
| `verify-sites` | Qasa done (active, custom scanner; first dry run on the Mac pending). Remaining stubs: Samtrygg, Bostadsförmedlingen. Blocket Bostad listings already appear on Qasa (`platform: blocket`): check what a separate scan would add | Open per site: native pets filter? login needed? |
| `routing-providers` | Live-test ResRobot (free status, arrive-by, coordinates) and OSM adapters with real keys; optional Google key | See `docs/providers.md` |
| `reliability-collector` | Collect SL realtime delays (Trafiklab GTFS-RT) per line and hour to turn timetable times into real reliability | Needs `routing-providers` |
| `scoring-v1` | Tune the weighted score with real listings and feedback; reliability penalty calibration | After a few weeks of data |
| `poi-layer` | ~~Overpass POI fetch, map layers, walking time to nearest per category~~ done in `enanche-map` (region-wide fetch, test point). Left: POIs per listing in the digest and the `neighbourhood` score group | |
| `map-3d` | 3D building extrusion styling, tilt presets, isochrones (commute heat layers per zone done in `enanche-map`: Connectivity mode) | |
| `buy-mode` | Enable `listing_kind: buy`: profile, scoring, Hemnet/Booli site stubs, buy UI fields | Schema already buy-ready |
| `notifications` | How the scheduled agent reports new top matches (run summary, email, push) | |
| `guide-skill-merge` | The guide skill exists in two diverged copies in telia_env (`SKILLs/guide` newer SKILL.md, `.github/skills/guide` has bootstrap.md + check_links.py). find_home carries the merged copy | Housekeeping outside this repo |
