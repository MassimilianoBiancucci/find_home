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

describe('pet conflict and source marks', () => {
  it('gives conflict its own striped style and marks who set the status', async () => {
    const { petClass, petSourceMark, petSourceLabel } = await import('./format');
    expect(petClass('conflict')).toBe('fh-pet-conflict');
    expect(petSourceMark('user')).toBe('U');
    expect(petSourceMark('agent')).toBe('A');
    expect(petSourceMark('site')).toBe('S');
    expect(petSourceMark('keywords')).toBe('K');
    expect(petSourceMark(null)).toBe('');
    expect(petSourceLabel('user')).toBe('your answer');
  });
});
