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
});
