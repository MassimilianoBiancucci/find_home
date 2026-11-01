# config/

YAML and env files that drive find_home. Most are shared settings and live in git. A few are **personal**: they
hold where you work, your budget, your keys. Those are gitignored, and the repo holds a dummy example of each, so a
fresh clone works and your data never reaches git. Rule: [guide/principles/personal_data.md](../guide/principles/personal_data.md).

## Personal files and their examples

| You edit (gitignored) | Created from (committed) | What goes in |
|---|---|---|
| `locations.yaml` | `locations.example.yaml` | your points: workplace(s), partner, other places, with trips and time windows. Use `coords: [lat, lon]` when you can; an `address` is geocoded on first use |
| `profile.yaml` | `profile.example.yaml` | budget (`max_rent_sek`), size, rooms, move-in dates, areas, preference weights. `TODO(user)` marks the values to fill |
| `search_area.yaml` | `search_area.example.yaml` | the area you want to live in. Edited in the app: Map → Area → Save. Starts empty |
| `providers.env` | `providers.env.example` | API keys (ResRobot, GTFS, OpenRouteService, Google) and a contact email. All optional, see [docs/providers.md](../docs/providers.md) |
| `backend.env` | `backend.env.example` | database URL, API host and port. The defaults work with `docker-compose.yml` |

## Setup

`scripts/ensure-env.sh` (run by `scripts/install.sh` and by F5 → **FH: Full Stack**) creates every missing real file
from its example and **never overwrites** an existing one. To do it by hand:

```bash
cp config/locations.example.yaml   config/locations.yaml
cp config/profile.example.yaml     config/profile.yaml
cp config/search_area.example.yaml config/search_area.yaml
cp config/providers.env.example    config/providers.env
cp config/backend.env.example      config/backend.env
```

Then edit the copies and check them: `scripts/findhome config validate`. If a personal file is missing, validation
says which example to copy.

Example files are made up (fictional workplace and partner, coordinates of public metro stations, empty keys). Do not
put real values in them, and do not commit the real files: they are listed in `.gitignore`.

## Adding a personal file

1. Create `config/<name>.example.yaml` (or `<name>.env.example`) with made-up values and a header saying it is an
   example and that the real file is gitignored.
2. Add `config/<name>.yaml` (or `.env`) to `.gitignore`.
3. Add it to the table above and to the table in the principle page.
4. `scripts/ensure-env.sh` picks it up by the `*.example.yaml` / `*.env.example` naming. Nothing else to register.
5. `backend/tests/unit/test_personal_data.py` checks the pieces fit together.

## Shared files (committed)

`filters_catalog.yaml`, `time_model.yaml`, `poi.yaml`, `tags.yaml`, `providers.yaml`, `geo.yaml`, `agent.yaml`,
`transit_colours.yaml`, `area_aliases.yaml` and `schemas/`. They describe how the app works, not who you are.
