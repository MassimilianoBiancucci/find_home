# HomeQ — navigation guide

Status: **origin-only** (never scanned).

HomeQ lists first-hand rentals from landlords. Many of them are also published on Qasa with `platform = "homeq"`;
the `qasa` site finds them and [`../qasa/site.yaml`](../qasa/site.yaml) `platforms` maps `homeq` to this site, so
the app shows HomeQ as their origin. Scanning homeq.se directly has not been investigated; that would be a new
onboarding with `prompts/site_onboarding.md`.
