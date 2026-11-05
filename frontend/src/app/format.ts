/** Small display helpers shared by the pages. */
export const fmtKr = (v?: number | null) => (v == null ? '?' : `${Math.round(v).toLocaleString('sv-SE')} kr`);
export const fmtNum = (v?: number | null, unit = '') => (v == null ? '?' : `${+Number(v).toFixed(1)}${unit}`);
export const fmtScore = (v?: number | null) => (v == null ? '–' : Number(v).toFixed(2));
export const petClass = (p: string) =>
  ({ yes: 'text-bg-success', ask: 'text-bg-warning', unknown: 'text-bg-secondary', no: 'text-bg-danger' } as Record<string, string>)[p] ?? 'text-bg-secondary';
export const scoreColor = (v?: number | null) =>
  v == null ? 'var(--fh-muted)' : v >= 0.75 ? 'var(--fh-good)' : v >= 0.5 ? 'var(--fh-mid)' : 'var(--fh-bad)';

/** Walking minutes → tone: green up to `green`, yellow up to `yellow`, red above (zone.yaml walk_colours). */
export const walkTone = (min: number | null | undefined, c: { green: number; yellow: number } = { green: 5, yellow: 10 }) =>
  min == null ? 'bad' : min <= c.green ? 'good' : min <= c.yellow ? 'neutral' : 'bad';
/** CSS colour of a tone. */
export const toneColor = (t: string) => ({ good: 'var(--fh-good)', neutral: 'var(--fh-mid)', bad: 'var(--fh-bad)' } as Record<string, string>)[t] ?? 'var(--fh-muted)';
