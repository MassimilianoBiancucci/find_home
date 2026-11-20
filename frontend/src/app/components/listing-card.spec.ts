import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { describe, expect, it } from 'vitest';
import { Listing } from '../models';
import { ListingCard } from './listing-card';

const home = { short_id: 'L-TEST', title: 'Exempelgatan 1', area: 'Exempelby', rent_sek: 9000, rooms_rok: 2, size_m2: 50,
  pet_status: 'ask', status: 'new', photo_urls: [], floorplan_urls: [], first_seen_at: '2026-11-01T00:00:00Z', score: 0.8,
  rejected_by: [], lat: null, lon: null } as unknown as Listing;

describe('fh-listing-card', () => {
  it('shows the home at a glance, and nothing without a home', () => {
    TestBed.configureTestingModule({ imports: [ListingCard], providers: [provideHttpClient(), provideHttpClientTesting()] });
    const f = TestBed.createComponent(ListingCard);
    f.componentRef.setInput('listing', home);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.textContent).toContain('L-TEST');
    expect(el.textContent).toContain('Exempelgatan 1');
    expect(el.querySelector('.fh-lc-table')).toBeTruthy();
    expect(el.querySelector('.fh-lc-tiles')?.children.length).toBe(4);
    f.componentRef.setInput('listing', null);
    f.detectChanges();
    expect(el.querySelector('.fh-lc-table')).toBeNull();
  });
});
