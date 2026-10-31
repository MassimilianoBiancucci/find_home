# Turn feedback into search adjustments

```yaml
inputs:  history digest (liked/disliked traits, rejected reasons, pipeline), config/*.yaml
outputs: $FINDHOME_RUN_DIR/proposed_config.patch.yaml + a short rationale in the scratchpad
rule:    propose only; the user applies changes in the app (Settings) or asks you to
```

1. Read the history digest. Look for patterns with at least 3 occurrences (e.g. `too_far×5` mostly for one
   point, `noisy×4` on main streets, many `over_budget` near the limit).
2. Map each pattern to a concrete, small config change:
   - weights in `profile.yaml` preferences (±1 at a time);
   - `areas_include` / `areas_exclude`;
   - a point's trip windows or weight in `locations.yaml`; a new generic point the user keeps mentioning;
   - POI radius/weight in `poi.yaml`; new tags in `tags.yaml`.
3. Write them as JSON-patch-style ops per file, e.g.
   ```yaml
   profile:
     - {op: replace, path: /kinds/rent/preferences/commute/weight, value: 5, why: "too_far×6, all for work-main"}
   ```
4. Summarise in Decisions (one line per change, with the evidence). Do not edit the YAML files yourself.
