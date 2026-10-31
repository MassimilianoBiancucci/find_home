## Plan: Guide bootstrap

Once the walking skeleton runs, install the user's `guide` skill in find_home and use it to start `guide/`, following the skill's own `references/bootstrap.md`. The guide is the reviewed description of the code as it is today: overview, architecture, principles and known issues. Code-change agents read it, while the `find-home` skill serves search work. It is written from the code that 01–07 produced, never from these plans.

Principles and issues are proposed to the user and written only after confirmation. Source check from the QA:

- The newest `SKILL.md` is `telia_env/SKILLs/guide/` (includes "Logging an issue"), but that copy lacks `references/bootstrap.md` and `scripts/check_links.py`.
- Those files exist only in `telia_env/.github/skills/guide/`, next to an older `SKILL.md`.

### Steps

1. **Install the guide skill** into `.agents/skills/guide/`:
   - `SKILL.md` from `telia_env/SKILLs/guide/SKILL.md` (newest);
   - `references/skeleton.md`, `references/bootstrap.md` and `scripts/check_links.py` from `telia_env/.github/skills/guide/`.

   Then run `scripts/sync-skills.sh` so `.claude/skills/guide` is linked too. These are copies, so telia_env stays untouched. Add a line to `tasks/BACKLOG.md` noting that the two telia_env copies have diverged, and that the merged version now lives in find_home.

2. **Agree the scope with the user** (bootstrap step 1):
   - The target is `guide/` at the repo root.
   - The older notes, to read but not copy, are `tasks/init-project/` (QA, notes, plans), `docs/`, `sites/README.md`, `README.md` and the skill references.

   Ask once and continue on the answer.

3. **Create the skeleton and overview** (bootstrap steps 2-3).
   - Create `guide/overview.md`, `guide/architecture/introduction.md`, `guide/principles/` and `guide/issues/issues.md` from `skeleton.md`.
   - Write the overview from the code: what the app is (three layers, no GenAI inside the app), a directory map with relative links to `backend/src/findhome/*`, `frontend/src/app/*`, `config/`, `sites/`, `.agents/skills/`, `scripts/`, `.vscode/` and `tasks/`, and the guide index.

4. **Write the architecture from the code** (bootstrap step 4).
   - `architecture/introduction.md` gets one paragraph per component: compose infra, FastAPI API, migrations and data model, config system, provider adapters, scanning, digests, agent-run launcher, Angular UI, skill. Add a mermaid flow for "agent run → CLI → API → DB → UI" and one for "config edit → validate → hash → recompute".
   - Add topic pages only for flows the user names. Likely candidates to offer: `architecture/config_and_locations.md` (points, trips, windows, hash) and `architecture/agent_contract.md` (ingest/digest/run folders).
   - Mark anything unverified with `*To be detailed:*`.

5. **Propose principles, never invent them** (bootstrap step 5). Present candidates to the user one line each, with their evidence, and write only the confirmed ones in the Rule/Why/Bad/Good/Enforced-by format. Candidates, all from decisions recorded in QA_planning.md or tests written in 02–07:

   | Candidate | Evidence | Possible enforcement |
   |---|---|---|
   | No LLM calls inside the app; GenAI lives in the skill | QA T6/R3 | Test: forbid `anthropic`/`openai` imports in `backend/` and `frontend/` deps |
   | Agents write only via `findhome` CLI/API and YAML configs | QA T9 | Review |
   | Configuration over code: limits, weights, points, slots, tags, providers live in YAML with a schema | QA T4/A2, T6/A3 | `config validate` + schema tests |
   | Every derived score/commute result records its `config_hash` | Review pass 1 | DB constraint + test |
   | Paid providers off by default, budgeted, cached | QA T4, Google notes | Test on `providers.yaml` defaults |
   | Digest-first, token-budgeted agent runs | QA T7 | Golden-file size test |
   | Sites: cheapest fetch method first, politeness and no stored credentials | QA T6, review | Schema (`politeness` required) + review |

6. **Propose issues and wire it in** (bootstrap steps 6-7).
   - Issue candidates come from `TODO`/`FIXME` in the code and from the open items: profile values pending (`TODO(user)`), unverified site stubs, ResRobot free status and arrive-by, Google transit tier, the Claude symlink discovery result, no auth on the local API, the map style licence.
   - Keep only the limits that affect how code must be written.
   - Add one line to `CLAUDE.md` and `AGENTS.md`: "Before changing code, read `guide/overview.md` and follow the guide skill."

7. **Check and hand over** (bootstrap step 8).
   - Run `python3 .agents/skills/guide/scripts/check_links.py --guide-dir guide` until it exits 0, then run `scripts/smoke-check.sh`.
   - Tell the user what was written, what is marked to be detailed, and which principles are waiting for confirmation.
   - Update `tasks/init-project/STATUS.md` to `done`, listing the follow-ups in `tasks/BACKLOG.md`.
   - Commit the guide separately, since its principles become the shared agreement: `docs(guide): bootstrap guide (init-project 08)`.
