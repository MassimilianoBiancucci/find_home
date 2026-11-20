import { describe, expect, it } from 'vitest';
import { Listing } from '../models';
import { ago, moments } from './stale-tip';

const NOW = Date.parse('2026-11-20T12:00:00Z');

describe('stale tip', () => {
  it('says how long ago, in the largest whole unit', () => {
    expect(ago('2026-11-08T12:00:00Z', NOW)).toBe('12 d');
    expect(ago('2026-11-20T07:00:00Z', NOW)).toBe('5 h');
    expect(ago('2026-11-20T11:48:00Z', NOW)).toBe('12 min');
    expect(ago('2026-11-20T12:00:00Z', NOW)).toBe('just now');
    expect(ago(null, NOW)).toBe('');
  });

  it('builds the history newest first: found on each site, ad status changes, your status changes', () => {
    const l = { short_id: 'L-T', ad_sources: [
      { site: 'qasa', status: 'open', first_seen: '2026-11-01T10:00:00Z' },
      { site: 'homeq', status: 'rented', first_seen: '2026-11-03T10:00:00Z' }] } as unknown as Listing;
    const m = moments(l,
      [{ at: '2026-11-10T09:00:00Z', from_status: 'open', to_status: 'rented', actor: 'job', site_slug: 'homeq' }],
      [{ at: '2026-11-12T09:00:00Z', from_status: 'new', to_status: 'on_hold', actor: 'user' },
       { at: '2026-11-01T10:00:00Z', from_status: null, to_status: 'new', actor: 'system' }],
      (s) => s.toUpperCase());
    expect(m.map((x) => [x.what, x.tone])).toEqual([
      ['new → on hold', 'status'], ['HOMEQ: Open → Let', 'closed'], ['Found on HOMEQ', 'found'], ['Found on QASA', 'found']]);
    expect(m[1].who).toBe('status check');
  });
});
