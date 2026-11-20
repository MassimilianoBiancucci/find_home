import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { describe, expect, it } from 'vitest';
import { Listing } from '../models';
import { COLUMNS, ColumnsStore, DEFAULT_COLUMNS, lastCheck } from './candidate-columns';
import { sortRows } from './candidate-filters';

function store() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
  const s = TestBed.inject(ColumnsStore);
  return { s, http: TestBed.inject(HttpTestingController) };
}
const home = (id: string, x: Partial<Listing>) => ({ short_id: id, pet_status: 'unknown', status: 'new', photo_urls: [], floorplan_urls: [], ...x }) as unknown as Listing;

describe('candidate columns', () => {
  it('starts on today\'s layout, and every column has a unique key and a sort', () => {
    expect(DEFAULT_COLUMNS).toEqual(['score', 'transport', 'services', 'status', 'area', 'move_in', 'issues', 'rooms', 'size', 'rent', 'per_m2', 'pets', 'contract']);
    expect(new Set(COLUMNS.map((c) => c.key)).size).toBe(COLUMNS.length);
    expect(store().s.visible()).toEqual(DEFAULT_COLUMNS);
  });

  it('adds, hides, moves, drops and resets; never hides the last column', () => {
    const { s } = store();
    s.toggle('floor');
    expect(s.visible().at(-1)).toBe('floor');
    s.move('floor', -1);
    expect(s.visible().slice(-2)).toEqual(['floor', 'contract']);
    s.place('floor', 'score');
    expect(s.visible()[0]).toBe('floor');
    s.toggle('floor');
    expect(s.visible()).not.toContain('floor');
    s.visible.set(['score']);
    s.toggle('score');
    expect(s.visible()).toEqual(['score']);
    s.reset();
    expect(s.isDefault()).toBe(true);
  });

  it('loads the saved layout without unknown keys, and saves and applies named views', () => {
    const { s, http } = store();
    s.load();
    http.expectOne('/api/ui-settings/candidates.columns').flush({ value: ['rent', 'gone_column', 'score'] });
    http.expectOne('/api/ui-settings/candidates.views').flush({ value: { Compact: ['score', 'rent'] } });
    expect(s.visible()).toEqual(['rent', 'score']);
    s.saveView('  Move-in  ');
    const put = http.expectOne((r) => r.method === 'PUT' && r.url === '/api/ui-settings/candidates.views');
    expect(put.request.body.value['Move-in']).toEqual(['rent', 'score']);
    s.applyView('Compact');
    expect(s.visible()).toEqual(['score', 'rent']);
    s.deleteView('Compact');
    http.expectOne((r) => r.method === 'PUT' && r.url === '/api/ui-settings/candidates.views');
    expect(Object.keys(s.views())).toEqual(['Move-in']);
  });

  it('sorts by an added column, unknown values last', () => {
    const rows = [home('A', { floor: 3 }), home('B', { floor: null }), home('C', { floor: 1 })];
    expect(sortRows(rows, { key: 'floor', dir: 1 }).map((l) => l.short_id).join('')).toBe('CAB');
    const parts = [home('X', { breakdown: { cost: { score: 0.2, weight: 3, why: '' } } }), home('Y', { breakdown: { cost: { score: 0.9, weight: 3, why: '' } } })];
    expect(sortRows(parts, { key: 'part_cost', dir: -1 })[0].short_id).toBe('Y');
  });

  it('finds the latest status check over the sites and sorts by it', () => {
    const a = home('A', { ad_sources: [
      { site: 'qasa', status: 'open', checked_at: '2026-11-18T10:00:00Z', rule: 'in search results' },
      { site: 'samtrygg', status: 'rented', checked_at: '2026-11-20T09:00:00Z', rule: '410 + badge', check: 'status_check.js' }] });
    const b = home('B', { ad_sources: [{ site: 'qasa', status: 'unknown', checked_at: null }] });
    expect(lastCheck(a)?.site).toBe('samtrygg');
    expect(lastCheck(b)).toBeNull();
    expect(sortRows([b, a], { key: 'status_check', dir: -1 }).map((l) => l.short_id).join('')).toBe('AB');
  });
});
