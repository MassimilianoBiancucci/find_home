# Run: evaluate new listings

Use the `find-home` skill and its run protocol.

```yaml
inputs:  history digest; listings in status "new" without an evaluation
budget:  max 15 listings per run; floor plans/photos only for score ≥ 0.6, max 5 listings with images
outputs: one EvaluationIn per listing (ingested), status suggestions in the scratchpad
stop:    budget reached · 30 minutes
```

1. Preflight and read the history digest (liked/disliked traits matter here).
2. `scripts/findhome listings list --status new --hide-rejected --limit 15 --json` → pick the ids that have
   no evaluation yet (the digest's "To evaluate" count tells you how many exist).
3. For each id: `scripts/findhome digest listing <id> --fields full`. Open the source URL only if the digest
   lacks something decisive (pets, contract length, bedroom count). Look at the floor plan only for
   score ≥ 0.6: check that there is a separate bedroom (or a real sleeping alcove) and a safe balcony/window
   situation for indoor cats.
4. Write evaluations to `$FINDHOME_RUN_DIR/evaluations.json` as a list of EvaluationIn
   (see references/data_contract.md):
   - `summary`: 1-3 sentences, the user's perspective (two cats, commute, budget).
   - `pros` / `cons`: short phrases; reuse tag words from config/tags.yaml where they fit.
   - `questions_for_landlord`: what must be asked (cats, contract length, deposit…).
   - `extracted`: facts you read (e.g. `{"bedroom_separate": true, "balcony_glazed": false}`).
   - `pet_status` + `pet_evidence` only with a quote.
5. `scripts/findhome ingest evaluations -f $FINDHOME_RUN_DIR/evaluations.json`.
6. Do not change statuses yourself, except `rejected` with `--actor agent` when a hard fact rules it out
   (explicit no pets, fewer rooms than allowed); record a dislike with tags for it.
7. Handover: the 3 most promising, the rejections with reasons, open questions. `scripts/findhome run close`.
