import { describe, expect, it } from 'vitest';
import { scoreRows } from '../../components/score-tip';
import { RAMPS, breaks, classOf, ranks, sampleRamp } from './zone-fill.service';

describe('zone fill classes', () => {
  const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  it('quantile breaks split into equal counts', () => { expect(breaks(v, 'quantile', 5)).toEqual([2, 4, 6, 8, 10]); });
  it('equal intervals split the range', () => { expect(breaks([0, 10], 'equal', 4)).toEqual([2.5, 5, 7.5, 10]); });
  it('percentile classes are fixed', () => { expect(breaks(v, 'percentile', 4)).toEqual([25, 50, 75, 100]); });
  it('no values, no classes', () => { expect(breaks([], 'quantile', 5)).toEqual([]); });
  it('a value falls in the first class whose upper bound it does not exceed', () => {
    expect(classOf(2, [2, 4, 6])).toBe(0);
    expect(classOf(2.1, [2, 4, 6])).toBe(1);
    expect(classOf(99, [2, 4, 6])).toBe(2);
  });
  it('ranks: ties count half, null stays null', () => {
    expect(ranks({ a: 10, b: 20, c: 20, d: null })).toEqual({ a: 100 / 6, b: 100 * 2 / 3, c: 100 * 2 / 3, d: null });
  });
  it('samples a ramp evenly and can reverse it', () => {
    const s = sampleRamp('viridis', 3);
    expect(s).toEqual([RAMPS.viridis[0], RAMPS.viridis[4], RAMPS.viridis[7]]);
    expect(sampleRamp('viridis', 3, true)).toEqual([...s].reverse());
  });
});

describe('score tooltip rows', () => {
  it('shares are weight × score over the weights with data', () => {
    const rows = scoreRows({ cost: { score: 1, weight: 3, why: '' }, space: { score: 0.5, weight: 1, why: '' }, area: { score: null, weight: 2, why: 'no area' } });
    expect(rows.map((r) => r.share)).toEqual([0.75, 0.125, null]);
  });
});
