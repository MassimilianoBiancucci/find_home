# Known issues

Known limits and pending fixes that an agent should know before touching an area, grouped by area. One entry per
open problem; delete it when fixed. Format: [skeleton](../../.agents/skills/guide/references/skeleton.md).

## Publishing

### Git history still holds personal data
**Impact: high before the repository is made public.** Older commits (4 of 28) contain the real workplace and partner
places and their coordinates in `config/locations.yaml`, in the tests and in the planning notes. The working tree is
clean (see [personal_data.md](../principles/personal_data.md)), but a public repository exposes every commit. Commit
author emails are real, and `tasks/` and some code comments name a private employer's repositories (`telia_env`).
**Fix direction:** publish from a fresh history (a new repository seeded with the current tree) or rewrite history
with `git filter-repo` into a new remote; decide first what to do with the author email and the employer references.
Check with `git log -p --all -S"<term>"`.

## Connectivity matrix

### Walks to a free-placed centroid are counted twice
**Impact: low.** With `centroids.strategy: stops` a centroid is a free point, not a stop. The comparison pass
([`derive()`](../../backend/src/findhome/domain/connectivity_derive.py#L36)) adds the home's walk to that point and
ResRobot's trip from it, which starts with its own walk to the boarding stop. A zone's minutes are therefore too high
by up to two circle radii (2 × `range_m`), the same for every zone.
**Fix direction:** keep the trip's first walk leg and boarding stop (`TravelResult.raw`), subtract that walk, and add
the home's network walk to the boarding stop instead.

## Agent launcher

### Browser runs need a connected Claude in Chrome extension
**Impact: medium.** The `browser_scan`, `site_onboarding` and `pet_agent_check` profiles drive your Chrome through
the Claude in Chrome extension ([`config/agent.yaml`](../../config/agent.yaml)). When the extension is not
connected or signed in to another claude.ai account, every browser tool answers "Browser extension is not
connected" and the run closes as `failed`; `claude --chrome` then `/chrome` shows the connection. The VS Code
launcher also needs Claude in Chrome turned on in the VS Code extension, otherwise its session has no browser tools.
File permissions in the profiles must use `Edit(<path>)` rules (they cover Write too); a `Write(<path>)` rule
alone was refused in a headless run.
**Fix direction:** keep `permission_denials` on the Runs page as the check after each profile change; a
connection check before launch (the CLI has no non-interactive one today) would turn these into a clear refusal.
