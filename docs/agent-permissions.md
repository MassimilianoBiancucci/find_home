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

## Qasa scan through Claude in Chrome from the app (`claude_qasa_chrome`)

The profile in `config/agent.yaml` grants permissions on its own command line instead of a settings file, so it
affects only that run:

- `--model haiku --chrome`: Claude Code with the Claude in Chrome extension, driving **your** Chrome.
- `--permission-mode dontAsk`: anything not allowed is refused rather than waiting on a prompt nobody sees.
- `--allowedTools`: only `tabs_context_mcp`, `tabs_create_mcp`, `navigate`, `javascript_tool`, `tabs_close_mcp`
  and `Edit(./inbox/**)` (writes under `inbox/` only). Reading files in the repo needs no permission.
- `--max-turns 40`, `timeout_min: 15`.

Before the first run, once, by hand:

1. Install the Claude in Chrome extension (v1.0.36+), sign it in to the same claude.ai account and organization
   as the CLI (`claude` → `/status` shows it).
2. Log the CLI in with `/login`. If `ANTHROPIC_API_KEY` or a `setup-token` is what authenticates it, Chrome
   integration stays off (the profile does not pass the key through for this reason).
3. Run `claude --chrome` interactively once: accept the one-time dialog, check `/chrome` shows
   "Status: Enabled", and restart Chrome if the extension is not detected.
4. In the extension's site permissions, allow `qasa.com`. Keep a single browser connected (with several,
   Claude Code asks which one, and a headless run cannot answer).

Chrome must be open when you press **Run agent**; the run opens one tab in Claude's tab group and closes it.

