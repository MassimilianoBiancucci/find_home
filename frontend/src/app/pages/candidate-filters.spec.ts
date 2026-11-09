import { describe, expect, it } from 'vitest';
import { Listing } from '../models';
import { FILTER_FIELDS, applyAll, applyFilters, dayOf, domainOf, histogram, sortRows } from './candidate-filters';

const home = (id: string, x: Partial<Listing>) => ({ short_id: id, pet_status: 'unknown', status: 'new', photo_urls: [], ...x }) as unknown as Listing;
const rows = [
  home('A', { score: 0.9, rent_sek: 9000, size_m2: 50, available_from: '2030-03-01' }),
  home('B', { score: 0.7, rent_sek: 12000, size_m2: 70 }),
  home('C', { score: null, rent_sek: 15000, size_m2: 40, available_from: '2030-08-01' }),
  home('D', { score: 0.8, rent_sek: null, size_m2: 60, available_from: '2030-05-15' }),
];
const ids = (ls: Listing[]) => ls.map((l) => l.short_id).join('');
const field = (k: string) => FILTER_FIELDS.find((f) => f.key === k)!;

describe('candidate filters', () => {
  it('keeps homes inside every range, and homes without the value unless told to drop them', () => {
    expect(ids(applyFilters(rows, { rent_sek: { lo: 10000, hi: null, dropUnknown: false } }))).toBe('BCD');
    expect(ids(applyFilters(rows, { rent_sek: { lo: 10000, hi: null, dropUnknown: true } }))).toBe('BC');
    expect(ids(applyFilters(rows, { rent_sek: { lo: null, hi: 12000, dropUnknown: false }, size_m2: { lo: 55, hi: null, dropUnknown: false } }))).toBe('BD');
    const window = { lo: dayOf('2030-02-01'), hi: dayOf('2030-06-30'), dropUnknown: true };
    expect(ids(applyFilters(rows, { move_in: window }))).toBe('AD');
    expect(ids(applyFilters(rows, { move_in: window }, 'move_in'))).toBe('ABCD');     // its own histogram ignores it
  });

  it('snaps the domain outwards to the step and bins the values, counting those in range', () => {
    expect(domainOf(rows, field('rent_sek'))).toEqual([9000, 15000]);
    expect(domainOf([home('X', { rent_sek: 9050 }), home('Y', { rent_sek: 9420 })], field('rent_sek'))).toEqual([9000, 9500]);
    const many = [...Array.from({ length: 98 }, (_, i) => home(`H${i}`, { rent_sek: 8000 + i * 50 })),
      home('O1', { rent_sek: 2000 }), home('O2', { rent_sek: 90000 })];
    expect(domainOf(many, field('rent_sek'))).toEqual([8000, 12800]);                   // the outliers (and the 2 % ends) fall outside the slider
    expect(histogram([2000, 8000, 90000], [8000, 12800], 100, -Infinity, Infinity).reduce((a, b) => a + b.inRange, 0)).toBe(3);
    const bins = histogram([1, 1.5, 2, 2, 3], [1, 3], 0.5, 2, 3);
    expect(bins.length).toBe(5);
    expect(bins.map((b) => b.count)).toEqual([1, 1, 2, 0, 1]);
    expect(bins.reduce((a, b) => a + b.inRange, 0)).toBe(3);
  });

  it('keeps homes with any chosen value of a category, with the ranges, and skips the one asked', () => {
    const cats = [
      home('Q', { origin_site: 'homeq', found_on: ['qasa'], pet_status: 'yes', contract_type: 'first_hand', rent_sek: 9000 }),
      home('S', { origin_site: 'samtrygg', found_on: ['samtrygg'], pet_status: 'unknown', contract_type: 'second_hand', rent_sek: 11000 }),
      home('B', { origin_site: 'bostad', pet_status: 'no', contract_type: null, rent_sek: 8000 }),
    ];
    expect(ids(applyAll(cats, {}, { site: ['qasa'] }))).toBe('Q');                    // found on Qasa, first published on HomeQ
    expect(ids(applyAll(cats, {}, { site: ['homeq', 'bostad'] }))).toBe('QB');
    expect(ids(applyAll(cats, {}, { pets: ['yes', 'unknown'], contract: ['second_hand'] }))).toBe('S');
    expect(ids(applyAll(cats, {}, { contract: ['unknown'] }))).toBe('B');
    expect(ids(applyAll(cats, { rent_sek: { lo: 8500, hi: null, dropUnknown: false } }, { pets: ['yes', 'no'] }))).toBe('Q');
    expect(ids(applyAll(cats, {}, { pets: ['no'] }, 'pets'))).toBe('QSB');
  });

  it('gives one bar per value to a short discrete range, and spans to a long one', () => {
    expect(histogram([2, 2.5, 3], [2, 3], 0.5, -Infinity, Infinity).map((b) => b.value)).toEqual([2, 2.5, 3]);
    expect(histogram([1000, 5000], [0, 100000], 100, -Infinity, Infinity)[0].value).toBeUndefined();
  });

  it('sorts both ways with homes without the value last, ties in the server order', () => {
    expect(ids(sortRows(rows, { key: 'score', dir: -1 }))).toBe('ADBC');
    expect(ids(sortRows(rows, { key: 'score', dir: 1 }))).toBe('BDAC');
    expect(ids(sortRows(rows, { key: 'rent', dir: 1 }))).toBe('ABCD');
    expect(ids(sortRows(rows, { key: 'move_in', dir: 1 }))).toBe('ADCB');
    expect(ids(sortRows(rows, { key: 'pets', dir: -1 }))).toBe('ABCD');
  });
});
