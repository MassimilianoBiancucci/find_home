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
| Trafiklab / Google keys | optional | see [docs/providers.md](docs/providers.md) |

## Install and run

```bash
scripts/install.sh              # backend deps, frontend deps, personal env files, skill links
```

Open the `find_home` folder as the VS Code workspace and press F5 on **FH: Full Stack**. It frees the app ports,
starts Postgres and pgAdmin, applies migrations, starts `ng serve` and launches FastAPI under the debugger.

| URL | What |
|---|---|
| http://localhost:4400 | the app |
| http://localhost:8200/docs | API (OpenAPI) |
| http://localhost:5052 | pgAdmin (server preloaded) |

Without VS Code: `docker compose up -d --wait`, then `backend/.venv/bin/findhome db migrate`,
`backend/.venv/bin/findhome serve` and `cd frontend && npx ng serve --port 4400 --proxy-config proxy.conf.json`.

Check everything: `scripts/smoke-check.sh`.

## Everyday commands

```bash
findhome config validate          # after editing any YAML
findhome scan --all               # scripted scan of active sites
findhome digest history           # what has been seen, liked, rejected
findhome commute L-7Q2K --dry-run # how many routing calls a commute matrix would cost
```

Ports and how they avoid the other local stacks: [docs/ports.md](docs/ports.md).
