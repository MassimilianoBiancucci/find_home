"""Compact listing digest: a fixed ~150-token block per listing for agents and the UI's
"copy for agent" button. Same text everywhere (CLI, API, UI)."""
from __future__ import annotations

from collections import defaultdict
from typing import Any

from findhome.db import repo

GROUP_SHORT = {"cost": "cost", "space": "space", "commute": "commute", "cat_suitability": "cats",
               "building_comfort": "building", "contract_availability": "contract", "neighbourhood": "neighbourhood", "area": "area",
               "transport": "transport", "services": "services"}
CONTRACT_SHORT = {"first_hand": "1st-hand", "second_hand": "2nd-hand", "sublet": "sublet", "unknown": "?"}


def _fmt_money(v: Any) -> str:
    return f"{int(v):,} kr".replace(",", " ") if v is not None else "? kr"


def _num(v: Any, unit: str = "") -> str:
    if v is None:
        return f"?{unit}"
    f = float(v)
    return f"{int(f) if f.is_integer() else f}{unit}"


def commute_summary(commute: list[dict]) -> str:
    """Per point: the mode with the best median; that mode's best-window median, its p90, and its worst
    sample over all windows when much worse ('!' style hint for unreliable trips). '~' = estimate only."""
    by_pm: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for c in commute:
        if c.get("median_min") is not None:
            by_pm[(c["point_id"], c["mode"])].append(c)
    best: dict[str, tuple[str, list[dict]]] = {}
    for (pid, mode), rows in by_pm.items():
        m = min(float(r["median_min"]) for r in rows)
        if pid not in best or m < min(float(r["median_min"]) for r in best[pid][1]):
            best[pid] = (mode, rows)
    parts = []
    for pid, (mode, rows) in best.items():
        top = min(rows, key=lambda r: float(r["median_min"]))
        worst = max(float(r["worst_min"]) for r in rows if r.get("worst_min") is not None)
        txt = f"{pid} {mode} {round(float(top['median_min']))}′"
        if top.get("p90_min") is not None and float(top["p90_min"]) > float(top["median_min"]):
            txt += f"/{round(float(top['p90_min']))}′p90"
        if worst > float(top["median_min"]) + 15:
            txt += f" (worst {round(worst)}′)"
        if top.get("provider") == "haversine":
            txt += "~"
        parts.append(txt)
    return " · ".join(parts) if parts else "not computed"


def tags_summary(feedback: list[dict]) -> str:
    out = []
    for fb in feedback:
        sign = {"like": "+", "dislike": "−"}.get(fb["polarity"], "")
        out += [f"{sign}{t}" for t in fb["tags"]]
    return " ".join(dict.fromkeys(out)) or "-"


def render(L: dict, commute: list[dict], feedback: list[dict], score: dict | None,
           evaluations: list[dict] | None = None, sources: list[dict] | None = None, full: bool = False) -> str:
    rooms = f"{_num(L.get('rooms_rok'))}rok" + ("+alkov" if L.get("has_sovalkov") else "")
    money = _fmt_money(L.get("rent_sek")) if L["listing_kind"] == "rent" else _fmt_money(L.get("price_sek"))
    where = ", ".join(x for x in (L.get("area"), L.get("address_raw")) if x) or "address ?"
    bits = []
    if L.get("floor") is not None:
        bits.append(f"fl {L['floor']}")
    if L.get("has_elevator"):
        bits.append("lift")
    if L.get("has_balcony"):
        bits.append("balcony")
    line1 = f"{L['short_id']} {L['listing_kind']} {rooms} {_num(L.get('size_m2'), 'm²')} {money}  {where}"
    if bits:
        line1 += f" ({', '.join(bits)})"
    ev = f' ("{L["pet_evidence"][:60]}")' if L.get("pet_evidence") else ""
    contract = CONTRACT_SHORT.get(L.get("contract_type") or "unknown", "?")
    if L.get("contract_end"):
        contract += f" → {L['contract_end']}"
    avail = f"  from: {L['available_from']}" if L.get("available_from") else ""
    line2 = f"pets: {L.get('pet_status', 'unknown')}{ev}  contract: {contract}{avail}"
    line3 = f"commute: {commute_summary(commute)}"
    if score and (score.get("total") is not None or score.get("rejected_by")):
        if score.get("total") is not None:
            parts = [f"{GROUP_SHORT.get(k, k)} {v['score']:.2f}".replace(" 0.", " .")
                     for k, v in (score.get("breakdown") or {}).items() if v.get("score") is not None]
            sc = f"score {float(score['total']):.2f} ({' '.join(parts)})"
        else:
            sc = f"REJECTED by {', '.join(score['rejected_by'])}"
    else:
        sc = "score: stale (run findhome scores recompute)"
    line4 = f"{sc}  status: {L['status']}  tags: {tags_summary(feedback)}"
    lines = [line1, line2, line3, line4]
    if full:
        if L.get("description_excerpt"):
            lines.append(f"text: {L['description_excerpt'][:280]}")
        for e in (evaluations or [])[:1]:
            lines.append(f"eval: {e['summary'][:300]}")
            if e["pros"]:
                lines.append("  + " + "; ".join(e["pros"][:5]))
            if e["cons"]:
                lines.append("  − " + "; ".join(e["cons"][:5]))
            if e["questions_for_landlord"]:
                lines.append("  ? " + "; ".join(e["questions_for_landlord"][:3]))
        if L.get("floorplan_urls"):
            lines.append("floorplan: " + " ".join(L["floorplan_urls"][:2]))
        if L.get("photo_urls"):
            lines.append(f"photos: {len(L['photo_urls'])} (first: {L['photo_urls'][0]})")
        for s in sources or []:
            lines.append(f"source: {s['site_slug']} {s['url'] or s['external_id']}")
    return "\n".join(lines)


async def listing_digest(conn, bundle, short_id: str, full: bool = False) -> str:
    L = await repo.get_listing(conn, short_id)
    commute = await repo.commute_for(conn, L["id"], bundle.config_hash)
    feedback = await repo.feedback_for(conn, L["id"])
    score = await (await conn.execute("SELECT total, rejected_by, breakdown FROM scores WHERE listing_id = %s "
                                      "AND config_hash = %s", (L["id"], bundle.config_hash))).fetchone()
    evals = await repo.evaluations_for(conn, L["id"]) if full else None
    sources = await repo.listing_sources(conn, L["id"]) if full else None
    return render(L, commute, feedback, score, evals, sources, full)
