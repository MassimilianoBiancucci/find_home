import { describe, expect, it } from 'vitest';
import { Listing } from '../models';
import { issuesOf } from '../issues';
import { contractLines, stayLength } from './contract-cell';

describe('contract cell', () => {
  it('says how long a fixed-term stay is', () => {
    expect(stayLength('2027-01-01', '2027-05-31')).toBe('5 months');
    expect(stayLength('2026-12-28', '2027-02-07')).toBe('6 weeks');
    expect(stayLength('2027-01-01', '2027-01-11')).toBe('10 days');
    expect(stayLength(null, '2027-01-11')).toBe('');
  });

  it('reads the extension wording as yes or no, and lists the other terms', () => {
    const l = { attributes: { contract_terms: { extension_raw: 'possibilityOfExtension: false', notice_months: 3 } } } as unknown as Listing;
    expect(contractLines(l).map((t) => [t.label, t.tone])).toEqual([['Cannot be extended', 'bad'], ['Notice 3 months', undefined]]);
    const yes = { attributes: { contract_terms: { extension_raw: 'possibilityOfExtension: true', max_total_months: 24 } } } as unknown as Listing;
    expect(contractLines(yes)[0].label).toBe('Can be extended, max 24 months');
  });

  it('names the end date in the fixed-term issue of a list row', () => {
    const l = { issue_codes: ['contract_fixed_term'], contract_end: '2027-05-31' } as unknown as Listing;
    expect(issuesOf(l)[0]).toMatchObject({ label: 'Fixed-term contract: ends 2027-05-31', cls: 'attention' });
  });
});
