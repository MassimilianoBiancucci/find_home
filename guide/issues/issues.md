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

### A zone's representative point can be unroutable, and the refresh then degrades silently
**Impact: medium.** ResRobot answers `SVC_LOC` (no stop near the coordinate, about 500 m) for 22 to 37 of the 263
zone origins (the centroid, [`zone_origin`](../../backend/src/findhome/domain/connectivity.py)). After three failures
in a row [`run`](../../backend/src/findhome/domain/connectivity.py#L144) switches the rest of the run to straight-line
estimates and never switches back, so most rows end up estimated. A failed pair is not stored, so each refresh spends
calls on the same origins again. The status shows counts and the last error only.
**Fix direction:** keep failures per provider and coordinate, pause the job and ask instead of falling back, choose a
representative stop per zone, show per-route status. Planned in `tasks/advanced-zone-view/`.
