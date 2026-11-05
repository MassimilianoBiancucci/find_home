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

## Browser agent from the app (`browser_scan`, `site_onboarding`, `pet_agent_check`)

These profiles in `config/agent.yaml` drive **your** Chrome through the Claude in Chrome extension. Each grants
its permissions on its own command line, so they affect only that run:

- `--chrome`: Claude Code with Claude in Chrome. `--model haiku` for the scan and the pet check (procedural
  prompts), the default model for onboarding.
- `--strict-mcp-config`: only Claude in Chrome is loaded, none of your account's other connectors.
- `--permission-mode dontAsk`: anything not allowed is refused instead of waiting on a prompt nobody sees.
- `--allowedTools`: the browser tools the prompt uses, `scripts/findhome run attach|close` (plus `jobs next|submit`
  for the pet check, all of `scripts/findhome` for onboarding) and writes under `inbox/` (onboarding: `sites/`).
  Reading files in the repo needs no permission. Refused calls show up as `permission_denials` on the run.
- `--session-id`: chosen by the app and stored on the run; `--max-turns` grows with the pages or listings asked.

Each profile has two launchers on the Sites and Jobs pages: **CLI** (the app runs it in the background and streams
the log) and **VS Code** (the app opens a Claude Code tab with the prompt filled in; you press Enter and watch, and
browser actions follow the extension's normal approvals).

Before the first run, once, by hand:

1. Install the CLI: `curl -fsSL https://claude.ai/install.sh | bash` (or `brew install --cask claude-code`). It
   lands in `~/.local/bin`, which must be on the `PATH` the API runs with; otherwise set `FINDHOME_CLAUDE_BIN` in
   the API's environment to the binary.
2. Log the CLI in with `/login` (your claude.ai subscription). If `ANTHROPIC_API_KEY` or a `setup-token`
   authenticates it, Chrome integration stays off; the profiles do not pass the key through for this reason.
3. Install the Claude in Chrome extension, signed in to the same claude.ai account and organization. Run
   `claude --chrome` once: accept the dialog and check that `/chrome` shows "Enabled".
4. In the extension's site permissions, allow the sites you scan (`qasa.com`, `samtrygg.se`, `bostad.stockholm.se`
   for the pet check). Keep a single browser connected: with several, Claude Code asks which one, and a background
   run cannot answer.

Chrome must be open when a run starts; the run opens one tab and closes it.

## Recording sessions you start yourself (optional SessionEnd hook)

Runs the app starts are always recorded. A session you start by hand records itself when its prompt runs
`findhome run new` or `findhome run attach`. If such a session ends without `findhome run close` (closed tab,
crash), this hook marks its run `ended_no_handover` instead of leaving it "running". Put it in the project's
**personal** `.claude/settings.local.json` (gitignored), so it fires only for sessions in this folder:

```json
{
  "hooks": {
    "SessionEnd": [
      {"hooks": [{"type": "http", "url": "http://127.0.0.1:8200/api/hooks/session-end", "timeout": 5}]}
    ]
  }
}
```

The API ignores every session that is not a registered run, so code-work sessions leave no trace. If your
Claude Code version refuses HTTP hooks to localhost, use a command hook instead:
`{"type": "command", "command": "curl -s -X POST -H 'content-type: application/json' --data @- http://127.0.0.1:8200/api/hooks/session-end"}`.
