"""Job types. A type runs in the app (`inapp`) or through an agent profile (`agent`); new types register here."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class JobType:
    key: str
    kind: str                     # inapp | agent
    label: str
    description: str
    profile: str | None = None    # agent profile in config/agent.yaml
    max_n: int = 1000


TYPES: dict[str, JobType] = {
    "pet_keywords": JobType(
        "pet_keywords", "inapp", "Pet wording rules",
        "Re-runs the strict pet wording rules (config/pet_rules.yaml) on the chosen listings, e.g. after the rules "
        "changed. Never overrides what the agent, the site or you decided; never resolves a conflict.", max_n=5000),
    "pet_agent_check": JobType(
        "pet_agent_check", "agent", "Pet policy check by the agent",
        "The agent opens each chosen listing in your Chrome, finds the exact pet sentence and records yes / no / ask "
        "with the quote (unknown when the page says nothing). Results apply at once; undo per listing.",
        profile="pet_agent_check", max_n=50),
    "listing_details": JobType(
        "listing_details", "agent", "Listing details by the agent",
        "The agent opens each chosen listing's page in your Chrome and runs the site's detail_extract.js, which hands "
        "the page's data (move-in, photos, floor, terms, description …) straight to the app. It then reads the page's "
        "free text only for what is still missing, and records each value with its quote. Results apply at once; "
        "undo per listing.", profile="listing_details", max_n=60),
    "listing_details_script": JobType(
        "listing_details_script", "inapp", "Listing details by script",
        "For sites the app may read by script (Bostadsförmedlingen): reads each chosen listing's page again, as a scan "
        "does, without tokens. Use it to refresh old listings without a full scan.", max_n=200),
}


def get(type_key: str) -> JobType:
    if type_key not in TYPES:
        raise KeyError(f"unknown job type '{type_key}'")
    return TYPES[type_key]
