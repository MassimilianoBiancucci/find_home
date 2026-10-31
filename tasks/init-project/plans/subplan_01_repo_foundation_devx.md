## Plan: Repo foundation and developer experience

This sub-plan creates the find_home repository skeleton and the local infrastructure that every later sub-plan builds on: git, the folder layout, Docker Compose with Postgres and pgAdmin, the VS Code debug and task orchestration, helper scripts, and the `tasks/` convention. It adapts the telia_env Debug UI pattern (sequenced `preLaunchTask`, background problem matchers, `postDebugTask`, `free-ports.sh`, per-process env examples, preloaded pgAdmin) and the Interactions_analytics simplifications (`${workspaceFolder}` paths, project-local `.vscode`, in-project Poetry venv). It drops Redis, GCP/WIF auth, the toolset, Mirage and the BFF. Sources: [notes/reference_setup_findings.md](../notes/reference_setup_findings.md).

### Target layout

```
find_home/
  .agents/skills/            # canonical skills (06, 08)
  .claude/skills/            # symlinks to .agents/skills/* (06, 08)
  .vscode/                   # launch.json, tasks.json, settings.json, extensions.json
  backend/                   # FastAPI + CLI, Poetry (03, 04)
  frontend/                  # Angular (07)
  config/                    # YAML configs + schemas + *.env.example (02)
  sites/                     # site registry (05)
  infra/pgadmin/             # servers.json, pgpass
  scripts/                   # free-ports.sh, install.sh, smoke-check.sh, sync-skills.sh
  runs/                      # agent run folders with scratchpads (gitignored except README)
  data/                      # caches, exports (gitignored)
  docs/                      # google-apis.md, providers.md, ports.md
  tasks/                     # README.md, BACKLOG.md, init-project/
  guide/                     # created in 08
  docker-compose.yml  README.md  AGENTS.md  CLAUDE.md  .gitignore
```

### Steps

1. **Initialise the repo.** Run `git init` in `find_home/` with no remote. Write a root `.gitignore` that excludes `config/*.env` (but not `*.env.example`), `backend/.venv/`, `**/__pycache__/`, `frontend/node_modules/`, `frontend/dist/`, `frontend/.angular/`, `data/`, `runs/*/` (keep `runs/README.md`), `.DS_Store`, and `infra/pgadmin/pgpass` if it ever holds real credentials (here it holds dev defaults, so committing it is acceptable; match the Debug UI). Commit `tasks/init-project/` as the first commit so the planning history is preserved.

2. **Write `docker-compose.yml`.** Name the project `findhome` and keep only the data stores, mirroring the IA compose plus the Debug UI's healthcheck and pgAdmin preload:

   ```yaml
   name: findhome
   services:
     postgres:
       image: postgres:16
       container_name: fh-postgres
       environment: { POSTGRES_USER: postgres, POSTGRES_PASSWORD: postgres, POSTGRES_DB: findhome }
       ports: ["5434:5432"]
       volumes: [fh_pgdata:/var/lib/postgresql/data]
       healthcheck: { test: ["CMD-SHELL", "pg_isready -U postgres"], interval: 3s, timeout: 3s, retries: 10 }
     pgadmin:
       image: dpage/pgadmin4:8.12
       container_name: fh-pgadmin
       environment:
         PGADMIN_DEFAULT_EMAIL: admin@findhome.local
         PGADMIN_DEFAULT_PASSWORD: admin
         PGADMIN_CONFIG_SERVER_MODE: "False"
         PGADMIN_SERVER_JSON_FILE: /pgadmin4/servers.json
       ports: ["5052:80"]
       volumes: [./infra/pgadmin/servers.json:/pgadmin4/servers.json:ro, ./infra/pgadmin/pgpass:/pgadmin4/pgpass:ro]
       depends_on: { postgres: { condition: service_healthy } }
   volumes: { fh_pgdata: {} }
   ```

   Add `infra/pgadmin/servers.json`, a copy of the Debug UI's with Host `postgres`, Port `5432`, MaintenanceDB `findhome` and Group `find_home`, plus a `pgpass` file (`postgres:5432:*:postgres:postgres`, mode 600).

3. **Add the helper scripts** in `scripts/`. Base each on its Debug UI counterpart and drop the unused parts:
   - `free-ports.sh`: copy the lsof → ss → fuser logic, with `DEFAULT_PORTS=(8200 4400)`. It only frees app ports; compose ports are owned by Docker.
   - `install.sh`: check for Node ≥ 20 and Python 3.11, then run `poetry install` in `backend/` and `npm ci` in `frontend/`. Copy every `config/*.env.example` to `*.env` if missing (an `install-config` equivalent). Create the `.claude/skills/*` symlinks by calling `sync-skills.sh`.
   - `smoke-check.sh`: confirm compose services are healthy, `findhome db migrate --check` reports up to date, `curl :8200/health` returns 200, `findhome --help` exits 0 and `findhome config validate` passes. Exit non-zero on the first failure.
   - `sync-skills.sh`: for each folder in `.agents/skills/`, create a relative symlink in `.claude/skills/`. Pass `--copy` to copy instead, for when a symlink isn't picked up.

4. **Write `.vscode/tasks.json`**, with every task labelled `FH:` and every path based on `${workspaceFolder}`:
   - `FH: Free Ports` runs `scripts/free-ports.sh`.
   - `FH: Infra Up` runs `docker compose up -d --wait`, and `FH: Infra Down` runs `docker compose down`.
   - `FH: Migrate DB` runs `poetry run findhome db migrate` with cwd `backend` (the command arrives in 03/04).
   - `FH: ng serve` runs `npx ng serve --port 4400 --proxy-config proxy.conf.json` with cwd `frontend` (the app arrives in 07). It is a background task whose problem matcher has `beginsPattern` `Building|Compiling` and `endsPattern` `bundle generation complete|Compiled successfully|Watch mode enabled`, as in the Debug UI.
   - `FH: Dev Prereqs` runs, in sequence, Free Ports → Infra Up → Migrate DB → ng serve.
   - Also add `FH: Smoke Check`, `FH: Install`, `FH: Config Validate` (`poetry run findhome config validate`), `FH: Scan site` (prompts for the site slug using an input `pickString` of slugs, `promptString` fallback) and `FH: History Digest`.

5. **Write `.vscode/launch.json`.**
   - `FH: Backend (FastAPI)` is a debugpy launch of module `uvicorn` with args `findhome.api.main:app --host 127.0.0.1 --port 8200 --reload`, cwd `${workspaceFolder}/backend`, python `${workspaceFolder}/backend/.venv/bin/python`, `envFile` `${workspaceFolder}/config/backend.env`, `justMyCode: false`, and `preLaunchTask` `FH: Dev Prereqs`.
   - `FH: CLI (current args)` is a debugpy launch of module `findhome.cli.main` with `args` taken from `${input:cliArgs}`, so any CLI command can be debugged.
   - `FH: Pytest` is a debugpy launch of module `pytest`.
   - The compound `FH: Full Stack` contains the Backend config, with `stopAll` and a `postDebugTask` of `FH: Infra Down`. As in the Debug UI, the compose stack stops when debugging ends. Make that optional by also providing `FH: Full Stack (keep infra)` without the postDebugTask, because pgAdmin browsing often outlives a debug session.
   - Add `settings.json` (pytest enabled on `backend/tests`, the Python interpreter path, YAML schema associations mapping `config/*.yaml` → `config/schemas/*.schema.json` so the editor validates while typing) and `extensions.json` recommending `ms-python.python`, `ms-python.debugpy`, `redhat.vscode-yaml`, `angular.ng-template` and `ms-azuretools.vscode-docker`.

6. **Write the docs seeds.**
   - `README.md` covers prerequisites (Docker, Python 3.11 + Poetry, Node 20, optional Trafiklab/Google keys), install (`scripts/install.sh`), how to run (F5 on `FH: Full Stack`, then open http://localhost:4400), the port table, and the three-layer architecture in one paragraph with a link to `guide/overview.md` (created in 08).
   - `docs/google-apis.md` comes from [notes/google_apis_costs_and_key.md](../notes/google_apis_costs_and_key.md), with a banner saying the prices must be re-checked against Google's official pricing page before you enable billing.
   - `docs/providers.md` gives one section per provider (haversine, OSM Nominatim/OSRM, Trafiklab ResRobot with how to get a key, Google), each with an enable flag, rate limits and the env var name.
   - `docs/ports.md` lists the find_home ports next to the IA and Debug UI ports.

7. **Set up the `tasks/` convention.**
   - `tasks/README.md` defines the layout: one folder per task, holding `QA_planning.md`, `notes/`, `scripts/`, `master_plan.md` or `plan.md`, `plans/`, and a `STATUS.md` with state and outcome. It names a slug convention (`verb-object`, e.g. `verify-sites`) and states the rule that tasks hold plans and history while `guide/` describes only the current state.
   - `tasks/BACKLOG.md` lists the follow-up tasks:
     - verify-sites (4 stubs)
     - routing-providers (ResRobot and OSM working, Google optional)
     - reliability-collector (SL GTFS-RT)
     - scoring-v1
     - poi-layer
     - map-3d
     - buy-mode (Hemnet/Booli)
     - notifications
     - fill-profile-values (pending user input)

8. **Verify the foundation alone.** `docker compose up -d --wait` brings both containers to healthy. pgAdmin at http://localhost:5052 shows the preloaded server, and it connects without a password prompt. `scripts/free-ports.sh --dry-run` reports ports 8200 and 4400. Commit with message `chore: repo foundation and devx (init-project 01)`.
