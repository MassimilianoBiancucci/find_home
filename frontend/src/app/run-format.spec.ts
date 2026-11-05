import { describe, expect, it } from 'vitest';
import { AgentRun, ScanRun } from './models';
import { countsText, fmtAgo, fmtDuration, isLive, jobCountsText, statusLabel, statusTone, timeline } from './run-format';

const scan = (id: string, at: string, extra: Partial<ScanRun> = {}): ScanRun => ({
  id, site_slug: 'qasa', method: 'agent_browser', trigger: 'agent', started_at: at, status: 'ok', counts: { seen: 40, new: 12, changed: 3 }, ...extra,
});

describe('run status chips', () => {
  it('maps run, site and outcome statuses to token tones', () => {
    expect(statusTone('ok')).toBe('good');
    expect(statusTone('error')).toBe('bad');
    expect(statusTone('timeout')).toBe('bad');
    expect(statusTone('running')).toBe('run');
    expect(statusTone('waiting')).toBe('wait');
    expect(statusTone('partial')).toBe('mid');
    expect(statusTone('expired')).toBe('off');
    expect(statusTone('ended_no_handover')).toBe('off');
    expect(statusTone('unverified')).toBe('mid');
    expect(statusTone('conflict')).toBe('mid');
    expect(statusTone('something new')).toBe('muted');
    expect(statusTone(null)).toBe('muted');
  });
  it('pulses only running and waiting, and labels underscores', () => {
    expect(isLive('running')).toBe(true);
    expect(isLive('waiting')).toBe(true);
    expect(isLive('ok')).toBe(false);
    expect(statusLabel('ended_no_handover')).toBe('ended · no handover');
    expect(statusLabel('agent_browser')).toBe('browser');
  });
});

describe('counts and durations', () => {
  it('writes scan counts as "+12 new · 3 changed · 40 seen", skipping zeros', () => {
    expect(countsText({ seen: 40, new: 12, changed: 3, unchanged: 25 })).toBe('+12 new · 3 changed · 40 seen');
    expect(countsText({ seen: 5, new: 0, changed: 0 })).toBe('5 seen');
    expect(countsText({ seen: 9, dup_cross_site: 2 })).toBe('9 seen · 2 dup');
    expect(countsText(null)).toBe('');
  });
  it('writes job counts by outcome with the total', () => {
    expect(jobCountsText({ changed: 4, conflict: 1, unchanged: 5, total: 10 })).toBe('4 changed · 1 conflict · 5 unchanged of 10');
    expect(jobCountsText({ queued: 3 })).toBe('3 queued');
    expect(jobCountsText({ total: 0 })).toBe('');
  });
  it('formats durations and relative times', () => {
    expect(fmtDuration(71)).toBe('1m 11s');
    expect(fmtDuration(120)).toBe('2m');
    expect(fmtDuration(0)).toBe('<1s');
    expect(fmtDuration(3720)).toBe('1h 2m');
    expect(fmtDuration(null)).toBe('');
    const now = Date.parse('2026-11-05T12:00:00Z');
    expect(fmtAgo('2026-11-05T11:55:00Z', now)).toBe('5 min ago');
    expect(fmtAgo('2026-11-05T09:00:00Z', now)).toBe('3 h ago');
  });
});

describe('timeline', () => {
  it('nests an agent run\'s scan runs, sums their counts and sorts newest first', () => {
    const agent = {
      id: 'a1', profile: 'browser_scan', command: 'claude', run_dir: 'runs/x', started_by: 'app', started_at: '2026-11-04T10:00:00+00:00',
      status: 'ok', launcher: 'vscode', kind: 'scan', site_slug: 'qasa', cost_usd: 0.4321, num_turns: 12, duration_s: 300,
      scan_runs: [scan('s1', '2026-11-04T10:01:00+00:00'), scan('s2', '2026-11-04T10:02:00+00:00', { counts: { seen: 10, new: 1 } })], job_runs: [],
    } as AgentRun;
    const items = timeline([agent], [scan('s3', '2026-11-05T08:00:00+00:00', { method: 'api', trigger: 'app' })],
      { siteName: (s) => (s === 'qasa' ? 'Qasa' : s), profileLabel: () => 'Browser scan' });
    expect(items.map((i) => i.id)).toEqual(['s3', 'a1']);
    expect(items[0].icon).toBe('script');
    expect(items[0].title).toBe('Scan · Qasa');
    const a = items[1];
    expect(a.title).toBe('Browser scan · Qasa');
    expect(a.children.map((c) => c.id)).toEqual(['s1', 's2']);
    expect(a.counts).toBe('+13 new · 3 changed · 50 seen');
    expect(a.cost).toBe('$0.43');
    expect(a.turns).toBe(12);
    expect(a.duration).toBe('5m');
  });
});
