import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { fmtKr, fmtNum, fmtScore, scoreColor } from '../format';
import { indexColour } from '../house/house-bubbles';
import { Listing } from '../models';
import { SitesStore } from '../services/sites.store';
import { ValueScaleStore, valueOf } from '../value-scale';
import { AD_STATUS_LABEL, AdStatusBadge } from './ad-status-badge';
import { PetBadge } from './pet-badge';
import { SiteLogo } from './site-logo';
import { ZoneMinimap } from './zone-minimap';

/** Score groups in plain words (profile.yaml preferences). */
const GROUP_LABEL: Record<string, string> = {
  cost: 'Cost', space: 'Space', commute: 'Commute', cat_suitability: 'Cats', building_comfort: 'Building',
  contract_availability: 'Contract', area: 'Area', transport: 'Transport', services: 'Services', neighbourhood: 'Area life',
};

/** Hard filter codes (scoring.py hard_filter_failures) in plain words. */
const REASON: Record<string, string> = {
  max_rent_sek: 'rent too high', min_size_m2: 'too small', min_rooms_rok: 'too few rooms', outside_search_area: 'outside the area',
  areas_include: 'not in your areas', areas_exclude: 'excluded area', move_in_to: 'move-in too late',
  move_in_from_slack: 'move-in too early', pet_status_exclude: 'no pets', contract_types: 'contract type',
  max_price_sek: 'price too high', max_avgift_sek: 'avgift too high',
};

/**
 * A home at a glance, built to scan without reading: the zone minimap; a header (id, title on one line, score); four
 * figure tiles (rent, size, move-in, transport and services) coloured like the Candidates table; one row of badges
 * (pets, contract, floor, lift, balcony, ad status, origin); a short two-column table whose values never wrap (the
 * full text is on hover). The Candidates list shows it on hovering the id, the Explore map on hovering a house and
 * pinned in the Inspector on click.
 */
@Component({
  selector: 'fh-listing-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, DecimalPipe, PetBadge, SiteLogo, ZoneMinimap, AdStatusBadge],
  template: `
    @let t = listing();
    <fh-zone-minimap [lat]="t?.lat" [lon]="t?.lon" [zoneId]="t?.zone_id" [zoneName]="t?.zone_name" [height]="150" />
    @if (t) {
      <div class="fh-lc-head">
        <span class="fh-lc-id">{{ t.short_id }}</span>
        <span class="fh-lc-title" [title]="t.title || t.address_raw || ''">{{ t.title || t.address_raw }}</span>
        @if (t.issue_codes?.length) { <span class="fh-lc-chip warn" [title]="'Missing: ' + t.issue_codes!.join(', ')">⚠ {{ t.issue_codes!.length }}</span> }
        @if (t.rejected_by?.length) { <span class="fh-lc-score bad" [title]="'Rejected by ' + t.rejected_by!.join(', ')">✕</span> }
        @else { <span class="fh-lc-score" [style.background]="color(t.score)" title="Score">{{ score(t.score) }}</span> }
      </div>
      <div class="fh-lc-sub">
        @if (t.photo_urls.length) { <img class="fh-lc-photo" [src]="t.photo_urls[0]" alt="" /> }
        <div class="fh-lc-where">
          <div class="fh-lc-line" [title]="t.address_raw ?? ''">{{ t.area }}@if (t.zone_name && t.zone_name !== t.area) {<span class="fh-lc-dim"> · {{ t.zone_name }}</span>}@if (!t.zone_id) {<span class="fh-lc-dim"> · outside the zones</span>}</div>
          @if (showAddress(t)) { <div class="fh-lc-line fh-lc-dim" [title]="t.address_raw ?? ''">{{ t.address_raw }}</div> }
        </div>
      </div>

      <div class="fh-lc-tiles">
        @let rr = values.rate(t, 'rent_sek'); @let rm = values.rate(t, 'rent_per_m2');
        <div class="fh-lc-tile" [title]="rr?.title ?? ''"><span class="fh-lc-k">Rent</span>
          <b [style.color]="rr?.colour">{{ kr(t.rent_sek) }}</b>
          <small [style.color]="rm?.colour">{{ perM2(t) == null ? '–' : (perM2(t)! | number: '1.0-0') + ' kr/m²' }}</small></div>
        @let rs = values.rate(t, 'size_m2'); @let ro = values.rate(t, 'rooms_rok');
        <div class="fh-lc-tile" [title]="rs?.title ?? ''"><span class="fh-lc-k">Size</span>
          <b [style.color]="rs?.colour">{{ num(t.size_m2, ' m²') }}</b>
          <small [style.color]="ro?.colour">{{ num(t.rooms_rok) }} rok{{ t.has_sovalkov ? ' + alkov' : '' }}</small></div>
        @let mv = values.moveIn(t);
        <div class="fh-lc-tile" [title]="mv?.title ?? (t.available_from ? '' : 'The ad gives no move-in date')"><span class="fh-lc-k">Move in</span>
          <b [style.color]="mv?.colour">{{ t.available_from ? (t.available_from | date: 'd MMM') : '?' }}</b>
          <small>{{ t.available_from ? (t.available_from | date: 'y') : moveInRaw(t) }}</small></div>
        <div class="fh-lc-tile fh-lc-scores" title="Transport and services from the exact address, 0–100">
          <span class="fh-lc-k">Access</span>
          <span class="fh-lc-srow"><span>Transport</span>
            <span class="fh-lc-sv"><b [style.color]="idx(t.house_transport)">{{ int(t.house_transport) || '–' }}</b><span class="fh-lc-led">@if (t.house_estimated) {<i class="fh-est-dot inline" title="estimate: minutes from the zone, not the address"></i>}</span></span></span>
          <span class="fh-lc-srow"><span>Services</span>
            <span class="fh-lc-sv"><b [style.color]="idx(t.house_services)">{{ int(t.house_services) || '–' }}</b><span class="fh-lc-led"></span></span></span>
        </div>
      </div>

      <div class="fh-lc-badges">
        <fh-pet-badge [status]="t.pet_status" [source]="t.pet_source" [evidence]="t.pet_evidence" prefix="pets " />
        @if (t.floor != null) { <span class="fh-lc-chip">floor {{ t.floor }}</span> }
        @if (t.has_elevator) { <span class="fh-lc-chip yes">lift</span> }
        @if (t.has_balcony) { <span class="fh-lc-chip yes">balcony</span> }
      </div>

      <div class="fh-lc-table">
        @if (t.pet_evidence) {
          <span class="fh-lc-k">Pets</span><span class="fh-lc-v fh-lc-quote" [title]="t.pet_evidence">“{{ t.pet_evidence }}”</span>
        }
        @if (adSource(t); as a) {
          <span class="fh-lc-k">Ad</span>
          <span class="fh-lc-v"><fh-ad-status [status]="a.status" [site]="sites.name(a.site)" [checkedAt]="a.checked_at" />
            <span class="fh-lc-dim"> {{ a.checked_at ? 'checked ' + (a.checked_at | date: 'd MMM') : 'never checked' }}</span></span>
        }
        <span class="fh-lc-k">Contract</span>
        <span class="fh-lc-v" [title]="contractText(t)">{{ contractText(t) }}</span>
        @if (t.origin_site) {
          <span class="fh-lc-k">Origin</span><span class="fh-lc-v"><fh-site-logo [slug]="t.origin_site" [withName]="true" /></span>
        }
        <span class="fh-lc-k">Seen</span>
        <span class="fh-lc-v">{{ t.first_seen_at | date: 'd MMM y' }} <span class="fh-lc-dim">· {{ t.status }}</span></span>
        @if (t.rejected_by?.length) {
          <span class="fh-lc-k">Rejected</span>
          <span class="fh-lc-v fh-lc-wrap">@for (r of t.rejected_by!; track r) { <span class="fh-lc-chip bad" [title]="r">{{ reason(r) }}</span> }</span>
        } @else if (topGroups(t).length) {
          <span class="fh-lc-k">Best for</span>
          <span class="fh-lc-v">@for (g of topGroups(t); track g.name) { <span class="fh-lc-chip" [style.border-color]="color(g.score)" [style.color]="color(g.score)">{{ g.label }} {{ g.pct }}</span> }</span>
        }
      </div>
    }
  `,
})
export class ListingCard {
  readonly listing = input<Listing | null | undefined>(null);
  protected values = inject(ValueScaleStore);
  protected sites = inject(SitesStore);
  protected kr = fmtKr; protected num = fmtNum; protected score = fmtScore; protected color = scoreColor;
  protected idx = indexColour;
  protected int = (v: number | null | undefined) => (v == null ? '' : Math.round(v));
  protected perM2 = (l: Listing) => valueOf(l, 'rent_per_m2');
  protected label = AD_STATUS_LABEL;
  /** The two score groups that add the most to the total, in plain words with their 0–100 value. */
  protected topGroups(l: Listing): { name: string; label: string; pct: number; score: number }[] {
    return Object.entries(l.breakdown ?? {}).filter(([, p]) => p.score != null)
      .sort(([, a], [, b]) => b.score! * b.weight - a.score! * a.weight).slice(0, 2)
      .map(([name, p]) => ({ name, label: GROUP_LABEL[name] ?? name, pct: Math.round(p.score! * 100), score: p.score! }));
  }
  /** The ad's own move-in words when it gives no date ("Nu", "enligt överenskommelse"). */
  protected moveInRaw(l: Listing): string {
    const raw = (l.attributes as Record<string, unknown> | null)?.['move_in_raw'];
    return typeof raw === 'string' ? raw.split('→')[0].trim() : 'no date';
  }
  /** A hard filter that rejects the home, in plain words. */
  protected reason(code: string): string {
    return REASON[code] ?? (code.startsWith('max_commute_min_by_category.') ? `commute (${code.split('.')[1]})` : code.replace(/_/g, ' '));
  }
  /** The street line, unless the title already says it. */
  protected showAddress(l: Listing): boolean {
    const street = (l.address_raw ?? '').split(',')[0].trim().toLowerCase();
    return !!street && !(l.title ?? '').toLowerCase().includes(street);
  }
  protected contractText(l: Listing): string {
    const a = (l.attributes ?? {}) as Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
    const end = l.contract_end ? `until ${l.contract_end}` : a['open_ended'] ? 'open-ended' : '';
    return [l.contract_type?.replace('_', '-') ?? 'type unknown', end].filter(Boolean).join(' · ');
  }
  /** The source whose ad status the card shows: an open one while the home is open, else the first (closed). */
  protected adSource(l: Listing): NonNullable<Listing['ad_sources']>[number] | null {
    const src = l.ad_sources ?? [];
    return (l.ad_open !== false ? src.find((s) => s.status === 'open' || s.status === 'unknown') : null) ?? src[0] ?? null;
  }
}
