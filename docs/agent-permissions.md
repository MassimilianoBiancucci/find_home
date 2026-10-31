# Agent permissions for headless runs

Scheduled or app-started runs (`claude -p`, `codex exec`) cannot answer permission prompts. If you want them to
run unattended, allow exactly what the `find-home` skill needs. This is **your** decision, so it is not
pre-configured in the repo. For Claude Code, a project-level `.claude/settings.json` could look like:

```json
{
  "permissions": {
    "allow": [
      "Bash(scripts/findhome:*)",
      "Bash(bash .agents/skills/find-home/scripts/preflight.sh)",
      "Edit(config/**)",
      "Edit(sites/**)",
      "Edit(runs/**)",
      "Write(runs/**)",
      "Write(sites/**)"
    ],
    "deny": ["Read(config/*.env)", "Edit(config/*.env)"]
  }
}
```

For Codex, use its approval/sandbox settings for `codex exec` (check your Codex version's docs) with the same
scope: the `scripts/findhome` CLI, and writes limited to `config/`, `sites/` and `runs/`.

Browser-based scanning (`agent_browser` sites) additionally needs a browser tool in the agent (Claude in Chrome,
the Claude desktop browser, or Playwright).
