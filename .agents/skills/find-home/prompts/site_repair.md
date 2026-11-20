# Repair a broken site

```yaml
inputs:  sites/<slug>/ with one of the triggers below
outputs: minimal fix in site.yaml, scanner.py or a site script; dry run OK; a new field report; status active again
stop:    the site changed to something we cannot scan politely → status disabled with a note
```

Triggers:
- the scan fails or finds 0 items (`scripts/findhome site list` shows the last error);
- **coverage under 95 %** in a browser scan's report (the run's handover starts with ⚠: cards read against the
  site's counter — a page missing, the page cap reached, or the counter changed);
- **a field's coverage fell** on the last scan, e.g. photos from 90 % to 0 % (the gap audit, the Issues column on
  Candidates, or the last field report in `sites/<slug>/reports/`);
- a site script answers `{listing: null, status: 'unknown'}` or `unread` on pages that load fine.

1. Read `sites/<slug>/site.yaml`, the last error or scan report, NAVIGATION.md §3–§8 and the last field report.
2. `scripts/findhome site probe <same search URL> --slug <slug>` (add `--browser` if the HTML lost its data).
   Compare with the previous report in `probe/`. Browser sites: open one result page and one listing page and run
   the site's scripts (`await ` before the script text) to see what changed.
3. Change the minimum: a selector, a JSON path, a URL parameter, the method. Do not rewrite unrelated parts. Keep the
   translation check and the address rule (never complete a missing street or number).
4. `scripts/findhome config validate` and `scripts/findhome scan <slug> --dry-run --max-pages 1` (scripted), or the
   script's output on the page (browser sites).
5. Run the field report again ([site_field_report.md](site_field_report.md)); coverage back where it was, or the
   reason why not in NAVIGATION.md.
6. Update NAVIGATION.md (what changed on the site) and set `status: active`, `last_verified: <date and run id>`.
