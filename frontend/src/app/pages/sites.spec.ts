import { describe, expect, it } from 'vitest';
import { monogram } from '../components/site-logo';
import { Site } from '../models';
import { liveBySite, siteGroup } from './sites';

const site = (p: Partial<Site>): Site => ({ slug: 'x', name: 'X', url: '', kinds: ['rent'], status: 'active', role: 'scanned', ...p });
const scan = (script: boolean, browser: boolean) => ({ script: { enabled: script, reason: null },
  browser: { enabled: browser, reason: null, default_pages: 1, max_pages: 5 } });

describe('Sites page grouping', () => {
  it('puts scannable sites first, unonboarded next, origin-only and disabled in the collapsed group', () => {
    expect(siteGroup(site({ scan: scan(true, false) }))).toBe('ready');
    expect(siteGroup(site({ scan: scan(false, true) }))).toBe('ready');
    expect(siteGroup(site({ status: 'unverified', scan: scan(false, false) }))).toBe('pending');
    expect(siteGroup(site({ role: 'origin', status: 'disabled', scan: scan(false, false) }))).toBe('other');
  });
  it('finds the run in progress for each site', () => {
    const live = liveBySite({
      agent_runs: [{ id: 'a', status: 'waiting', site_slug: 'qasa', scan_runs: [] } as any, { id: 'b', status: 'ok', site_slug: 'samtrygg' } as any],
      scan_runs: [{ id: 's', status: 'running', site_slug: 'bostadsformedlingen' } as any],
    });
    expect(live.get('qasa')).toMatchObject({ type: 'agent', status: 'waiting', label: 'waiting in VS Code' });
    expect(live.get('bostadsformedlingen')).toMatchObject({ type: 'scan', id: 's' });
    expect(live.has('samtrygg')).toBe(false);
  });
  it('makes monograms from site names', () => {
    expect(monogram('HomeQ')).toBe('HQ');
    expect(monogram('Blocket Bostad')).toBe('BB');
    expect(monogram('qasa')).toBe('QA');
    expect(monogram('Bostadsförmedlingen Stockholm')).toBe('BS');
  });
});
