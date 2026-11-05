import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiService } from '../services/api.service';
import { DetailPage } from './detail';

const listing = { id: 'x', short_id: 'L-TEST', listing_kind: 'rent', pet_status: 'yes', photo_urls: [], floorplan_urls: [], status: 'new',
  first_seen_at: '', last_changed_at: '', lat: null, lon: null };

describe('DetailPage', () => {
  it('loads the listing, the digest and the house analysis once, not again when the analysis arrives', () => {
    const loc = { listing: { short_id: 'L-TEST', lat: 59.3, lon: 18 } };
    const api = {
      listing: vi.fn(() => of({ listing, score: null, score_stale: true, commute: [], feedback: [], evaluations: [], sources: [], events: [] })),
      digest: vi.fn(() => of('digest')),
      listingLocation: vi.fn(() => of(loc)),
      listingTransit: vi.fn(() => of({ destinations: 0, calls: 0, cached: 0, ttl_days: 30, provider: 'resrobot' })),
      listingScale: vi.fn(() => of({ n: 0, fields: {} })),
      config: vi.fn(() => of({ data: { statuses: { default: ['new'] }, tags: { positive: {}, negative: {} } } })),
      sites: vi.fn(() => of({ items: [] })),
    };
    TestBed.configureTestingModule({ imports: [DetailPage], providers: [provideRouter([]), { provide: ApiService, useValue: api }] });
    TestBed.overrideComponent(DetailPage, { set: { template: '' } });   // the reload loop lives in the effect, not the template
    const f = TestBed.createComponent(DetailPage);
    f.componentRef.setInput('shortId', 'L-TEST');
    f.detectChanges();
    TestBed.tick();
    f.detectChanges();
    TestBed.tick();
    expect(api.listing).toHaveBeenCalledTimes(1);
    expect(api.digest).toHaveBeenCalledTimes(1);
    expect(api.listingLocation).toHaveBeenCalledTimes(1);
  });

  it('counts the calls first for a home outside the analysed zones and computes only after Proceed', () => {
    const commute = vi.fn((_ids: string[], dry: boolean) => of({ results: { 'L-TEST': dry
      ? { requests: 8, cached: 2, calls: 6, estimated: 0 } : { requests: 8, cached: 8, calls: 6, estimated: 0 } } }));
    const api = {
      listing: vi.fn(() => of({ listing, score: null, score_stale: true, commute: [], feedback: [], evaluations: [], sources: [], events: [] })),
      digest: vi.fn(() => of('digest')), listingLocation: vi.fn(() => of({ listing: { short_id: 'L-TEST' } })),
      listingScale: vi.fn(() => of({ n: 0, fields: {} })), computeCommute: commute, recompute: vi.fn(() => of({})),
      config: vi.fn(() => of({ data: { statuses: { default: ['new'] }, tags: { positive: {}, negative: {} } } })),
      sites: vi.fn(() => of({ items: [] })),
    };
    TestBed.configureTestingModule({ imports: [DetailPage], providers: [provideRouter([]), { provide: ApiService, useValue: api }] });
    TestBed.overrideComponent(DetailPage, { set: { template: '' } });
    const f = TestBed.createComponent(DetailPage);
    f.componentRef.setInput('shortId', 'L-TEST');
    f.detectChanges();
    const page = f.componentInstance as any;
    page.computeCommute({ ...listing, zone_id: null });
    expect(commute).toHaveBeenLastCalledWith(['L-TEST'], true);                      // forced dry run
    expect(page.commuteAsk()).toEqual({ calls: 6, requests: 8, cached: 2, estimated: 0 });
    expect(commute).toHaveBeenCalledTimes(1);                                         // nothing spent yet
    page.computeCommute({ ...listing, zone_id: null });                               // Proceed
    expect(commute).toHaveBeenLastCalledWith(['L-TEST'], false);
    expect(page.commuteAsk()).toBeNull();
    commute.mockClear();
    page.computeCommute({ ...listing, zone_id: 'Z1' });                               // inside: straight to compute
    expect(commute).toHaveBeenCalledTimes(1);
    expect(commute).toHaveBeenLastCalledWith(['L-TEST'], false);
  });
});
