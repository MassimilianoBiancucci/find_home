# inbox/

Drop folder for agents that cannot call the find_home API, typically Claude in the desktop app (Cowork) working
through the connected folder with its built-in browser. The running backend imports every `*.json` here
automatically (on startup and whenever a file appears), then moves it to `processed/`, or to `failed/` with an
`.error.txt` explaining why. Manual import: `scripts/findhome ingest inbox`.

File shapes:

```json
{"site": "qasa", "parser": "qasa", "source": "agent_browser", "run": "<run id>", "page": 1, "docs": [ ...output of sites/qasa/extract.js... ]}
```

or `{"listings": [ListingIn, ...], "run": "<run id>"}` (see `.agents/skills/find-home/references/data_contract.md`).

`run` groups files into one scan run: use the agent run id the app gave you (`run=<id>` in your prompt), or any
batch id shared by every file of the same scan. A file without `run` is recorded as a scan of its own.

Name files `<site>-<UTC yyyymmddThhmmss>-p<page>.json`. Everything here except this README is gitignored.

After each import the backend writes `runs/state/<site>.json` with `last_published` (newest listing seen), so
the next browser scan can extract only newer listings.
