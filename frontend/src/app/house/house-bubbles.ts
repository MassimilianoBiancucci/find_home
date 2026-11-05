import { Component, computed, effect, inject, input, untracked } from '@angular/core';
import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ExplainInline } from '../components/explain';
import { InfoButton } from '../components/info';
import { toneColor, walkTone } from '../format';
import { Derivation } from '../help';
import { HouseLocation, HouseScores, HouseTrip, IndexKey, TransitResult } from '../models';
import { setColour } from '../set-colours';
import { walkOnly } from '../pages/map/house-layer.service';
import { HouseTravelStore, TransitWhich } from './house-travel.store';

const INDEX_LABELS: Record<IndexKey, string> = { transport: 'Transport', services: 'Services', combined: 'Combined' };
const STOP_SETS = new Set(['rail', 'bus']);

const DEFAULT_ORDER = ['grocery', 'pharmacy', 'gym', 'park', 'vet', 'rail', 'bus'];

/** The sets shown in both bubbles: the payload's order (zone.yaml house.sets), services first, then stops. */
function setOrder(loc: HouseLocation): string[] {
  const keys = loc.sets?.length ? loc.sets
    : [...DEFAULT_ORDER.filter((k) => k in loc.walks), ...Object.keys(loc.walks).filter((k) => !DEFAULT_ORDER.includes(k))];
  return [...keys.filter((k) => !STOP_SETS.has(k)), ...keys.filter((k) => STOP_SETS.has(k))];
}

/** The home transport derivation for the dialog: access and reach, then one row per point of the reach. */
export function houseTransportDerivation(s: HouseScores): Derivation {
  return { ...s.derivation, rows: [...s.derivation.rows,
    ...s.reach_rows.map((r) => ({ name: `· ${r.name}${r.estimate ? ' (estimate)' : ''}`, input: r.input, score: r.score, weight: r.weight, sub: true }))] };
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
        @let v = value(k); @let est = k !== 'services' && !!l.scores?.estimated;
        <div class="fh-hscore" [style.--c]="colour(v)">
          @if (est) { <i class="fh-est-dot" [title]="estTitle()"></i> }
          <div class="fh-hscore-v">{{ v == null ? '–' : (v | number: '1.0-0') }}</div>
          <div class="fh-hscore-l">{{ label(k) }} <fh-info [id]="'house.' + k" [derivation]="derivation(k)" /></div>
          @if (est) { <div class="fh-hscore-n"><span class="fh-badge-est" [title]="estTitle()">estimate</span></div> }
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
  /** The tile value: transport and combined with reach (scores), services as measured. */
  protected value(k: IndexKey): number | null {
    const l = this.loc(), s = l.scores;
    return k === 'transport' ? s?.transport ?? l.transport : k === 'combined' ? s?.combined ?? l.combined : l.services;
  }
  protected derivation(k: IndexKey): Derivation | undefined {
    const l = this.loc(), s = l.scores;
    if (!s || k === 'services') return l.derivation[k];
    if (k === 'transport') return houseTransportDerivation(s);
    const parts = s.combined_parts ?? { transport: 0.5, services: 0.5 };
    return { label: 'Part', scale: 100, total: s.combined, note: 'combined = Σ partₖ · scoreₖ / Σ partₖ over the parts with a value (zone.yaml combined.parts); transport includes reach.',
      rows: [{ name: 'transport (access + reach)', input: s.transport == null ? '–' : `${s.transport} / 100`, score: s.transport == null ? null : s.transport / 100, weight: parts['transport'] ?? 0 },
        { name: 'services', input: s.services == null ? '–' : `${s.services} / 100`, score: s.services == null ? null : s.services / 100, weight: parts['services'] ?? 0 }] };
  }
  protected estTitle(): string {
    const rows = this.loc().scores?.reach_rows.filter((r) => r.estimate).map((r) => r.name) ?? [];
    return `Estimated: the minutes to ${rows.join(', ')} come from the Connectivity matrix (walk to a station + its stored minutes), not from a ResRobot trip from this home. Compute transit routes to your points makes them exact.`;
  }
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

/** "Travel to your points": the free estimate, the insights, and the exact trip once its transit route is computed
 *  (the buttons are in "Transit routes"). Hovering a row with a route highlights it on the maps. */
@Component({
  selector: 'fh-house-travel',
  imports: [InfoButton, DecimalPipe],
  template: `
  @let l = loc();
  <section class="fh-hcard">
    <header><h2>Travel to your points</h2><fh-info id="house.travel" /></header>
    @for (e of l.estimates; track e.point_id) {
      @let t = trip(e.point_id);
      <div class="fh-trow" [class.fh-hot-able]="!!t" [class.hot]="!!t && store.hover() === e.point_id"
        (mouseenter)="t && store.hover.set(e.point_id)" (mouseleave)="t && store.hover.set(null)">
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
    @if (!store.isDone(id(), 'points')) { <div class="fh-hnote">Exact times: <b>Compute transit routes to your points</b> in Transit routes.</div> }
  </section>`,
})
export class HouseTravel {
  readonly loc = input.required<HouseLocation>();
  protected store = inject(HouseTravelStore);
  protected id = computed(() => this.loc().listing.short_id);
  protected result = computed(() => this.store.results()[this.id()] ?? null);
  protected toneCss = toneColor;

  protected trip(pointId: string): HouseTrip | null { return this.result()?.trips.find((t) => t.kind === 'point' && t.point_id === pointId) ?? null; }
  protected insight(pointId: string) { return this.loc().insights.points.find((i) => i.point_id === pointId) ?? null; }
  protected estimateTitle(e: HouseLocation['estimates'][number]): string {
    if (e.source === 'stations') {
      const st = this.loc().stations[e.station ?? ''];
      return `Walk ${e.walk_min} min to ${st?.name ?? 'a station'}, then the stored station → point minutes (no API call)`;
    }
    return e.source === 'zone' ? 'The zone\'s value from the Connectivity matrix (no station data yet)' : '';
  }
}

/**
 * "Transit routes": two explicit buttons, one for the itineraries to your points and one for the nearest service of
 * each set (each with its API call count), the switch that draws the services' routes on the map (off by default:
 * their walks are drawn; on after computing them), and the computed routes. Hovering a route here or on a map
 * draws it on top with a glow.
 */
@Component({
  selector: 'fh-house-transit',
  imports: [InfoButton, DecimalPipe, NgTemplateOutlet],
  template: `
  <section class="fh-hcard">
    <header><h2>Transit routes</h2><span class="fh-hsub">ResRobot, from this home</span><fh-info id="house.transit" /></header>
    <div class="fh-tbtns">
      @for (b of buttons; track b.which) {
        <button type="button" class="btn btn-sm" [class.btn-primary]="!store.isDone(id(), b.which)" [class.btn-outline-primary]="store.isDone(id(), b.which)"
          [disabled]="!!store.busy()" (click)="store.compute(id(), b.which)" (mouseenter)="store.plan(id(), b.which)" (focus)="store.plan(id(), b.which)"
          [title]="title(b.which)">
          {{ store.isBusy(id(), b.which) ? 'Computing…' : b.label }}
          @if (store.planFor(id(), b.which); as p) { <span class="fh-calls">{{ p.calls ? p.calls + ' API call' + (p.calls === 1 ? '' : 's') : 'cached' }}</span> }
        </button>
      }
    </div>
    <div class="form-check form-switch mt-2 small">
      <input class="form-check-input" type="checkbox" role="switch" id="fh-svc-transit" [checked]="store.showServices()"
        (change)="store.showServices.set($any($event.target).checked)" />
      <label class="form-check-label" for="fh-svc-transit">Show the services' transit routes on the map</label>
    </div>
    @if (store.error()) { <div class="small text-danger mt-1">{{ store.error() }}</div> }
    @if (points().length) {
      <div class="fh-tgroup">Your points</div>
      @for (t of points(); track t.point_id) { <ng-container *ngTemplateOutlet="row; context: { $implicit: t }" /> }
    }
    @if (services().length) {
      <div class="fh-tgroup">Nearest services</div>
      @for (t of services(); track t.point_id) { <ng-container *ngTemplateOutlet="row; context: { $implicit: t }" /> }
    }
    @if (!points().length && !services().length) {
      <div class="fh-hnote">Nothing computed yet. Each button asks ResRobot once per destination; answers are cached, so a second press is free.</div>
    }
    <ng-template #row let-t>
      <div class="fh-trow fh-hot-able" [class.hot]="store.hover() === t.point_id" (mouseenter)="store.hover.set(t.point_id)" (mouseleave)="store.hover.set(null)">
        <div class="d-flex align-items-baseline gap-2">
          <span class="fh-grow">{{ t.label }}</span>
          @if (walkOnly(t)) { <span class="small text-body-secondary" title="Too near for transit: the walk is drawn on the map">walk {{ t.minutes | number: '1.0-0' }} min</span> }
          @else if (t.minutes != null) { <b>{{ t.minutes | number: '1.0-0' }} min</b> }
          @else { <span class="small text-body-secondary">{{ t.error || 'no connection' }}</span> }
          @if (t.kind === 'service' && t.walk_min != null && !walkOnly(t)) {
            <span class="small" [class.text-success]="t.beats_walk" [class.text-body-secondary]="!t.beats_walk"
              [title]="'Walking to the same target: ' + t.walk_min + ' min'">{{ t.beats_walk ? 'beats' : 'vs' }} walk {{ t.walk_min | number: '1.0-0' }}′</span>
          }
        </div>
        @if (!walkOnly(t) && t.legs.length) {
          <div class="fh-legs">
            @for (g of t.legs; track $index) {
              <span class="fh-leg" [class.walk]="g.mode === 'walk'" [style.background]="g.mode === 'walk' ? null : (g.color ?? '#607d8b')"
                [title]="(g.name ?? g.mode) + ': ' + (g.from.name ?? '') + ' → ' + (g.to.name ?? '')">{{ g.mode === 'walk' ? 'walk' : (g.line ?? g.mode) }}{{ g.minutes ? ' ' + g.minutes + '′' : '' }}</span>
            }
            @if (t.transfers) { <span class="small text-body-secondary">{{ t.transfers }} change{{ t.transfers === 1 ? '' : 's' }}</span> }
          </div>
        }
      </div>
    </ng-template>
  </section>`,
})
export class HouseTransit {
  readonly loc = input.required<HouseLocation>();
  protected store = inject(HouseTravelStore);
  protected id = computed(() => this.loc().listing.short_id);
  protected buttons: { which: TransitWhich; label: string }[] = [
    { which: 'points', label: 'Compute transit routes to your points' },
    { which: 'services', label: 'Compute transit routes to nearby services' },
  ];
  private result = computed(() => this.store.results()[this.id()] ?? null);
  protected points = computed(() => (this.result()?.trips ?? []).filter((t) => t.kind === 'point'));
  protected services = computed(() => (this.result()?.trips ?? []).filter((t) => t.kind === 'service'));
  protected walkOnly = walkOnly;

  constructor() {
    // count the calls up front (no API call: the server only checks its cache)
    effect(() => {
      const id = this.id();
      untracked(() => { this.store.plan(id, 'points'); this.store.plan(id, 'services'); });
    });
  }

  protected title(which: TransitWhich): string {
    const p = this.store.planFor(this.id(), which);
    const n = p ? `${p.calls} API call${p.calls === 1 ? '' : 's'} (${p.cached} cached)` : 'some API calls';
    return which === 'points'
      ? `Asks ResRobot for the public-transport itinerary from this home to each of your points (config/locations.yaml): ${n}. Drawn on the map along the real lines.`
      : `Asks ResRobot for the itinerary from this home to the nearest target of each service set (grocery, pharmacy, …): ${n}. Turns on the services' routes on the map.`;
  }
}
