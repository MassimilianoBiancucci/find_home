# Which file controls what

All under `config/`, validated by `config/schemas/*.schema.json`. After editing: `scripts/findhome config validate`.
Changing a scoring file changes the **config hash**: old scores become stale until `scores recompute`.

| File | Controls | You may edit? |
|---|---|---|
| `profile.yaml` | per listing kind: hard filters (gate) and weighted preference groups | propose only |
| `filters_catalog.yaml` | canonical filter keys used by profile and site filter maps | add keys when onboarding needs them |
| `locations.yaml` | points (categories, weights, notes, modes) and their trips: direction, day types, arrive_by/depart_at windows | propose only |
| `time_model.yaml` | default sampling grid, day types, reliability stats | propose only |
| `poi.yaml` | nearby-service categories (OSM tags, radius, weight) | propose only |
| `tags.yaml` | lifecycle statuses and feedback reason tags | add a tag if clearly missing |
| `providers.yaml` | routing/geocoding/POI providers, budgets, cache TTL, map style | no |
| `agent.yaml` | headless agent commands for the app's Run agent button | no |
| `sites/<slug>/site.yaml` + `NAVIGATION.md` | per-site scan rules and navigation guide | yes (onboarding/repair) |

`TODO(user)` values in profile.yaml and locations.yaml are for the user to fill; mention them in the Handover,
do not invent them.
