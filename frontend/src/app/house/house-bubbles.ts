import { Component, computed, inject, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ExplainInline } from '../components/explain';
import { InfoButton } from '../components/info';
import { toneColor, walkTone } from '../format';
import { HouseLocation, HouseTrip, IndexKey, TransitResult } from '../models';
import { setColour } from '../set-colours';
import { HouseTravelStore } from './house-travel.store';

const INDEX_LABELS: Record<IndexKey, string> = { transport: 'Transport', services: 'Services', combined: 'Combined' };
const STOP_SETS = new Set(['rail', 'bus']);

const DEFAULT_ORDER = ['grocery', 'pharmacy', 'gym', 'park', 'vet', 'rail', 'bus'];

/** The sets shown in both bubbles: the payload's order (zone.yaml house.sets), services first, then stops. */
function setOrder(loc: HouseLocation): string[] {
  const keys = loc.sets?.length ? loc.sets
    : [...DEFAULT_ORDER.filter((k) => k in loc.walks), ...Object.keys(loc.walks).filter((k) => !DEFAULT_ORDER.includes(k))];
  return [...keys.filter((k) => !STOP_SETS.has(k)), ...keys.filter((k) => STOP_SETS.has(k))];
}

/** 0-100 index → colour (same ramp idea as the zone tiles: red, amber, green). */
export function indexColour(v: number | null | undefined): string {
  if (v == null) return 'var(--fh-muted)';
  return v >= 70 ? 'var(--fh-good)' : v >= 45 ? 'var(--fh-mid)' : 'var(--fh-bad)';
}

/** "This home": the house's own scores and walks from its exact address. */
@Component({
  selector: 'fh-house-home',
  imports: [InfoButton, ExplainInline, DecimalPipe],
  template: `
  @let l = loc();
  <section class="fh-hcard fh-hcard-main">
    <header><h2>This home</h2><span class="fh-hsub">from the exact address</span><fh-info id="house.home" /></header>
    <div class="fh-hscores">
      @for (k of keys; track k) {
        <div class="fh-hscore" [style.--c]="colour(l[k])">
          <div class="fh-hscore-v">{{ l[k] == null ? '–' : (l[k]! | number: '1.0-0') }}</div>
          <div class="fh-hscore-l">{{ label(k) }} <fh-info [id]="'house.' + k" [derivation]="l.derivation[k]" /></div>
        </div>
      }
    </div>
    <div class="fh-hrows">
      <div class="fh-hrow fh-hrow-head"><span></span><span>walk <fh-info id="house.walk" /></span><span>within {{ l.choice_within_min }} min</span></div>
      @for (s of sets(); track s) {
        @let w = l.walks[s];
        <div class="fh-hrow" [title]="w.target ? 'Nearest: ' + w.target + (w.metres != null ? ' · ' + w.metres + ' m' : '') : 'Nothing within ' + l.cutoff_min + ' min'">
          <span><i class="fh-hdot" [style.background]="dot(s)"></i>{{ l.set_labels[s] ?? s }}</span>
          <span class="fh-hmin" [style.color]="tone(w.minutes)">{{ w.minutes == null ? 'none near' : w.minutes + ' min' }}
            @if (w.metres != null) { <small>{{ w.metres }} m</small> }
            @if (byTransit(s); as t) { <small class="fh-hbus" [title]="'Transit to the same ' + (l.set_labels[s] ?? s) + ' (Compute transit routes)'">or {{ t | number: '1.0-0' }} min by transit</small> }</span>
          <span class="fh-hcount">{{ w.count_within }}</span>
        </div>
      }
    </div>
    @if (l.stops.reachable_stops != null) {
      <div class="fh-hnote">{{ l.stops.reachable_stops }} stops within a short walk · {{ modes() }}@if (peak(); as p) { · busiest window: {{ p.lines }} lines, {{ p.freq }} departures/h }</div>
    }
    <fh-explain helpId="house.services" [derivation]="l.derivation.services" />
  </section>`,
})
export class HouseHome {
  readonly loc = input.required<HouseLocation>();
  readonly transit = input<TransitResult | null>(null);
  protected keys: IndexKey[] = ['transport', 'services', 'combined'];
  protected sets = computed(() => setOrder(this.loc()));
  protected label = (k: IndexKey) => INDEX_LABELS[k];
  protected colour = indexColour;
  protected dot = setColour;
  protected tone(m: number | null): string { return toneColor(walkTone(m, this.loc().walk_colours)); }
  protected modes = computed(() => this.loc().stops.modes.join(', ') || 'no transit');
  protected peak = computed(() => {
    const st = this.loc().stops;
    const wins = Object.keys(st.frequency ?? {});
    if (!wins.length) return null;
    const w = wins.reduce((a, b) => ((st.frequency![b] ?? 0) > (st.frequency![a] ?? 0) ? b : a));
    return { lines: st.lines?.[w] ?? '–', freq: st.frequency?.[w] ?? '–' };
  });
  /** Transit minutes to the same nearest target, when "Compute transit routes" found a faster trip than walking. */
  protected byTransit(set: string): number | null {
    const t = this.transit()?.trips.find((x: HouseTrip) => x.kind === 'service' && x.category === set);
    return t?.beats_walk && t.minutes != null ? t.minutes : null;
  }
}

/** "Its zone": the same rows for the zone (home-weighted medians), its indices and percentiles: the reference. */
@Component({
  selector: 'fh-house-zone',
  imports: [InfoButton, RouterLink, DecimalPipe],
  template: `
  @let l = loc();
  <section class="fh-hcard">
    <header><h2>Its zone</h2><a class="fh-hsub" [routerLink]="['/map/zone', l.zone.id]">{{ l.zone.name }}</a><fh-info id="house.zone" /></header>
    @if (l.zone_index; as z) {
      <div class="fh-hscores">
        @for (k of keys; track k) {
          <div class="fh-hscore" [style.--c]="colour(z[k])">
            <div class="fh-hscore-v">{{ z[k] == null ? '–' : (z[k]! | number: '1.0-0') }}</div>
            <div class="fh-hscore-l">{{ label(k) }} <fh-info [id]="'zone.' + k" [derivation]="z.derivation[k]" /></div>
            @if (z.percentiles[k] != null) { <div class="fh-hscore-n">p{{ z.percentiles[k] | number: '1.0-0' }}</div> }
          </div>
        }
      </div>
      <div class="fh-hrows">
        <div class="fh-hrow fh-hrow-head"><span></span><span>median walk</span><span>within {{ z.choice_within_min }} min</span></div>
        @for (s of sets(); track s) {
          <div class="fh-hrow">
            <span><i class="fh-hdot" [style.background]="dot(s)"></i>{{ l.set_labels[s] ?? s }}</span>
            <span class="fh-hmin">{{ zoneWalk(s) == null ? '–' : zoneWalk(s) + ' min' }}</span>
            <span class="fh-hcount">{{ z.services_detail[s]?.choice ?? '' }}</span>
          </div>
        }
      </div>
      <div class="fh-hnote">p = percentile among all zones (p70: better than 70 %). <fh-info id="zone.percentile" /></div>
    } @else {
      <div class="fh-hnote">Zone indices not available: run <code>findhome zone indices --all</code>.</div>
    }
    <div class="d-flex gap-2 mt-2">
      <a class="btn btn-sm btn-outline-primary" [routerLink]="['/map/zone', l.zone.id]" [queryParams]="{ listing: l.listing.short_id }">Open 3D view</a>
      <a class="btn btn-sm btn-outline-secondary" [routerLink]="['/map/zone', l.zone.id]" [queryParams]="{ listing: l.listing.short_id, fs: 1 }" title="Open the 3D view full screen">⛶ Full screen</a>
    </div>
  </section>`,
})
export class HouseZone {
  readonly loc = input.required<HouseLocation>();
  protected keys: IndexKey[] = ['transport', 'services', 'combined'];
  protected sets = computed(() => setOrder(this.loc()));
  protected label = (k: IndexKey) => INDEX_LABELS[k];
  protected colour = indexColour;
  protected dot = setColour;
  protected zoneWalk(s: string): number | null {
    const z = this.loc().zone_index;
    if (!z) return null;
    if (s === 'rail') return z.measured?.rail_access_min ?? null;
    if (s === 'bus') return z.measured?.bus_access_min ?? null;
    return z.services_detail[s]?.walk_min ?? null;
  }
}

/** "Travel to your points": the free estimate, insights, and the explicit "Compute transit routes". */
@Component({
  selector: 'fh-house-travel',
  imports: [InfoButton, DecimalPipe],
  template: `
  @let l = loc();
  <section class="fh-hcard">
    <header><h2>Travel to your points</h2><fh-info id="house.travel" /></header>
    @for (e of l.estimates; track e.point_id) {
      @let t = trip(e.point_id);
      <div class="fh-trow">
        <div class="d-flex align-items-baseline gap-2">
          <span class="fh-grow">{{ e.label }}</span>
          @if (t && t.minutes != null) {
            <b>{{ t.minutes | number: '1.0-0' }} min</b><span class="fh-badge-ok" title="ResRobot itinerary from this home">exact</span>
          } @else if (l.listing_commute[e.point_id] != null) {
            <b>{{ l.listing_commute[e.point_id] | number: '1.0-0' }} min</b><span class="fh-badge-ok" title="The listing's computed commute (Commute table)">computed</span>
          } @else if (e.minutes != null) {
            <b>~{{ e.minutes | number: '1.0-0' }} min</b>
            <span class="fh-badge-est" [title]="estimateTitle(e)">estimate</span>
          } @else { <span class="text-body-secondary small">not computed</span> }
          <fh-info id="house.estimate" />
        </div>
        @if (insight(e.point_id); as i) { @if (i.compare) { <div class="fh-tins" [style.color]="toneCss(i.tone)">{{ i.compare }}</div> } }
        @if (t) {
          <div class="fh-legs">
            @for (g of t.legs; track $index) {
              <span class="fh-leg" [class.walk]="g.mode === 'walk'" [style.background]="g.mode === 'walk' ? null : (g.color ?? '#607d8b')"
                [title]="(g.name ?? g.mode) + ': ' + g.from.name + ' → ' + g.to.name">{{ g.mode === 'walk' ? 'walk' : (g.line ?? g.mode) }}{{ g.minutes ? ' ' + g.minutes + '′' : '' }}</span>
            }
            @if (t.transfers != null) { <span class="small text-body-secondary">{{ t.transfers }} change{{ t.transfers === 1 ? '' : 's' }}</span> }
            @if (t.error) { <span class="small text-warning">{{ t.error }}</span> }
          </div>
        }
      </div>
    }
    @if (!l.estimates.length) { <div class="fh-hnote">No points with trips in config/locations.yaml.</div> }
    <div class="d-flex align-items-center gap-2 mt-2">
      <button type="button" class="btn btn-sm btn-primary" [disabled]="store.busy() === id()" (click)="store.compute(id())"
        (mouseenter)="store.plan(id())" (focus)="store.plan(id())" [title]="buttonTitle()">
        {{ store.busy() === id() ? 'Computing transit routes…' : 'Compute transit routes' }}
        @if (plan(); as p) { <span class="fh-calls">{{ p.calls ? p.calls + ' API call' + (p.calls === 1 ? '' : 's') : 'cached' }}</span> }
      </button>
      <fh-info id="house.transit" />
    </div>
    @if (store.error()) { <div class="small text-danger mt-1">{{ store.error() }}</div> }
  </section>`,
})
export class HouseTravel {
  readonly loc = input.required<HouseLocation>();
  protected store = inject(HouseTravelStore);
  protected id = computed(() => this.loc().listing.short_id);
  protected plan = computed(() => this.store.plans()[this.id()] ?? null);
  protected result = computed(() => this.store.results()[this.id()] ?? null);
  protected toneCss = toneColor;

  constructor() {
    // count the calls up front (no API call: the server only checks its cache)
    queueMicrotask(() => this.store.plan(this.id()));
  }
  protected trip(pointId: string): HouseTrip | null { return this.result()?.trips.find((t) => t.kind === 'point' && t.point_id === pointId) ?? null; }
  protected insight(pointId: string) { return this.loc().insights.points.find((i) => i.point_id === pointId) ?? null; }
  protected estimateTitle(e: HouseLocation['estimates'][number]): string {
    if (e.source === 'stations') {
      const st = this.loc().stations[e.station ?? ''];
      return `Walk ${e.walk_min} min to ${st?.name ?? 'a station'}, then the stored station → point minutes (no API call)`;
    }
    return e.source === 'zone' ? 'The zone\'s value from the Connectivity matrix (no station data yet)' : '';
  }
  protected buttonTitle(): string {
    const p = this.plan();
    const n = p ? `${p.calls} API call${p.calls === 1 ? '' : 's'} (${p.cached} cached)` : 'some API calls';
    return `Asks ResRobot for public-transport itineraries from this home to your points and the nearest services: ${n}.`;
  }
}
