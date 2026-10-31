# STATUS: init-project

**State:** done (walking skeleton), pending user confirmation of guide principles and issues.

## Outcome

| Sub-plan | Result | Commit |
|---|---|---|
| 01 Foundation & DevX | git, compose (Postgres 5434, pgAdmin 5052), `.vscode` launch/tasks, scripts, docs, tasks/ convention, backlog | `chore: repo foundation…` |
| 02 Config system | 8 YAML configs + 9 JSON Schemas, loader with cross-file checks, config hash, comment-preserving writer, hot reload | `feat(config)…` |
| 03 Backend & data model | FastAPI, SQL migration, ingest + cross-site dedupe, commute matrix (cache, budget, circuit breaker), providers, scoring v0, digests, agent launcher | `feat(backend)…` |
| 04 CLI & tools | `findhome` CLI: scan, ingest, listings, digest, commute, scores, site probe, run new/close, config, db | same commit as 03 |
| 05 Site registry | template, README, 4 unverified stubs | `feat(sites)…` |
| 06 Skill & prompts | `.agents/skills/find-home` (SKILL.md, 7 prompts, 4 references, preflight), AGENTS.md, CLAUDE.md, `scripts/findhome` | `feat(skill)…` |
| 07 Frontend | Angular 22 shell + 7 pages, MapLibre map, CodeMirror YAML editor, vitest specs | `feat(frontend)…` |
| 08 Guide | guide skill installed (merged copy), `guide/` bootstrapped, link check 0 broken | `docs(guide)…` |

Tests: backend 47 passed (35 unit/config + 12 Postgres-backed API tests, run against Postgres 16 in a separate
sandbox), frontend 4 passed, `ng build` OK. The CLI and UI were exercised end to end against a live API with the
fixture listings (screenshots checked: candidates, detail, locations, settings, sites, runs, map).

Not verified on the Mac itself: `docker compose up`, `scripts/install.sh` (Poetry on macOS, `npm ci`), F5 on
`FH: Full Stack`, map tiles from OpenFreeMap, Claude Code picking up the symlinked skills. Run
`scripts/install.sh` then `scripts/smoke-check.sh`.

## Deviations from the plan

- 03 and 04 landed in one commit (the scan runner and digests are served by the API).
- Frontend: Bootstrap CSS only (no ng-bootstrap), no client-side ajv validation (the server validates every
  config write), hand-written `models.ts` instead of generated OpenAPI types (the `FH: Generate API types` task
  was dropped). Angular 22 defaults: zoneless, vitest.
- `osm.modes` is `[drive]`: the public OSRM demo only routes cars; walk and bike use the haversine estimate.
- Scans via `POST /api/scans` run synchronously (small, polite scans), not as background jobs.
- A project `.claude/settings.json` with a permission allow-list was not created (permission changes are the
  user's call); the suggested list is in `docs/agent-permissions.md`.
- A copy of the guide skill (the `.github/skills/guide` version) appeared in `.claude/skills/guide` during the
  session and was included in the first foundation commit. It is now a symlink to `.agents/skills/guide`, which
  holds the merged skill (newest SKILL.md and skeleton from `telia_env/SKILLs/guide`, bootstrap.md and
  check_links.py from `telia_env/.github/skills/guide`).

## Open items

- User input: `config/profile.yaml` TODO(user) values (max rent, min m², move-in window, areas, sovalkov rule)
  and real addresses for `work-main` and `partner-1` in `config/locations.yaml`.
- Guide: principles and issues proposed to the user, written after confirmation.
- Follow-ups: [tasks/BACKLOG.md](../BACKLOG.md), starting with `fill-profile-values`, `verify-sites` and
  `routing-providers`.
