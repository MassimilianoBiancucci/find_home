# Token rules

The point of the tools is that you read **compact, already-structured text**. Budgets per run:

| Item | Budget |
|---|---|
| History digest | read once at start (≈1.5k tokens) |
| Listing digests | core for triage; `--fields full` only for listings you evaluate |
| Evaluations per run | 15 |
| Listings with images (floor plan/photos) | 5, and only with score ≥ 0.6 |
| Browser pages per site | `politeness.max_pages_per_run`, max 5 detail pages |
| Routing calls | `providers.yaml budget.max_routing_calls_per_run`; always `commute --dry-run` first |

Never load:
- raw HTML/JSON of result pages (saved under `data/raw/`; cite the path if needed);
- whole config files when one key matters (`scripts/findhome config show <name> --json` and pick);
- listings the digest marks rejected/archived, unless the user asks;
- `guide/`, `backend/`, `frontend/` code for search work.

Prefer: `listings exists` before opening a page · `--since <last run>` to see only changes ·
short ids (`L-XXXX`) instead of URLs in notes.
