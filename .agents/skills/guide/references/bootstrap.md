# Starting a guide in a repo that has none

Goal: a first, small guide that is true. It can stay rough; it must not be wrong or invented.

1. **Agree the scope with the user.** Confirm the target folder (`guide/` at the repo root) and whether older notes exist (`docs/`, `memories/`, `.serena/`, wikis). Older notes are sources to read, not to copy.

2. **Create the skeleton** from [skeleton.md](skeleton.md): `overview.md`, `architecture/introduction.md`, `principles/`, `issues/issues.md`.

3. **Overview from the code.** Read the README, the entry points, the build and deploy files, and the top-level folders. Write what the app is, the directory map and the index.

4. **Architecture from the code.** One short introduction: the main components, one paragraph each, and how a request or job flows through them. Add a topic page only for flows the user says matter. Mark sections you could not verify with `*To be detailed:*` rather than guessing.

5. **Principles: propose, never invent.** Collect candidates only from evidence:
   - tests that guard a rule (visibility, scope, contracts)
   - lint and formatter configs, CODEOWNERS, PR templates
   - repeated review comments or conventions the user names
   - rules stated in existing docs
   Present the list to the user, one line each with its source. Write a principle only when the user confirms it, in the principle format. Leave "Enforced by: Review" when no test exists.

6. **Issues: propose, never invent.** Candidates from `TODO`/`FIXME`/`HACK` comments, disabled tests, and what the user tells you. Keep only limits that affect how code must be written.

7. **Wire it in.** Add one line to the agent instruction files the repo uses (see the snippet shipped with this skill): `.github/copilot-instructions.md` for Copilot, `CLAUDE.md` for Claude, `AGENTS.md` if present.

8. **Check.** Run `scripts/check_links.py`, then tell the user what was written, what is marked to be detailed, and which principles are still waiting for confirmation.

The first guide goes in its own PR, reviewed by the team, since its principles become the shared agreement.
