"""History digest: the first thing an agent run reads. ~1.5k tokens at a few hundred listings.

Sections: profile snapshot · liked/disliked traits · pipeline · rejected · seen index ·
open pet questions. Lists collapse to counts when they grow past their limits.
"""
from __future__ import annotations

from collections import Counter
from datetime import UTC, datetime


def _fmt(v) -> str:
    if isinstance(v, list):
        return "/".join(map(str, v))
    if isinstance(v, dict):
        return "{" + ", ".join(f"{k}:{x}" for k, x in v.items()) + "}"
    return str(v)


def _hf_line(hf: dict) -> str:
    """Only the limits that are set; unset TODO(user) values are listed separately."""
    return ", ".join(f"{k}={_fmt(v)}" for k, v in hf.items() if v not in (None, [], {}, ""))


async def history_digest(conn, bundle, since: str | None = None, list_limit: int = 15) -> str:
    q = lambda sql, p=(): conn.execute(sql, p)  # noqa: E731
    out: list[str] = [f"# find_home history digest · {datetime.now(UTC):%Y-%m-%d %H:%M} UTC · config {bundle.config_hash}"]

    out.append("\n## Profile")
    for kind, prof in bundle.profile.kinds.items():
        if not prof.enabled:
            continue
        out.append(f"- {kind} hard: {_hf_line(prof.hard_filters) or 'none set'}")
        unset = [k for k, v in prof.hard_filters.items() if v is None]
        if unset:
            out.append(f"- {kind} not set yet: {', '.join(unset)}")
        top = sorted(((g, p.weight) for g, p in prof.preferences.items() if p.enabled), key=lambda x: -x[1])
        out.append(f"- {kind} weights: " + ", ".join(f"{g} {w:g}" for g, w in top))
    pts = ", ".join(f"{p.id}({p.category})" for p in bundle.locations.points if p.enabled)
    out.append(f"- points: {pts}")

    fb = await (await q("SELECT polarity, tags FROM feedback")).fetchall()
    liked, disliked = Counter(), Counter()
    for row in fb:
        (liked if row["polarity"] == "like" else disliked if row["polarity"] == "dislike" else Counter()).update(row["tags"])
    out.append("\n## Traits from your feedback")
    out.append("- liked: " + (", ".join(f"{t}×{n}" for t, n in liked.most_common(8)) or "none yet"))
    out.append("- disliked: " + (", ".join(f"{t}×{n}" for t, n in disliked.most_common(8)) or "none yet"))

    counts = await (await q("SELECT status, count(*) AS n FROM listings GROUP BY status ORDER BY status")).fetchall()
    total = sum(r["n"] for r in counts)
    out.append(f"\n## Pipeline ({total} listings)")
    out.append("- " + (", ".join(f"{r['status']} {r['n']}" for r in counts) or "empty"))
    active = await (await q(
        """SELECT l.short_id, l.status, l.area, s.total FROM listings l
           LEFT JOIN scores s ON s.listing_id = l.id AND s.config_hash = %s
           WHERE l.status IN ('shortlisted','contacted','viewing','applied','bidding')
           ORDER BY s.total DESC NULLS LAST LIMIT %s""", (bundle.config_hash, list_limit))).fetchall()
    for r in active:
        sc = f" {float(r['total']):.2f}" if r["total"] is not None else ""
        out.append(f"  - {r['short_id']} {r['status']}{sc} {r['area'] or ''}".rstrip())

    rejected = await (await q(
        """SELECT l.short_id, coalesce(array_agg(DISTINCT t) FILTER (WHERE t IS NOT NULL), '{}') AS tags
           FROM listings l LEFT JOIN feedback f ON f.listing_id = l.id LEFT JOIN LATERAL unnest(f.tags) t ON true
           WHERE l.status = 'rejected' GROUP BY l.short_id, l.last_changed_at
           ORDER BY l.last_changed_at DESC LIMIT %s""", (list_limit,))).fetchall()
    n_rej = next((r["n"] for r in counts if r["status"] == "rejected"), 0)
    out.append(f"\n## Rejected (last {len(rejected)} of {n_rej})")
    out += [f"- {r['short_id']} {' '.join(r['tags']) or '(no tags)'}" for r in rejected] or ["- none"]

    seen = await (await q(
        """SELECT site_slug, count(*) AS n, max(last_seen_at) AS last FROM listing_sources GROUP BY site_slug
           ORDER BY site_slug""")).fetchall()
    out.append("\n## Seen per site (skip known items: `findhome listings exists <site> <id|url>`)")
    out += [f"- {r['site_slug']}: {r['n']} seen, last {r['last']:%Y-%m-%d %H:%M}" for r in seen] or ["- nothing scanned yet"]

    if since:
        changed = await (await q("SELECT short_id FROM listings WHERE last_changed_at > %s ORDER BY last_changed_at "
                                 "DESC LIMIT 50", (since,))).fetchall()
        out.append(f"\n## New or changed since {since}: {len(changed)}")
        if changed:
            out.append("- " + " ".join(r["short_id"] for r in changed))

    pets = await (await q("SELECT short_id FROM listings WHERE pet_status IN ('ask','unknown') AND status NOT IN "
                          "('rejected','archived') ORDER BY last_changed_at DESC LIMIT %s", (list_limit,))).fetchall()
    out.append("\n## Pet policy to clarify (draft with prompts/pet_inquiry.md)")
    out.append("- " + (" ".join(r["short_id"] for r in pets) or "none"))
    need_eval = await (await q("""SELECT count(*) AS n FROM listings l WHERE l.status = 'new' AND NOT EXISTS
                                  (SELECT 1 FROM evaluations e WHERE e.listing_id = l.id)""")).fetchone()
    out.append(f"\n## To evaluate: {need_eval['n']} new listings without an evaluation")
    return "\n".join(out) + "\n"
