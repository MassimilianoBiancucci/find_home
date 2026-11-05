import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { walkTone } from '../format';
import { HouseLocation, TransitResult } from '../models';
import { ApiService } from '../services/api.service';
import { HouseHome, HouseTransit, HouseTravel, HouseZone } from './house-bubbles';
import { HouseTravelStore, mergeTrips } from './house-travel.store';

const walk = (set: string, minutes: number | null, n = 1) =>
  ({ set, minutes, metres: minutes == null ? null : minutes * 78, target: minutes == null ? null : `Some ${set}`,
     target_lonlat: null, path: [], count_within: n });

const LOC = {
  lat: 59.3, lon: 18.0, cached: true, listing: { short_id: 'L-TEST', lat: 59.3, lon: 18.0 },
  zone: { id: 'Z1', name: 'Exempelby', district: 'D', kommun: 'K', neighbours: [] }, snapped: true, snap_m: 5,
  sets: ['grocery', 'vet', 'rail'], set_labels: { grocery: 'Groceries', vet: 'Vets', rail: 'Rail' },
  walks: { vet: walk('vet', null, 0), rail: walk('rail', 6), grocery: walk('grocery', 3, 4) },
  transport: 61, services: 80, combined: 70.5, windows: {},
  derivation: { transport: { label: 't', rows: [], total: 61, scale: 100 }, services: { label: 's', rows: [], total: 80, scale: 100 },
    combined: { label: 'c', rows: [], total: 70.5, scale: 100 } },
  services_detail: {}, stops: { reachable_stops: 3, modes: ['bus'] }, choice_within_min: 10, cutoff_min: 30,
  walk_colours: { green: 5, yellow: 10 }, station_walks: { s1: 4 }, stations: { s1: { name: 'near Exempel C', group: 'rail', lat: 0, lon: 0 } },
  estimates: [{ point_id: 'office', label: 'Office', minutes: 31, source: 'stations', station: 's1', walk_min: 4 }],
  listing_commute: {}, zone_index: null,
  insights: { sets: [], points: [{ point_id: 'office', text: 'Office: 31 min estimate (better than 70% of zones)', compare: 'better than 70% of zones', tone: 'good' }] },
} as unknown as HouseLocation;

const TRANSIT: TransitResult = { destinations: 2, calls: 0, cached: 2, ttl_days: 30, provider: 'resrobot', trips: [
  { point_id: 'office', label: 'Office', category: 'work', kind: 'point', when_is: 'arrive_by', direction: 'to_point', day_type: 'weekday',
    slot: '08:30', minutes: 27, transfers: 1, est: false, legs: [
      { mode: 'walk', minutes: 4, from: { name: 'Home', lat: 0, lon: 0, time: null }, to: { name: 'Exempel C', lat: 0, lon: 0, time: null }, path: [] },
      { mode: 'metro', line: '17', color: '#2e8b57', minutes: 23, from: { name: 'Exempel C', lat: 0, lon: 0, time: null }, to: { name: 'Office', lat: 0, lon: 0, time: null }, path: [] }] },
  { point_id: 'service:grocery', label: 'Groceries', category: 'grocery', kind: 'service', when_is: 'depart_at', direction: 'to_point',
    day_type: 'weekday', slot: '10:00', minutes: 2, est: false, legs: [], walk_min: 3, beats_walk: true },
] };

function setup() {
  const kind = (w: string) => (w === 'points' ? 'point' : 'service');
  const api = { listingTransit: vi.fn((_id: string, dry: boolean, which = 'all') => of(dry
    ? { destinations: 2, calls: 2, cached: 0, ttl_days: 30, provider: 'resrobot' }
    : { ...TRANSIT, trips: TRANSIT.trips.filter((x) => which === 'all' || x.kind === kind(which)) })) };
  TestBed.configureTestingModule({ imports: [HouseHome, HouseZone, HouseTravel, HouseTransit], providers: [provideRouter([]), { provide: ApiService, useValue: api }] });
  return api;
}

describe('house bubbles', () => {
  it('tones walking minutes at the configured limits', () => {
    expect([5, 5.1, 10, 10.1].map((m) => walkTone(m))).toEqual(['good', 'neutral', 'neutral', 'bad']);
    expect(walkTone(null)).toBe('bad');
    expect(walkTone(7, { green: 8, yellow: 12 })).toBe('good');
  });

  it('lists the sets in payload order, services before stops, and says when nothing is near', () => {
    setup();
    const f = TestBed.createComponent(HouseHome);
    f.componentRef.setInput('loc', LOC);
    f.detectChanges();
    const rows = [...(f.nativeElement as HTMLElement).querySelectorAll('.fh-hrow:not(.fh-hrow-head)')];
    expect(rows.map((r) => r.querySelector('span')?.textContent?.trim())).toEqual(['Groceries', 'Vets', 'Rail']);
    expect(rows[1].textContent).toContain('none near');
  });

  it('shows the estimate first, then the exact itinerary after computing the routes to your points', async () => {
    const api = setup();
    const make = <T,>(c: new (...a: any[]) => T) => { const f = TestBed.createComponent(c); f.componentRef.setInput('loc', LOC); f.detectChanges(); return f; };
    const travel = make(HouseTravel);
    const transit = make(HouseTransit);
    await Promise.resolve();                         // the dry-run counts are requested in a microtask
    transit.detectChanges();
    const el = travel.nativeElement as HTMLElement, tr = transit.nativeElement as HTMLElement;
    expect(el.textContent).toContain('~31 min');
    expect(el.textContent).toContain('estimate');
    expect(el.querySelector('button.btn')).toBeNull();                                 // the buttons live in Transit routes
    expect(api.listingTransit).toHaveBeenCalledWith('L-TEST', true, 'points');
    expect(api.listingTransit).toHaveBeenCalledWith('L-TEST', true, 'services');
    const buttons = [...tr.querySelectorAll<HTMLButtonElement>('button.btn')];
    expect(buttons.map((b) => b.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      'Compute transit routes to your points 2 API calls', 'Compute transit routes to nearby services 2 API calls']);
    const store = TestBed.inject(HouseTravelStore);
    expect(store.showServices()).toBe(false);
    buttons[0].click();
    travel.detectChanges(); transit.detectChanges();
    expect(api.listingTransit).toHaveBeenCalledWith('L-TEST', false, 'points');
    expect(el.textContent).toContain('27 min');
    expect(el.querySelectorAll('.fh-leg').length).toBe(2);
    expect(store.showServices()).toBe(false);                                        // points do not turn the services on
    buttons[1].click();
    expect(store.showServices()).toBe(true);                                         // computing the services does
    // hovering a route row marks it for the maps
    (tr.querySelector('.fh-trow') as HTMLElement).dispatchEvent(new Event('mouseenter'));
    expect(store.hover()).toBe('office');
  });

  it('keeps the other kind when one kind is computed again', () => {
    const r = mergeTrips(TRANSIT, 'points', { ...TRANSIT, trips: [] });
    expect(r.trips.map((t) => t.point_id)).toEqual(['service:grocery']);
  });

  it('shows "or N min by transit" on a service row when transit beats walking', () => {
    setup();
    const f = TestBed.createComponent(HouseHome);
    f.componentRef.setInput('loc', LOC);
    f.componentRef.setInput('transit', TRANSIT);
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('.fh-hbus')?.textContent).toContain('or 2 min by transit');
  });
});
