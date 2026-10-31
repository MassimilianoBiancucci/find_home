# Reference setup findings (telia_env)

Sources read (read-only): `telia_env/gcpai-se-co-debug-ui` (docker-compose.yml, launch.json.example,
tasks.json.example, install.sh, start_infra.sh, build-env.sh, free-ports.sh, rebuild-images.sh,
pgadmin/servers.json, config/debug-v2/*.example), `telia_env/Interactions_analytics` (compose,
.vscode, README, plans/, QA_planning.md), `telia_env/.vscode`, `telia_env/SKILLs/guide`.
`.env*`, `.secrets`, `.aws` were deliberately NOT opened.

## Two reference patterns
| | Debug UI v2 (big) | Interactions_analytics "IA" (small, built by the user earlier) |
|---|---|---|
| Compose | Redis, Postgres:5432, pgAdmin:5050 (servers.json + pgpass preloaded), RedisInsight, simulator, toolset | Postgres:5433 + pgAdmin:5051 only |
| App processes | 3 Python debugpy configs + BFF/Angular as *tasks* | FastAPI debugpy :8100 + Express BFF node config :3100 + Angular task :4300 |
| Env | `<proc>.env.example` -> personal `.env` (gitignored) + `build-env.sh` merges `.env.gcp` -> `.generated/` | inline `env` in launch.json + `.env.gcp` |
| Orchestration | compound `Full Stack` with `preLaunchTask` = sequence task (Free Ports -> Rebuild -> Infra -> GCP -> Compose Env -> UI stack), `postDebugTask` = infra down | compound `IA: Full Stack`, preLaunch `Dev Prereqs` (infra up + ng serve) |
| Helpers | `free-ports.sh`, `rebuild-images.sh`, `install.sh`, `start_infra.sh`, `install-config.sh` | `Migrate DB`, `Import Dataset` tasks (poetry -m src.db.*) |
| Stack | Angular 22 standalone+signals, ng-bootstrap, Express 5 + TS BFF (pg, socket.io, zod), Python FastAPI | Angular, Express BFF (axios passthrough), FastAPI, Poetry in-project `.venv` (poetry.toml), plain SQL migrations |

## Reusable mechanics worth copying
- Background-task `problemMatcher` with `beginsPattern`/`endsPattern` so a sequenced compound waits for BFF / `ng serve`.
- `dependsOrder: sequence` orchestrator task as compound `preLaunchTask`; `postDebugTask` to stop infra.
- `${workspaceFolder}`-relative paths only (the Debug UI example hard-codes `/home/ubuntu/environment/`; IA fixed that).
- Per-process `*.env.example` committed, `*.env` gitignored, one `install-config.sh` to copy them.
- `free-ports.sh` (lsof -> ss -> fuser, asks before kill, `--force`/`--dry-run`).
- pgAdmin pre-registered via mounted `servers.json` + `pgpass`.
- Compose healthchecks + `depends_on: condition: service_healthy`.
- Existing planning convention from IA: `QA_planning.md`, `notes/`, `plans/master_plan.md` + `subplan_NN_*.md`, empty `tasks/`.

## Things NOT needed for find_home
Redis/RedisInsight, ACE simulator, toolset, Mirage, Socket.IO relay, GCP/AWS WIF auth, JFrog images.
(Possibly Redis/queue later for periodic scan jobs — open question.)

## Skill layout precedent
`telia_env/.claude/skills/<name>/` (README, examples) and `SKILLs/guide/SKILL.md` + `references/` + `scripts/`
(check_links.py). Project-level skill for find_home would live in `find_home/.claude/skills/<name>/SKILL.md`.
