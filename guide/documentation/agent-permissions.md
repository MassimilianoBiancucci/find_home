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

## Browser agent from the app (`browser_scan`, `site_onboarding`, `pet_agent_check`, `listing_details`)

These profiles in `config/agent.yaml` drive **your** Chrome through the Claude in Chrome extension. Each grants
its permissions on its own command line, so they affect only that run:

- `--chrome`: Claude Code with Claude in Chrome.
- `--model {model}`: a launch parameter, chosen per run in the launch button's menu (remembered per action and
  site) or in a job's settings: Haiku, Sonnet (default for scans and the pet check) or Opus (default for
  onboarding). Pages with date pickers and in-page paging need at least Sonnet.
- `--strict-mcp-config`: only Claude in Chrome is loaded, none of your account's other connectors.
- `--permission-mode dontAsk`: anything not allowed is refused instead of waiting on a prompt nobody sees.
- `--allowedTools`: the browser tools the prompt uses, `scripts/findhome run attach|close` (plus `jobs next|submit`
  for the jobs, all of `scripts/findhome` for onboarding) and writes only where a prompt needs files (`runs/details/`,
  `runs/status/` for the CLI fallbacks; onboarding: `sites/`). A browser scan writes no file: `extract.js` posts each
  result page to the app (step 6 below).
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
5. Turn off Chrome's translation for Swedish (Settings → Languages → Google Translate: never offer for Swedish, or
   "Never translate this site" on each site). A translated page is read wrong, so the scripts answer
   `{translated: true}` and the run stops.
6. Allow **Local network access** for each browser site (`qasa.com`, `www.samtrygg.se`): open the site, click the
   site-information icon left of the address → Site settings → Local network access → Allow. The browser scan's and
   the jobs' page scripts send the page's data from the site to the app on `127.0.0.1:8200` ([agent_contract.md](../architecture/agent_contract.md#file-inbox-agents-without-api-access)),
   and Chrome holds such a request until the user allows it. A prompt left unanswered a few times turns into Block.

Chrome must be open when a run starts; the run opens one tab and closes it.

### When a browser run goes wrong

| What the run shows | Cause | Fix |
|---|---|---|
| "Browser extension is not connected" on every browser tool | extension off, or signed in to another claude.ai account | `claude --chrome`, then `/chrome` (step 3) |
| `outcome: translated` / `{translated: true}`, run `failed` | Chrome translated the page | step 5 |
| page post `posted: false`, "no answer from the app in 10 s" | Chrome is asking for local network access and nobody answered | step 6, or click Allow on the prompt |
| page post `posted: false`, "Failed to fetch" at once | local network access blocked for that site, or the API is down | step 6 (change Block to Allow); check `curl 127.0.0.1:8200/api/jobs` |
| the agent runs `jobs post-detail` for every page | the page post failed (the two rows above): the CLI fallback works but costs more tokens, and photo URLs with a query string reach the app as `[BLOCKED: …]` (the stored gallery is kept) | step 6, then run the details job again on those listings |
| the JavaScript tool answers `{}` | the script's promise was returned without `await` | the prompts put `await` before the script; check a changed prompt |
| a command answers 409 "run cancelled" | the run was cancelled on the Runs page | none: late results are parked under `inbox/cancelled/` |

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
