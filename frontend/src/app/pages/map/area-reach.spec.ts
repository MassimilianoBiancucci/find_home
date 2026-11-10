import { ConnectivityMinutes } from '../../models';
import { reachLabel, reachMinutes, reachSplit } from './area-reach';

const data: ConnectivityMinutes = {
  window: null, points: [], periods: [],
  zones: {
    A: { by_point: { work: 20, gym: 50 }, weighted: 30, estimate: false },
    B: { by_point: { work: 45 }, weighted: 45, estimate: true },
    C: { by_point: { gym: 10 }, weighted: 10, estimate: false },
  },
  zones_real: {
    A: { by_point: { work: 20, gym: 50 }, weighted: 30, estimate: false },
    C: { by_point: { gym: 10 }, weighted: 10, estimate: false },
  },
};

describe('area reach', () => {
  it('splits zones by the weighted mix', () => {
    expect(reachSplit(['A', 'B', 'C', 'D'], data, { from: 'weighted', max_min: 40 }))
      .toEqual({ inside: ['A', 'C'], outside: ['B'], noData: ['D'] });
  });

  it('uses one point, and a zone without that point has no data', () => {
    expect(reachSplit(['A', 'B', 'C'], data, { from: 'work', max_min: 45 })).toEqual({ inside: ['A', 'B'], outside: [], noData: ['C'] });
  });

  it('drops estimates when asked', () => {
    expect(reachMinutes(data, { from: 'weighted', max_min: 60, exclude_estimates: true }, 'B')).toBeNull();
    expect(reachMinutes(data, { from: 'weighted', max_min: 60 }, 'B')).toBe(45);
  });

  it('labels the rule', () => {
    expect(reachLabel({ from: 'work', max_min: 35, window: 'weekday|arrive_by 08:00-09:00' }, [{ id: 'work', label: 'Work' }]))
      .toBe('≤ 35 min · Work · arrive_by 08:00-09:00 · weekday');
    expect(reachLabel({ from: 'weighted', max_min: 40 }, [])).toBe('≤ 40 min · all points · every period');
  });
});
