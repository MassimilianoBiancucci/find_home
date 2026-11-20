import { describe, expect, it } from 'vitest';
import { daySegments, minutesOf } from './locations';

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

describe('daySegments (a window on the 24-hour bar)', () => {
  it('draws a window inside the day as one labelled piece', () => {
    expect(daySegments('08:00', '09:00')).toEqual([{ left: (480 / 1440) * 100, width: (60 / 1440) * 100, label: true }]);
  });
  it('splits a window over midnight into the end and the start of the day', () => {
    const [early, late] = daySegments('18:00', '03:00');
    expect(early).toMatchObject({ left: 0, width: 12.5, fromMidnight: true, label: false });
    expect(late).toMatchObject({ left: 75, width: 25, toMidnight: true, label: true });
  });
  it('labels the wider piece', () => {
    const segs = daySegments('23:00', '06:00');
    expect(segs.find((s) => s.label)?.fromMidnight).toBe(true);
  });
  it('draws a window ending at 00:00 to the end of the day, in one piece', () => {
    expect(daySegments('20:00', '00:00')).toEqual([{ left: (1200 / 1440) * 100, width: (240 / 1440) * 100, label: true }]);
  });
  it('draws nothing for times that do not parse', () => {
    expect(daySegments('', '09:00')).toEqual([]);
  });
});
