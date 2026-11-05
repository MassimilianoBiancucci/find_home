import { describe, expect, it } from 'vitest';
import { HouseLocation } from '../models';
import { SET_COLOURS } from '../set-colours';
import { houseMapFeatures } from './house-map';

describe('house map features', () => {
  it('draws every nearby target, the nearest larger, and one walk with its minutes per set', () => {
    const loc = {
      sets: ['grocery', 'vet'], set_labels: { grocery: 'Groceries', vet: 'Vets' }, walk_colours: { green: 5, yellow: 10 },
      walks: {
        grocery: { minutes: 3, metres: 230, target: 'Shop A', path: [[18, 59], [18.002, 59.001]],
          nearby: [[18.002, 59.001, 'Shop A', 3], [18.004, 59.002, 'Shop B', 6]] },
        vet: { minutes: null, metres: null, target: null, path: [], nearby: [] },
      },
    } as unknown as HouseLocation;
    const f = houseMapFeatures(loc);
    expect(f.pois.features.map((x: any) => [x.properties.name, x.properties.nearest])).toEqual([['Shop A', true], ['Shop B', false]]);
    expect(f.pois.features[0].properties.colour).toBe(SET_COLOURS['grocery']);
    expect(f.walks.features.length).toBe(1);                           // the vet: nothing within reach
    expect(f.labels.features[0].properties).toEqual({ text: '3 min', tone: 'good' });
  });
});
