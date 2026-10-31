# runs/

One folder per agent run: `runs/<UTC timestamp>-<profile>/`, created by `findhome run new <profile>`
or by the app's "Run agent" button. Contents:

| File | Purpose |
|---|---|
| `run.yaml` | Manifest: profile, prompt file, started_at, run id |
| `scratchpad.md` | The agent's working notes (Goal, Context loaded, Sites planned, Findings, Decisions, Handover) |
| `context/history_digest.md` | Compact history the agent reads first |
| `log.jsonl` | stdout/stderr of app-started runs |
| `proposed_config.patch.yaml` | Config changes the agent proposes (applied only after user approval) |

Run folders are gitignored (personal, bulky). Only this README is committed.
