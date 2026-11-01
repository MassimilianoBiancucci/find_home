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
