"""Normalisation helpers shared by scanners and ingest: Swedish number/room/rent formats,
pet wording, contract types, dedupe keys and content hashes."""
from __future__ import annotations

import hashlib
import json
import re
import secrets
import unicodedata
from typing import Any

from findhome.domain.models import ListingIn

_NUM = re.compile(r"(\d[\d\s .]*(?:[.,]\d+)?)")
_SHORT_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"  # no 0/O/1/I/L


def parse_number(text: str | None) -> float | None:
    """'12 500 kr/mån' → 12500; '54,5 m²' → 54.5; '2 rok' → 2."""
    if text is None:
        return None
    if isinstance(text, (int, float)):
        return float(text)
    m = _NUM.search(str(text))
    if not m:
        return None
    raw = m.group(1).replace(" ", " ").strip()
    # thousands separators: spaces or dots followed by exactly 3 digits
    raw = re.sub(r"[\s.](?=\d{3}\b)", "", raw).replace(" ", "")
    raw = raw.replace(",", ".")
    try:
        return float(raw)
    except ValueError:
        return None


def parse_int(text: Any) -> int | None:
    value = parse_number(text)
    return int(round(value)) if value is not None else None


def parse_rooms(text: str | None) -> tuple[float | None, bool | None]:
    """Returns (rooms_rok, has_sovalkov). '1 rok + sovalkov' → (1, True); '2,5 rum' → (2.5, None)."""
    if not text:
        return None, None
    lower = str(text).lower()
    sovalkov = True if "sovalkov" in lower or "alkov" in lower else None
    return parse_number(lower), sovalkov


PET_PATTERNS: list[tuple[str, str]] = [
    # order matters: negative phrases first
    (r"(inga|ej|inte|no)\s+(husdjur|djur|pets)", "no"),
    (r"husdjur\s+(ej|inte)\s+(till[aå]tna|ok)", "no"),
    (r"pets\s+not\s+allowed", "no"),
    (r"(husdjur|djur)\s+(enligt\s+överenskommelse|efter\s+överenskommelse|kan\s+diskuteras)", "ask"),
    (r"pets\s+(negotiable|on\s+request)", "ask"),
    (r"(husdjur|djur|katt(er)?)\s+(är\s+)?(till[aå]tna|välkomna|ok)", "yes"),
    (r"pets\s+(allowed|welcome|ok)", "yes"),
]


def pet_status_from_text(text: str | None) -> tuple[str, str | None]:
    """Map listing wording to (pet_status, evidence). No match → ('unknown', None)."""
    if not text:
        return "unknown", None
    lower = text.lower()
    for pattern, status in PET_PATTERNS:
        m = re.search(pattern, lower)
        if m:
            start = max(0, m.start() - 20)
            return status, text[start:m.end() + 20].strip()
    return "unknown", None


CONTRACT_WORDS = {
    "förstahand": "first_hand", "first-hand": "first_hand", "first hand": "first_hand", "hyresrätt": "first_hand",
    "andrahand": "second_hand", "second-hand": "second_hand", "second hand": "second_hand",
    "inneboende": "sublet", "lodger": "sublet", "sublet": "sublet",
}


def contract_type_from_text(text: str | None) -> str | None:
    if not text:
        return None
    lower = text.lower()
    for word, value in CONTRACT_WORDS.items():
        if word in lower:
            return value
    return None


def _fold(text: str) -> str:
    text = unicodedata.normalize("NFKD", text.lower())
    text = "".join(c for c in text if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9 ]+", " ", text)


def normalize_address(address: str | None) -> str | None:
    """'Hornsgatan 12, 2 tr, Södermalm' → 'hornsgatan 12'. Street + number only."""
    if not address:
        return None
    first = _fold(address.split(",")[0])
    m = re.match(r"\s*([a-z ]+?)\s+(\d+\s?[a-z]?)\b", first)
    return f"{m.group(1).strip()} {m.group(2).replace(' ', '')}" if m else first.strip() or None


def dedupe_key(item: ListingIn) -> str | None:
    """Cross-site identity: street+number | floor | size rounded | rent band (500 SEK)."""
    addr = normalize_address(item.address_raw)
    if not addr:
        return None
    size = str(int(round(item.size_m2))) if item.size_m2 else "?"
    floor = str(item.floor) if item.floor is not None else "?"
    money = item.rent_sek if item.listing_kind == "rent" else item.price_sek
    band = str(int(money // 500)) if money else "?"
    return f"{item.listing_kind}|{addr}|{floor}|{size}|{band}"


CONTENT_FIELDS = (
    "title", "address_raw", "size_m2", "rooms_rok", "has_sovalkov", "floor", "has_elevator", "has_balcony",
    "rent_sek", "deposit_sek", "contract_type", "contract_start", "contract_end", "price_sek", "avgift_sek",
    "pet_status", "available_from", "description_excerpt", "furnished",
)


def content_hash(item: ListingIn) -> str:
    data = item.model_dump(mode="json", include=set(CONTENT_FIELDS))
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()[:16]


def new_short_id(prefix: str = "L") -> str:
    return f"{prefix}-" + "".join(secrets.choice(_SHORT_ALPHABET) for _ in range(4))
