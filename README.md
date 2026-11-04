# find_home

A personal toolkit for finding a home in Stockholm for one person and two cats. Renting comes first; buying is
planned. It has three layers that stay separate:

1. **The app** (`backend/`, `frontend/`, `docker-compose.yml`): FastAPI + Postgres + Angular, no GenAI inside.
   It stores and dedupes listings, computes commute and nearby-service metrics, scores candidates against your
   configuration, shows a 2D/3D map, records your feedback and can start an agent run.
2. **Open configuration** (`config/`, `sites/`): YAML and Markdown files validated by JSON Schemas. Limits, weights,
   locations and their time slots, tags, providers and per-site scan rules all live here.
3. **The skill** (`.agents/skills/find-home/`): instructions and prompts for Claude Code or Codex to scan, evaluate
   and onboard sites, writing results back through the `findhome` CLI.

Code-level documentation lives in [`guide/`](guide/overview.md). Planning history lives in [`tasks/`](tasks/README.md).

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Docker (Desktop or colima) | recent | Postgres :5434, pgAdmin :5052 |
| Python | 3.11 | backend interpreter |
| Poetry | ≥ 1.8 | `pipx install poetry`; venv is created in `backend/.venv` |
| Node.js | 20+ | Angular dev server |
| Claude Code or Codex CLI | optional | for agent runs |
| Trafiklab / Google keys | optional | see [providers](guide/documentation/providers.md) |

## Install and run

Open the `find_home` folder as the VS Code workspace and press F5 on **FH: Full Stack**. It frees the app ports,
creates anything missing (`backend/.venv` with Poetry or uv, `frontend/node_modules`, `config/*.env`), starts
Postgres and pgAdmin, applies migrations, starts Angular as a background task, then launches FastAPI under the
debugger. There is one app debug configuration. The first run takes a few minutes because of the installs.

Infrastructure startup uses `scripts/infra-up.sh`: it stops all existing project containers, starts them with
the current Compose configuration, and waits up to 90 seconds for both services to be healthy. Compose recreates
containers whose configuration changed. A startup failure prints diagnostics and stops the containers.
Ending **FH: Full Stack** stops Angular and all project containers; restarting it runs the same startup sequence.

Postgres stores its database files in the local, gitignored `data/postgres/` folder, bind-mounted into the
container. Stopping or deleting containers, including `docker compose down -v`, preserves this folder.
Keep it when cleaning the repo; deleting `data/postgres/` deletes the database. Local database backups belong
under the gitignored `data/backups/` folder.

`scripts/install.sh` does the same installs from a terminal and forces a clean reinstall.

| URL | What |
|---|---|
| http://localhost:4400 | the app |
| http://localhost:8200/docs | API (OpenAPI) |
| http://localhost:5052 | pgAdmin (server preloaded) |

Without VS Code: `scripts/infra-up.sh`, then `backend/.venv/bin/findhome db migrate`,
`backend/.venv/bin/findhome serve` and `cd frontend && npx ng serve --port 4400 --proxy-config proxy.conf.json`.

Check everything: `scripts/smoke-check.sh`.

## Your personal files

The repo is meant to be public, so what is personal stays on your machine. Where you work, your budget and your
keys live in `config/locations.yaml`, `config/profile.yaml`, `config/search_area.yaml`, `config/providers.env` and
`config/backend.env`. All five are **gitignored**; the repo holds a dummy `*.example.*` file for each.
`scripts/ensure-env.sh` (run by `scripts/install.sh` and by F5) creates a missing real file from its example and
never overwrites it. After the first run, edit the copies, then `scripts/findhome config validate`. Which file holds
what, and how to add one: [config/README.md](config/README.md). The rule behind it:
[guide/principles/personal_data.md](guide/principles/personal_data.md).

## Everyday commands

```bash
findhome config validate          # after editing any YAML
findhome scan --all               # scripted scan of active sites
findhome digest history           # what has been seen, liked, rejected
findhome commute L-7Q2K --dry-run # how many routing calls a commute matrix would cost
```

Ports and how they avoid the other local stacks: [ports](guide/documentation/ports.md).
