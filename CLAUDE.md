# find_home

Read [AGENTS.md](AGENTS.md): it is the shared instruction file for Claude Code and Codex.

Skills live in `.agents/skills/` (single source of truth) and are linked into `.claude/skills/` by
`scripts/sync-skills.sh`: `find-home` for search work, `guide` for code work.
