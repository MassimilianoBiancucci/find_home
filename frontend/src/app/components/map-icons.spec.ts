import { describe, expect, it } from 'vitest';
import { parsePinId, pinId, shade } from './map-icons';

describe('3D pins', () => {
  it('round-trips the pin id and falls back to a dot for unknown glyphs', () => {
    expect(pinId('cat', '#F3E8FF', '#111111')).toBe('pin3d:cat:f3e8ff:111111');
    expect(parsePinId('pin3d:cat:f3e8ff:111111')).toEqual({ glyph: 'cat', bg: '#f3e8ff', fg: '#111111' });
    expect(pinId('no-such-glyph', '#0089ca')).toBe('pin3d:dot:0089ca:ffffff');
    expect(parsePinId('blip:metro:0089ca')).toBeNull();
    expect(parsePinId('pin3d:metro:zzz:ffffff')).toBeNull();
  });
  it('shades towards white and black', () => {
    expect(shade('#808080', 0.5)).toBe('#c0c0c0');
    expect(shade('#808080', -0.5)).toBe('#404040');
    expect(shade('#0089ca', 0)).toBe('#0089ca');
  });
});
