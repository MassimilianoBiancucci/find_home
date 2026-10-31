# find_home — agent instructions

Personal toolkit for finding a rental home in Stockholm for one person and two cats (buying comes later).
Three layers: a standalone app (`backend/` FastAPI + Postgres, `frontend/` Angular, no LLM inside), open YAML
configuration (`config/`, `sites/`), and skills in `.agents/skills/` that drive you.

- **Search work** (scan sites, evaluate listings, onboard/repair a site, pet inquiries, feedback → config
  proposals): use the `find-home` skill, `.agents/skills/find-home/SKILL.md`.
- **Code work** (changing the app, configs' schemas, scripts): read `guide/overview.md` first and follow the
  `guide` skill (`.agents/skills/guide/SKILL.md`); update the guide in the same commit.

Setup and run: `scripts/install.sh`, then VS Code F5 "FH: Full Stack" (or `docker compose up -d --wait` and
`scripts/findhome serve`). The CLI is `scripts/findhome`. Check everything with `scripts/smoke-check.sh`.
Tests: `cd backend && poetry run pytest` (DB tests need Postgres on :5434).

Never commit secrets (`config/*.env`). Never store site credentials. Planning history lives in `tasks/`.
