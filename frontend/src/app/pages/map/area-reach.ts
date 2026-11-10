import { AreaReach, ConnectivityMinutes } from '../../models';

/** The default rule of a new reach piece: the weighted mix of your points, every travel period, 40 minutes. */
export const DEFAULT_REACH: AreaReach = { from: 'weighted', max_min: 40 };

/** How a reach rule splits the zones: within the minutes, farther, or with no minutes in the matrix. */
export interface ReachSplit { inside: string[]; outside: string[]; noData: string[]; }

/** The minutes of one zone under a rule: one point's or the weighted mix, with or without estimates. */
export function reachMinutes(data: ConnectivityMinutes, r: AreaReach, zoneId: string): number | null {
  const z = (r.exclude_estimates ? data.zones_real : data.zones)[zoneId];
  if (!z) return null;
  return (r.from === 'weighted' ? z.weighted : z.by_point[r.from]) ?? null;
}

/** Split the zones by a reach rule. The minutes must be the ones of the rule's travel period. */
export function reachSplit(zoneIds: string[], data: ConnectivityMinutes, r: AreaReach): ReachSplit {
  const out: ReachSplit = { inside: [], outside: [], noData: [] };
  for (const id of zoneIds) {
    const m = reachMinutes(data, r, id);
    (m == null ? out.noData : m <= r.max_min ? out.inside : out.outside).push(id);
  }
  return out;
}

/** A short label for a reach piece: "≤ 40 min · Work arrive · arrive_by 08:00-09:00". */
export function reachLabel(r: AreaReach, points: { id: string; label: string }[]): string {
  const from = r.from === 'weighted' ? 'all points' : points.find((p) => p.id === r.from)?.label ?? r.from;
  const period = r.window ? r.window.split('|').reverse().join(' · ') : 'every period';
  return `≤ ${r.max_min} min · ${from} · ${period}`;
}
