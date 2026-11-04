import { describe, expect, it } from 'vitest';
import { circle } from './zone.service';

describe('circle', () => {
  it('is closed and keeps its radius in metres at Stockholm latitude', () => {
    const ring = circle(18.0, 59.33, 400);
    expect(ring.length).toBe(65);
    expect(ring[0]).toEqual(ring[64]);
    const [lon, lat] = ring[16];                                   // a quarter turn: due north
    expect(Math.abs(lon - 18.0)).toBeLessThan(1e-6);
    expect(Math.round((lat - 59.33) * 111_320)).toBe(400);
    const east = ring[0][0] - 18.0;
    expect(Math.round(east * 111_320 * Math.cos((59.33 * Math.PI) / 180))).toBe(400);
  });
});
