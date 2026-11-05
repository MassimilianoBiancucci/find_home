import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NEVER, of } from 'rxjs';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ApiService } from '../services/api.service';
import { CandidatesPage } from './candidates';

const rows = [
  { short_id: 'L-AAAA', status: 'new', pet_status: 'yes', photo_urls: [], floorplan_urls: [], score: 0.8, zone_id: 'Z1',
    house_transport: 71.6, house_services: 38.2 },
  { short_id: 'L-BBBB', status: 'new', pet_status: 'ask', photo_urls: [], floorplan_urls: [], score: 0.6 },
];

describe('CandidatesPage keyboard triage', () => {
  let api: Record<string, any>;
  beforeEach(() => {
    api = {
      listings: vi.fn(() => of({ config_hash: 'x', items: structuredClone(rows) })),
      setStatus: vi.fn(() => of({ short_id: 'L-BBBB', from: 'new', to: 'shortlisted' })),
      feedback: vi.fn(() => of({})),
      config: vi.fn(() => of({ data: { statuses: { default: ['new', 'shortlisted', 'rejected'] }, tags: { positive: {}, negative: { too_far: { label: 'Too far' } } } } })),
      recompute: vi.fn(() => of({ scored: 2, rejected: 0 })),
      listingScale: vi.fn(() => of({ n: 0, fields: {} })),
      geoZones: vi.fn(() => of({ type: 'FeatureCollection', features: [] })),
      zoneRegion: vi.fn(() => NEVER),
      mapSettings: vi.fn(() => NEVER),                 // no map in the test DOM
      mapPoints: vi.fn(() => of({ type: 'FeatureCollection', features: [] })),
      sites: vi.fn(() => of({ items: [] })),
    };
    TestBed.configureTestingModule({ imports: [CandidatesPage], providers: [provideRouter([]), { provide: ApiService, useValue: api }] });
  });

  const key = (k: string) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k }));

  it('shows the home\'s transport and services scores, coloured, and says why one is missing', () => {
    const fixture = TestBed.createComponent(CandidatesPage);
    fixture.detectChanges();
    const cells = [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('tbody tr td.fh-idx')];
    expect(cells.slice(0, 2).map((c) => c.textContent?.trim())).toEqual(['72', '38']);
    expect(cells[0].style.color).toBe('var(--fh-good)');
    expect(cells[1].style.color).toBe('var(--fh-bad)');
    expect(cells[2].title).toContain('Outside the analysed zones');
  });

  it('moves with j and shortlists with s', () => {
    const fixture = TestBed.createComponent(CandidatesPage);
    fixture.detectChanges();
    key('j');
    key('s');
    expect(api['setStatus']).toHaveBeenCalledWith('L-BBBB', 'shortlisted');
  });

  it('r opens the tag picker and Enter rejects with tags', () => {
    const fixture = TestBed.createComponent(CandidatesPage);
    fixture.detectChanges();
    key('r');
    const page = fixture.componentInstance as any;
    expect(page.picker()).not.toBeNull();
    page.toggleTag('too_far');
    key('Enter');
    expect(api['feedback']).toHaveBeenCalledWith('L-AAAA', 'dislike', ['too_far'], undefined);
    expect(api['setStatus']).toHaveBeenCalledWith('L-AAAA', 'rejected');
  });
});
