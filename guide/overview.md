# Guide

This guide describes find_home as it is today: what it does, how it is built, the principles every change
follows and the known limits. It wins over older notes in the repo (`tasks/`, `docs/`, READMEs). Keep it true in
the same commit as the code it describes; the [guide skill](../.agents/skills/guide/SKILL.md) says how.

Read [architecture/introduction.md](architecture/introduction.md) before any code change. Read
[architecture/config_and_locations.md](architecture/config_and_locations.md) before changing a config file's
shape, the commute matrix or scoring. Read [architecture/agent_contract.md](architecture/agent_contract.md) before
changing the CLI, the ingest/digest endpoints or the `find-home` skill.

## What the application is

find_home is a personal toolkit for finding a rental home in Stockholm for one person and two cats. Buying is
planned; the data model already carries `listing_kind` rent | buy.

It has three layers. The **app** (FastAPI, Postgres, Angular) stores listings from many sites, dedupes them across
sites, computes commute times to the user's points and scores every listing against the user's configuration. It
contains no LLM code. The **configuration** is plain YAML and Markdown (`config/`, `sites/`), validated by JSON
Schemas and edited by the user, the UI and the agent. The **skill** (`.agents/skills/find-home/`) drives an external
agent (Claude Code or Codex) to scan what scripts cannot, evaluate listings and onboard sites; the agent writes back
only through the `findhome` CLI.

External systems: listing websites (scanned by scripts or by the agent's browser), routing and geocoding providers
(haversine estimate, OSM Nominatim/OSRM, Trafiklab ResRobot, Google Routes), OSM Overpass for nearby services and
an OSM-based vector map style.

## Directory map

| Path | Content |
|---|---|
| [`backend/src/findhome/api/`](../backend/src/findhome/api/main.py) | FastAPI app and routers (`/health`, `/api/...`) |
| [`backend/src/findhome/config/`](../backend/src/findhome/config/loader.py) | YAML loading, schema validation, cross-file checks, config hash, comment-preserving writer, hot reload |
| [`backend/src/findhome/domain/`](../backend/src/findhome/domain/models.py) | API contract models, normalisation and dedupe keys, commute matrix, scoring |
| [`backend/src/findhome/providers/`](../backend/src/findhome/providers/registry.py) | routing, geocoding and POI adapters and their registry |
| [`backend/src/findhome/scanning/`](../backend/src/findhome/scanning/runner.py) | scripted site scans and the onboarding probe |
| [`backend/src/findhome/digest/`](../backend/src/findhome/digest/history.py) | history and listing digests for agents |
| [`backend/src/findhome/agentrun/`](../backend/src/findhome/agentrun/launcher.py) | run folders and the external agent launcher |
| [`backend/src/findhome/db/`](../backend/src/findhome/db/repo.py) | SQL access and the migration runner |
| [`backend/src/findhome/cli/`](../backend/src/findhome/cli/main.py) | the `findhome` CLI |
| [`backend/migrations/`](../backend/migrations/001_init.sql) | plain SQL migrations |
| [`backend/tests/`](../backend/tests/conftest.py) | unit, config and Postgres-backed API tests |
| [`frontend/src/app/`](../frontend/src/app/app.routes.ts) | Angular pages, services and the YAML editor |
| [`config/`](../config/profile.yaml) | YAML configuration and [`schemas/`](../config/schemas/locations.schema.json) |
| [`sites/`](../sites/README.md) | one folder per listing website: `site.yaml`, `NAVIGATION.md`, probes |
| [`.agents/skills/`](../.agents/skills/find-home/SKILL.md) | skills (`find-home`, `guide`); linked into `.claude/skills/` |
| [`scripts/`](../scripts/install.sh) | install, smoke check, free ports, skill sync, `findhome` wrapper |
| [`.vscode/`](../.vscode/launch.json) | debug configurations and tasks (`FH:` prefix) |
| [`docker-compose.yml`](../docker-compose.yml) | Postgres :5434 and pgAdmin :5052 |
| [`docs/`](../docs/providers.md) | providers, Google costs, ports, agent permissions |
| [`tasks/`](../tasks/README.md) | planning history and backlog (not current state) |
| [`runs/`](../runs/README.md) | agent run folders (gitignored) |

## Guide index

- [architecture/introduction.md](architecture/introduction.md): components and the main flows.
- [architecture/config_and_locations.md](architecture/config_and_locations.md): config files, points, trips and windows, config hash, commute matrix and scoring.
- [architecture/agent_contract.md](architecture/agent_contract.md): how the agent reads and writes through the CLI and API.
- [principles/](principles/): the rules every change follows (none confirmed yet).
- [issues/issues.md](issues/issues.md): known limits.
