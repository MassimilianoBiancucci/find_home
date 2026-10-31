# Repair a broken site

```yaml
inputs:  sites/<slug>/ with status broken (scan errors or 0 items)
outputs: minimal fix in site.yaml (or scanner.py), dry run OK, status active again
stop:    the site changed to something we cannot scan politely → status disabled with a note
```

1. Read `sites/<slug>/site.yaml`, the last scan error (`scripts/findhome site list`) and NAVIGATION.md §3-§7.
2. `scripts/findhome site probe <same search URL> --slug <slug>` (add `--browser` if the HTML lost its data).
   Compare the new report with the previous one in `probe/`.
3. Change the minimum: a selector, a JSON path, a URL parameter, the method. Do not rewrite unrelated parts.
4. `scripts/findhome config validate` and `scripts/findhome scan <slug> --dry-run --max-pages 1`.
5. Update NAVIGATION.md (what changed on the site) and set `status: active`, `last_verified: <run id>`.
