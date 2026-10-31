/** Small display helpers shared by the pages. */
export const fmtKr = (v?: number | null) => (v == null ? '?' : `${Math.round(v).toLocaleString('sv-SE')} kr`);
export const fmtNum = (v?: number | null, unit = '') => (v == null ? '?' : `${+Number(v).toFixed(1)}${unit}`);
export const fmtScore = (v?: number | null) => (v == null ? '–' : Number(v).toFixed(2));
export const petClass = (p: string) =>
  ({ yes: 'text-bg-success', ask: 'text-bg-warning', unknown: 'text-bg-secondary', no: 'text-bg-danger' } as Record<string, string>)[p] ?? 'text-bg-secondary';
export const scoreColor = (v?: number | null) =>
  v == null ? 'var(--fh-muted)' : v >= 0.75 ? 'var(--fh-good)' : v >= 0.5 ? 'var(--fh-mid)' : 'var(--fh-bad)';
