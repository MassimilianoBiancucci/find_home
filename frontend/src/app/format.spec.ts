import { describe, expect, it } from 'vitest';
import { fmtKr, fmtNum, fmtScore, petClass } from './format';

describe('format helpers', () => {
  it('formats money, numbers and scores', () => {
    expect(fmtKr(14500).replace(/\s/g, ' ')).toBe('14 500 kr');
    expect(fmtKr(null)).toBe('?');
    expect(fmtNum(54.0, ' m²')).toBe('54 m²');
    expect(fmtScore(0.7123)).toBe('0.71');
    expect(fmtScore(null)).toBe('–');
  });
  it('maps pet status to badge classes', () => {
    expect(petClass('no')).toContain('danger');
    expect(petClass('yes')).toContain('success');
  });
});
