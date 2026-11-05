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

  it('draws transit legs; walk legs only along the streets; services only when asked; one point only', () => {
    const street: [number, number][] = [[18, 59], [18.002, 59.004], [18, 59.01]];
    const t = { trips: [
      { point_id: 'a', label: 'A', kind: 'point', legs: [
        { mode: 'walk', from: { lat: 59, lon: 18 }, to: { lat: 59.01, lon: 18 }, path: street },
        { mode: 'metro', line: '17', color: '#2e8b57', from: { lat: 59.01, lon: 18 }, to: { lat: 59.1, lon: 18.1 }, path: [[18, 59.01], [18.05, 59.05], [18.1, 59.1]] },
        { mode: 'walk', from: { lat: 59.1, lon: 18.1 }, to: { lat: 59.11, lon: 18.1 }, path: [[18.1, 59.1], [18.1, 59.11]] }] },   // two points: not drawn
      { point_id: 'b', label: 'B', kind: 'point', legs: [{ mode: 'bus', from: { lat: 59, lon: 18 }, to: { lat: 59.2, lon: 18 }, path: [] }] },
      { point_id: 'service:grocery', label: 'Groceries', kind: 'service', legs: [
        { mode: 'bus', line: '4', from: { lat: 59, lon: 18 }, to: { lat: 59.02, lon: 18 }, path: [[18, 59], [18, 59.02]] }] },
      { point_id: 'service:vet', label: 'Vets', kind: 'service', legs: [{ mode: 'walk', from: { lat: 59, lon: 18 }, to: { lat: 59.001, lon: 18 }, path: street }] },
    ] } as unknown as TransitResult;
    const all = transitFeatures(t);
    expect(all.features.map((f: any) => [f.properties.trip, f.properties.walk])).toEqual([['a', true], ['a', false], ['b', false]]);
    expect((all.features[1] as any).properties.colour).toBe('#2e8b57');
    // services when the switch is on; a walk-only service trip never (its walk is already on the map)
    expect(transitFeatures(t, { services: true }).features.map((f: any) => f.properties.trip)).toEqual(['a', 'a', 'b', 'service:grocery']);
    expect(transitFeatures(t, { only: 'b' }).features.length).toBe(1);
    expect(transitFeatures(null).features).toEqual([]);
  });

  it('raises the house layers only when they are not already on top', () => {
    expect(layersToRaise(['base', 'house-walk-line', 'house-pin', 'zone-heat-line'])).toEqual(['house-walk-line', 'house-pin']);
    expect(layersToRaise(['base', 'zone-heat-line', 'house-walk-line', 'house-pin'])).toEqual([]);
    expect(layersToRaise(['base', 'zone-heat-line'])).toEqual([]);
    expect(HOUSE_LAYERS.at(-1)).toBe('house-pin');
  });
});
