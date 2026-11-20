import { describe, expect, it } from 'vitest';
import { minutesOf } from './locations';

describe('minutesOf (the day bar of a trip)', () => {
  it('reads hh:mm as minutes since midnight', () => {
    expect(minutesOf('08:00')).toBe(480);
    expect(minutesOf('8:30')).toBe(510);
    expect(minutesOf(' 23:59 ')).toBe(1439);
    expect(minutesOf('24:00')).toBe(1440);
  });
  it('gives null for what does not parse or lies outside the day', () => {
    expect(minutesOf('')).toBeNull();
    expect(minutesOf(undefined)).toBeNull();
    expect(minutesOf('8')).toBeNull();
    expect(minutesOf('25:00')).toBeNull();
  });
});
