import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { fmtKr, fmtNum, fmtScore, scoreColor } from '../format';
import { indexColour } from '../house/house-bubbles';
import { Listing } from '../models';
import { ValueScaleStore, valueOf } from '../value-scale';
import { PetBadge } from './pet-badge';
import { SiteLogo } from './site-logo';
import { ZoneMinimap } from './zone-minimap';

/**
 * A home at a glance: where it is (the zone minimap), score, first photo, rent, size, transport and services, building,
 * pets, origin, move-in, contract, status and what it is best for. The Candidates list shows it on hovering the id,
 * the Explore map on hovering a house and pinned in the Inspector on click.
 */
@Component({
  selector: 'fh-listing-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, DecimalPipe, PetBadge, SiteLogo, ZoneMinimap],
  template: `
    @let t = listing();
    <fh-zone-minimap [lat]="t?.lat" [lon]="t?.lon" [zoneId]="t?.zone_id" [zoneName]="t?.zone_name" [height]="170" />
    @if (t) {
      <div class="fh-ltip-head"><span class="fh-mono">{{ t.short_id }}</span><b>{{ t.title || t.address_raw }}</b>
        @if (t.rejected_by?.length) { <span class="badge text-bg-danger">rejected</span> }
        @else { <strong [style.color]="color(t.score)">{{ score(t.score) }}</strong> }</div>
      @if (t.photo_urls.length) { <img class="fh-ltip-photo" [src]="t.photo_urls[0]" alt="" /> }
      <div class="fh-ltip-grid">
        <span>Where</span><span>{{ t.area }}{{ t.zone_name && t.zone_name !== t.area ? ' · zone ' + t.zone_name : '' }}{{ t.zone_id ? '' : ' · outside the zones' }}</span>
        <span>Rent</span><span><b [style.color]="values.rate(t, 'rent_sek')?.colour">{{ kr(t.rent_sek) }}</b>
          @if (perM2(t) != null) { <span [style.color]="values.rate(t, 'rent_per_m2')?.colour"> · {{ perM2(t)! | number: '1.0-0' }} kr/m²</span> }</span>
        <span>Size</span><span><span [style.color]="values.rate(t, 'rooms_rok')?.colour">{{ num(t.rooms_rok) }} rok{{ t.has_sovalkov ? ' + alkov' : '' }}</span> ·
          <span [style.color]="values.rate(t, 'size_m2')?.colour">{{ num(t.size_m2, ' m²') }}</span></span>
        @if (t.house_transport != null) {
          <span>From the address</span><span>transport <b [style.color]="idx(t.house_transport)">{{ int(t.house_transport) }}</b>@if (t.house_estimated) { <i class="fh-est-dot inline"></i> <span class="fh-badge-est">estimate</span> } ·
            services <b [style.color]="idx(t.house_services)">{{ int(t.house_services) }}</b></span>
        }
        <span>Building</span><span>floor {{ t.floor ?? '?' }}{{ t.has_elevator ? ', lift' : '' }}{{ t.has_balcony ? ', balcony' : '' }}{{ t.build_year ? ' · built ' + t.build_year : '' }}</span>
        <span>Pets</span><span><fh-pet-badge [status]="t.pet_status" [source]="t.pet_source" />
          @if (t.pet_evidence) { <span class="text-body-secondary"> “{{ t.pet_evidence }}”</span> }</span>
        @if (t.origin_site) { <span>Origin</span><span><fh-site-logo [slug]="t.origin_site" [withName]="true" /></span> }
        <span>Move in</span><span [style.color]="values.moveIn(t)?.colour">{{ t.available_from ? (t.available_from | date: 'd MMM y') : '?' }}</span>
        <span>Contract</span><span>{{ t.contract_type?.replace('_', '-') ?? '?' }}{{ t.contract_end ? ' → ' + t.contract_end : '' }}</span>
        <span>Status</span><span>{{ t.status }} · seen {{ t.first_seen_at | date: 'mediumDate' }}</span>
        @if (t.rejected_by?.length) { <span>Rejected by</span><span class="text-danger">{{ t.rejected_by!.join(', ') }}</span> }
        @else if (topGroups(t).length) { <span>Best for</span><span>{{ topGroups(t).join(' · ') }}</span> }
      </div>
    }
  `,
})
export class ListingCard {
  readonly listing = input<Listing | null | undefined>(null);
  protected values = inject(ValueScaleStore);
  protected kr = fmtKr; protected num = fmtNum; protected score = fmtScore; protected color = scoreColor;
  protected idx = indexColour;
  protected int = (v: number | null | undefined) => (v == null ? '' : Math.round(v));
  protected perM2 = (l: Listing) => valueOf(l, 'rent_per_m2');
  /** The two score groups that add the most to the total. */
  protected topGroups(l: Listing): string[] {
    return Object.entries(l.breakdown ?? {}).filter(([, p]) => p.score != null)
      .sort(([, a], [, b]) => b.score! * b.weight - a.score! * a.weight).slice(0, 2)
      .map(([name, p]) => `${name} ${fmtScore(p.score)}`);
  }
}
