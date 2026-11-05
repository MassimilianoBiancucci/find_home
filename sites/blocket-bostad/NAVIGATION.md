# Blocket Bostad — navigation guide

Status: **origin-only** (never scanned).

`bostad.blocket.se` serves Qasa's web app: the same robots.txt, sitemap and bot checkpoint as qasa.com. Blocket's
rental listings are published on Qasa, where each one carries `platform = "blocket"`. The `qasa` site finds them;
[`../qasa/site.yaml`](../qasa/site.yaml) `platforms` maps `blocket` to this site so the app shows Blocket as the
listing's origin.

Do not onboard this site for scanning: it would scan the same data as Qasa, behind the same protection.
