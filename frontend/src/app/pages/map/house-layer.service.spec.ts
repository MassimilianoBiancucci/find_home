import { describe, expect, it } from 'vitest';
import { HouseLocation, TransitResult } from '../../models';
import { SET_COLOURS } from '../../set-colours';
import { HOUSE_LAYERS, layersToRaise, transitFeatures, walkFeatures } from './house-layer.service';

const walk = (minutes: number | null, path: [number, number][]) => ({ set: '', minutes, metres: 100, target: 'T', target_lonlat: null, path, count_within: 1 });
const loc = {
  sets: ['grocery', 'vet', 'park'], set_labels: { grocery: 'Groceries', vet: 'Vets', park: 'Parks' }, walk_colours: { green: 5, yellow: 10 },
  walks: { grocery: walk(3, [[18, 59], [18.001, 59.001]]), vet: walk(null, []), park: walk(12, [[18, 59], [18, 59.002]]) },
} as unknown as HouseLocation;

describe('house layers', () => {
  it('draws one walk per set with a path, in the set colour, labelled and toned by minutes', () => {
    const { lines, labels } = walkFeatures(loc);
    expect(lines.features.map((f: any) => f.properties.set)).toEqual(['grocery', 'park']);   // the vet has no path
    expect((lines.features[0] as any).properties.colour).toBe(SET_COLOURS['grocery']);
    expect(labels.features.map((f: any) => [f.properties.text, f.properties.tone])).toEqual([['3 min', 'good'], ['12 min', 'bad']]);
    expect((labels.features[1].geometry as any).coordinates).toEqual([18, 59.002]);             // at the target end
  });

  it('draws transit legs, walking legs marked, optionally for one point only', () => {
    const t = { trips: [
      { point_id: 'a', label: 'A', legs: [
        { mode: 'walk', from: { lat: 59, lon: 18 }, to: { lat: 59.01, lon: 18 }, path: [] },
        { mode: 'metro', line: '17', color: '#2e8b57', from: { lat: 59.01, lon: 18 }, to: { lat: 59.1, lon: 18.1 }, path: [[18, 59.01], [18.05, 59.05], [18.1, 59.1]] }] },
      { point_id: 'b', label: 'B', legs: [{ mode: 'bus', from: { lat: 59, lon: 18 }, to: { lat: 59.2, lon: 18 }, path: [] }] },
    ] } as unknown as TransitResult;
    const all = transitFeatures(t);
    expect(all.features.length).toBe(3);
    expect((all.features[0] as any).properties.walk).toBe(true);
    expect((all.features[1] as any).properties.colour).toBe('#2e8b57');
    expect(transitFeatures(t, 'b').features.length).toBe(1);
    expect(transitFeatures(null).features).toEqual([]);
  });

  it('raises the house layers only when they are not already on top', () => {
    expect(layersToRaise(['base', 'house-walk-line', 'house-pin', 'zone-heat-line'])).toEqual(['house-walk-line', 'house-pin']);
    expect(layersToRaise(['base', 'zone-heat-line', 'house-walk-line', 'house-pin'])).toEqual([]);
    expect(layersToRaise(['base', 'zone-heat-line'])).toEqual([]);
    expect(HOUSE_LAYERS.at(-1)).toBe('house-pin');
  });
});
