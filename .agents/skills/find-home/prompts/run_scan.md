# Run: scan for new candidates

Use the `find-home` skill (.agents/skills/find-home/SKILL.md) and follow its run protocol.

```yaml
inputs:  config/*.yaml, sites/*/site.yaml, history digest
budget:  routing calls: providers.yaml budget; browser: max 3 agent_browser sites, max 5 pages each
outputs: new/changed listings ingested, commute + scores computed, scratchpad Handover, run closed
stop:    API down · config invalid · budget reached · 45 minutes
```

1. `bash .agents/skills/find-home/scripts/preflight.sh`, then export the two printed variables.
2. Read `$FINDHOME_RUN_DIR/context/history_digest.md`. Write the Goal in the scratchpad.
3. `scripts/findhome site list`. For `active` sites: `scripts/findhome scan --all`. Note each site line
   in Findings. If a site reports parse errors or 0 items, set its `status: broken` in `sites/<slug>/site.yaml`,
   validate, and list it under Decisions (do not repair it in this run).
4. For `active` sites with `fetch.method: agent_browser`: follow `prompts/browser_scan.md`.
5. Take the new or changed short ids (from the scan lines, or
   `scripts/findhome listings list --since <run start ISO time> --hide-rejected`):
   - `scripts/findhome commute <ids> --dry-run` → if within budget, run it without `--dry-run`.
   - `scripts/findhome scores recompute`.
6. `scripts/findhome listings list --hide-rejected --limit 10` and record the top new ones in Findings
   (short id + one reason each).
7. If listings have `pet_status` ask/unknown and score in the top 10, draft inquiries with
   `prompts/pet_inquiry.md` (drafts only).
8. Fill Handover: how many new, the best 3 by short id, anything needing the user (broken sites, missing
   config values such as `TODO(user)` in profile.yaml). `scripts/findhome run close`.
