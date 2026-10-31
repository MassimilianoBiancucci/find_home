# inbox/

Drop folder for agents that cannot call the find_home API, typically Claude in the desktop app (Cowork) working
through the connected folder with its built-in browser. The running backend imports every `*.json` here
automatically (on startup and whenever a file appears), then moves it to `processed/`, or to `failed/` with an
`.error.txt` explaining why. Manual import: `scripts/findhome ingest inbox`.

File shapes:

```json
{"site": "qasa", "parser": "qasa", "source": "agent_browser", "page": 1, "docs": [ ...output of sites/qasa/extract.js... ]}
```

or `{"listings": [ListingIn, ...]}` (see `.agents/skills/find-home/references/data_contract.md`).

Name files `<site>-<UTC yyyymmddThhmmss>-p<page>.json`. Everything here except this README is gitignored.

After each import the backend writes `runs/state/<site>.json` with `last_published` (newest listing seen), so
the next browser scan can extract only newer listings.
