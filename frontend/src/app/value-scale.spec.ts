import { describe, expect, it } from 'vitest';
import { ScaleField, rateValue, valueOf } from './value-scale';

const rent: ScaleField = { better: 'low', limit: 13000, ideal: 9750, limit_key: null, ideal_key: null,
  values: [8000, 9000, 10000, 11000, 12000, 12500] };
const size: ScaleField = { better: 'high', limit: 35, ideal: 55, limit_key: null, ideal_key: null, values: [35, 40, 45, 50, 60, 75] };

describe('value colours', () => {
  it('rates by percentile among the listings in the running and by your targets', () => {
    expect(rateValue(8500, 'rent_sek', rent)!.colour).toBe('var(--fh-good)');      // cheap and under the ideal
    expect(rateValue(12800, 'rent_sek', rent)!.colour).toBe('var(--fh-bad)');      // dearest, near the max
    expect(rateValue(14000, 'rent_sek', rent)!.score).toBe(0);                     // past your max
    expect(rateValue(14000, 'rent_sek', rent)!.title).toContain('past your limit');
    expect(rateValue(60, 'size_m2', size)!.colour).toBe('var(--fh-good)');
    expect(rateValue(30, 'size_m2', size)!.score).toBe(0);                         // below your minimum
    expect(rateValue(null, 'size_m2', size)).toBeNull();
    expect(rateValue(5, 'size_m2', { ...size, values: [] })).toBeNull();
  });

  it('uses the percentile alone when there is no target, and derives rent per m²', () => {
    const perM2: ScaleField = { better: 'low', limit: null, ideal: null, limit_key: null, ideal_key: null, values: [150, 200, 250, 300] };
    expect(rateValue(150, 'rent_per_m2', perM2)!.score).toBeCloseTo(0.875);
    expect(valueOf({ rent_sek: 10000, size_m2: 50, rooms_rok: 2 }, 'rent_per_m2')).toBe(200);
    expect(valueOf({ rent_sek: 10000, size_m2: null, rooms_rok: 2 }, 'rent_per_m2')).toBeNull();
  });
});
