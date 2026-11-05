// Pure display helpers for runs, jobs and sites: status → tone, counts, durations, the timeline view model.
import type { AgentRun, JobRun, ScanCounts, ScanRun } from './models';

/** Colour family of a chip; each maps to a `.fh-tone-*` class in styles.scss built on the --fh-* tokens. */
export type Tone = 'good' | 'bad' | 'mid' | 'run' | 'wait' | 'muted' | 'off' | 'violet' | 'cyan' | 'info';

const TONES: Record<string, Tone> = {
  // runs (agent, scan, job)
  ok: 'good', running: 'run', waiting: 'wait', error: 'bad', timeout: 'bad', partial: 'mid', cancelled: 'muted',
  expired: 'off', ended_no_handover: 'off',
  // sites
  active: 'good', unverified: 'mid', broken: 'bad', disabled: 'muted', scanned: 'violet', origin: 'cyan',
  // job item outcomes
  changed: 'info', unchanged: 'muted', conflict: 'mid', skipped: 'muted', queued: 'muted', leased: 'run', done: 'good', undone: 'off',
  // job kinds
  inapp: 'cyan', agent: 'violet',
};
export const statusTone = (status?: string | null): Tone => TONES[status ?? ''] ?? 'muted';
/** Running and waiting runs pulse. */
export const isLive = (status?: string | null) => status === 'running' || status === 'waiting';

const LABELS: Record<string, string> = {
  ended_no_handover: 'ended · no handover', waiting: 'waiting', inapp: 'in-app', agent_browser: 'browser', ok: 'ok',
};
export const statusLabel = (status?: string | null) => (status ? LABELS[status] ?? status.replace(/_/g, ' ') : '–');

const n = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : 0);

/** Scan counts in one line: "+12 new · 3 changed · 40 seen" (only the parts that say something). */
export function countsText(c?: ScanCounts | Record<string, unknown> | null): string {
  if (!c) return '';
  const parts: string[] = [];
  if (n(c['new'])) parts.push(`+${n(c['new'])} new`);
  if (n(c['changed'])) parts.push(`${n(c['changed'])} changed`);
  if (c['seen'] != null) parts.push(`${n(c['seen'])} seen`);
  if (n(c['dup_cross_site'])) parts.push(`${n(c['dup_cross_site'])} dup`);
  if (n(c['filtered'])) parts.push(`${n(c['filtered'])} filtered`);
  return parts.join(' · ');
}

/** Job counts by outcome: "4 changed · 1 conflict · 5 unchanged · 2 queued of 12". */
export function jobCountsText(c?: Record<string, unknown> | null): string {
  if (!c) return '';
  const order = ['changed', 'conflict', 'unchanged', 'error', 'skipped', 'undone', 'leased', 'queued'];
  const parts = order.filter((k) => n(c[k])).map((k) => `${n(c[k])} ${k}`);
  const total = n(c['total']);
  if (!parts.length) return total ? `${total} listings` : '';
  return parts.join(' · ') + (total ? ` of ${total}` : '');
}

/** Sum of the children's scan counts (an agent run's own result). */
export function sumCounts(runs: ScanRun[] = []): ScanCounts | null {
  if (!runs.length) return null;
  const out: ScanCounts = { seen: 0, new: 0, changed: 0, dup_cross_site: 0 };
  for (const r of runs) for (const k of ['seen', 'new', 'changed', 'dup_cross_site'] as const) out[k] = n(out[k]) + n(r.counts?.[k]);
  return out;
}

/** 71 → "1m 11s", 0.2 → "<1s", 3720 → "1h 2m". */
export function fmtDuration(s?: number | null): string {
  if (s == null) return '';
  if (s < 1) return '<1s';
  const sec = Math.round(s), h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), r = sec % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m${r ? ` ${r}s` : ''}`;
  return `${r}s`;
}

/** "just now", "5 min ago", "3 h ago", "2 d ago", else the date. */
export function fmtAgo(iso?: string | null, now = Date.now()): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const d = Math.max(0, (now - t) / 1000);
  if (d < 45) return 'just now';
  if (d < 3600) return `${Math.round(d / 60)} min ago`;
  if (d < 86400) return `${Math.round(d / 3600)} h ago`;
  if (d < 86400 * 14) return `${Math.round(d / 86400)} d ago`;
  return new Date(iso).toLocaleDateString('sv-SE');
}

export const fmtCost = (usd?: number | null) => (usd == null ? '' : usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`);

/** Icon family of a run: a scripted scan, a browser agent, a job, an onboarding, an evaluation or anything else. */
export type RunIcon = 'script' | 'browser' | 'job' | 'onboarding' | 'evaluate' | 'other';
export const ICON_PATHS: Record<RunIcon, string> = {
  script: 'M4 7l4 4-4 4M11 17h9',
  browser: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c3.2 3.4 3.2 14.6 0 18M12 3c-3.2 3.4-3.2 14.6 0 18',
  job: 'M10 6h10M10 12h10M10 18h10M3.5 6l1.5 1.5L7.5 5M3.5 12l1.5 1.5 2.5-2.5M3.5 18l1.5 1.5 2.5-2.5',
  onboarding: 'M12 4v16M4 12h16M6.5 6.5l11 11M17.5 6.5l-11 11',
  evaluate: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8L3.5 9.7l5.9-.8z',
  other: 'M5 12h.01M12 12h.01M19 12h.01',
};

/** One row of the Runs timeline (agent run, scan run or job run), already formatted. */
export interface TimelineItem {
  type: 'agent' | 'scan' | 'job';
  id: string;
  icon: RunIcon;
  title: string;
  sub: string;
  site: string | null;
  status: string;
  launcher: string | null;
  started_at: string;
  duration: string;
  counts: string;
  cost: string;
  turns: number | null;
  children: TimelineItem[];
  agent?: AgentRun;
  scan?: ScanRun;
  job?: JobRun;
}

export interface Lookups { profileLabel?: (name: string) => string; siteName?: (slug: string) => string; }

export function scanItem(s: ScanRun, l: Lookups = {}): TimelineItem {
  const browser = s.method === 'agent_browser';
  const site = l.siteName?.(s.site_slug) ?? s.site_slug;
  const sub = [s.method === 'agent_browser' ? 'browser' : s.method, s.trigger && `by ${s.trigger}`, s.pages ? `${s.pages} page${s.pages === 1 ? '' : 's'}` : '',
    s.dry_run ? 'dry run' : ''].filter(Boolean).join(' · ');
  return {
    type: 'scan', id: s.id, icon: browser ? 'browser' : 'script', title: `${browser ? 'Browser scan' : 'Scan'} · ${site}`, sub,
    site: s.site_slug, status: s.status, launcher: null, started_at: s.started_at, duration: fmtDuration(s.duration_s),
    counts: s.status === 'error' && !n(s.counts?.seen) ? '' : countsText(s.counts), cost: '', turns: null, children: [], scan: s,
  };
}

export function jobItem(j: JobRun): TimelineItem {
  return {
    type: 'job', id: j.id, icon: 'job', title: `Job · ${j.job_key.replace(/_/g, ' ')}`, sub: j.launcher ? `via ${j.launcher}` : 'in-app',
    site: null, status: j.status, launcher: j.launcher ?? null, started_at: j.started_at, duration: fmtDuration(j.duration_s),
    counts: jobCountsText(j.counts), cost: fmtCost(j.cost_usd), turns: j.num_turns ?? null, children: [], job: j,
  };
}

export function agentItem(a: AgentRun, l: Lookups = {}): TimelineItem {
  const kind = a.kind ?? 'other';
  const icon: RunIcon = kind === 'scan' ? 'browser' : kind === 'job' ? 'job' : kind === 'onboarding' ? 'onboarding'
    : kind === 'evaluate' ? 'evaluate' : 'other';
  const label = l.profileLabel?.(a.profile) ?? a.profile;
  const site = a.site_slug ? l.siteName?.(a.site_slug) ?? a.site_slug : '';
  const pages = (a.params as Record<string, unknown> | null)?.['pages'];
  const sub = [kind, a.launcher && a.launcher !== 'cli' ? a.launcher : a.launcher ? 'CLI' : '', pages ? `${pages} pages` : '']
    .filter(Boolean).join(' · ');
  const children = [...(a.scan_runs ?? []).map((s) => scanItem(s, l)), ...(a.job_runs ?? []).map(jobItem)];
  return {
    type: 'agent', id: a.id, icon, title: site ? `${label} · ${site}` : label, sub, site: a.site_slug ?? null, status: a.status,
    launcher: a.launcher ?? null, started_at: a.started_at, duration: fmtDuration(a.duration_s),
    counts: countsText(sumCounts(a.scan_runs)), cost: fmtCost(a.cost_usd ?? a.result?.total_cost_usd),
    turns: a.num_turns ?? a.result?.num_turns ?? null, children, agent: a,
  };
}

/** Agent runs and standalone scan runs merged newest first. */
export function timeline(agentRuns: AgentRun[], scanRuns: ScanRun[], l: Lookups = {}): TimelineItem[] {
  return [...agentRuns.map((a) => agentItem(a, l)), ...scanRuns.map((s) => scanItem(s, l))]
    .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
}

/** vscode:// link that reopens a Claude Code session in VS Code. */
export const resumeUrl = (sessionId: string) => `vscode://anthropic.claude-code/open?session=${encodeURIComponent(sessionId)}`;

/** What a finished agent run achieved, in one line: the agent's own verdict first, then what the app saw. */
export function runVerdict(a: AgentRun): { tone: 'good' | 'mid' | 'bad' | 'off'; title: string; text: string } | null {
  const denials = a.result?.permission_denials?.length ?? 0;
  const denied = denials ? ` ${denials} tool call${denials > 1 ? 's were' : ' was'} refused (see below).` : '';
  if (a.status === 'running' || a.status === 'waiting') return null;
  if (a.outcome === 'failed' || (a.status === 'error' && a.outcome !== 'partial'))
    return { tone: 'bad', title: 'Failed.', text: (a.outcome === 'failed' ? 'The agent reported it could not do the task.' : 'The agent process failed.') + denied };
  if (a.outcome === 'partial' || a.status === 'partial')
    return { tone: 'mid', title: 'Partly done.', text: 'The agent stopped before finishing.' + denied };
  if (a.status === 'ended_no_handover')
    return { tone: 'off', title: 'Ended without a verdict.', text: 'The agent exited without closing its run: check the handover and the log.' + denied };
  if (a.status === 'timeout' || a.status === 'cancelled' || a.status === 'expired')
    return { tone: 'off', title: `${a.status[0].toUpperCase()}${a.status.slice(1)}.`, text: denied.trim() };
  if (a.status === 'ok')
    return { tone: denials ? 'mid' : 'good', title: 'Done.', text: (a.outcome === 'ok' ? 'The agent reported the task done.' : 'Finished.') + denied };
  return null;
}
