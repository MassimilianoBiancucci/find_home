"""Who decides a listing's pet status: user > agent > site > keywords. A lower source never overwrites a higher
one, `unknown` never overwrites a known value, and keywords never resolve a conflict."""
from __future__ import annotations

from typing import Any

from findhome.pets.detect import detect

RANK = {"keywords": 1, "site": 2, "agent": 3, "user": 4}
KNOWN = ("yes", "no", "ask", "conflict")


def apply_pet(current_status: str | None, current_source: str | None, status: str | None, evidence: str | None,
              source: str) -> dict[str, Any] | None:
    """The update to write ({pet_status, pet_evidence, pet_source}), or None to keep the current value."""
    if not status or status == "unknown":
        if current_status is None:              # a new listing: record that nobody knows yet
            return {"pet_status": "unknown", "pet_evidence": None, "pet_source": None}
        return None
    if current_status in KNOWN and RANK.get(source, 0) < RANK.get(current_source or "", 0):
        return None
    return {"pet_status": status, "pet_evidence": evidence, "pet_source": source}


def ingest_candidate(item) -> tuple[str, str | None, str]:
    """(status, evidence, source) for a listing arriving at ingest.

    - The site's structured flag (attributes.pets_flag = {"value": true|false, "evidence": "..."}) is the site's
      answer; the text is checked against it, and a yes/no contradiction is a `conflict` (source site).
    - Without a flag, an explicit pet_status sent with the listing is the sender's (agent for browser/manual
      ingests, site for scripted scanners).
    - Otherwise the wording rules decide (source keywords), `unknown` when no explicit phrase is found.
    """
    attrs = item.attributes or {}
    flag = attrs.get("pets_flag") or {}
    text = " \n".join(str(x) for x in (item.title, item.description_excerpt, attrs.get("pets_text")) if x)
    found = detect(text)
    value = flag.get("value")
    if value in (True, False):
        site_status = "yes" if value else "no"
        site_ev = flag.get("evidence") or f"site flag: pets {'allowed' if value else 'not allowed'}"
        if found.status in ("yes", "no") and found.status != site_status:
            return "conflict", f"{site_ev} / text: {found.evidence}", "site"
        return site_status, site_ev, "site"
    if item.pet_status and item.pet_status != "unknown":
        source = "agent" if item.source.method in ("agent_browser", "manual") else "site"
        return item.pet_status, item.pet_evidence, source
    return found.status, found.evidence, "keywords"
