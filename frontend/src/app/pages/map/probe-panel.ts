import { Component, Injectable, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { ProbeResult, SavedProbe } from '../../models';
import { ApiService, apiError } from '../../services/api.service';
import { blipUrl } from '../../components/map-icons';
import { MapStateService } from './map-state.service';
import { MODE_COLOURS, ProbeService } from './probe.service';
import { ConnectivityService } from './connectivity.service';

/** Alpha: named test points kept in the database, compared side by side (2-3). */
@Injectable({ providedIn: 'root' })
export class SavedProbesService {
  private api = inject(ApiService);
  readonly items = signal<SavedProbe[]>([]);
  readonly compareIds = signal<string[]>([]);
  readonly compared = signal<{ probe: SavedProbe; result: ProbeResult }[]>([]);
  readonly error = signal('');

  load(): void { this.api.savedProbes().subscribe({ next: (x) => this.items.set(x), error: (e) => this.error.set(apiError(e)) }); }
  save(name: string, lat: number, lon: number): void {
    this.api.saveProbe({ name, lat, lon }).subscribe({ next: () => this.load(), error: (e) => this.error.set(apiError(e)) });
  }
  remove(id: string): void {
    this.compareIds.update((ids) => ids.filter((x) => x !== id));
    this.api.deleteProbe(id).subscribe({ next: () => this.load(), error: (e) => this.error.set(apiError(e)) });
  }
  toggleCompare(id: string): void {
    this.compareIds.update((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id].slice(-3)));
    const chosen = this.items().filter((p) => this.compareIds().includes(p.id));
    if (chosen.length < 2) { this.compared.set([]); return; }
    forkJoin(chosen.map((p) => this.api.probe(p.lat, p.lon))).subscribe({
      next: (res) => this.compared.set(chosen.map((probe, i) => ({ probe, result: res[i] }))),
      error: (e) => this.error.set(apiError(e)),
    });
  }
}

/** Left-bubble list of saved test points (alpha). */
@Component({
  selector: 'fh-saved-probes',
  template: `
    <div class="small text-body-secondary mb-1">Alpha: saved test points. Tick 2-3 to compare them in the inspector.</div>
    @for (p of saved.items(); track p.id) {
      <div class="fh-row">
        <input type="checkbox" class="form-check-input" [checked]="saved.compareIds().includes(p.id)" (change)="saved.toggleCompare(p.id)" title="compare" />
        <a href="" class="fh-grow" (click)="$event.preventDefault(); go(p)">{{ p.name }}</a>
        <button class="btn btn-sm btn-link text-danger p-0" title="Delete" (click)="saved.remove(p.id)">✕</button>
      </div>
    } @empty { <div class="small text-body-secondary">None yet: drop a test point and press Save.</div> }
    @if (saved.error()) { <div class="small text-danger">{{ saved.error() }}</div> }`,
})
export class SavedProbesList {
  protected saved = inject(SavedProbesService);
  private probe = inject(ProbeService);
  private state = inject(MapStateService);
  constructor() { this.saved.load(); }
  protected go(p: SavedProbe): void {
    this.probe.set(p.lat, p.lon);
    this.state.map()?.easeTo({ center: [p.lon, p.lat], zoom: Math.max(this.state.map()!.getZoom(), 14) });
  }
}

/** Right-panel card for the test point: area score, nearest POIs with walking minutes, trips to your points. */
@Component({
  selector: 'fh-probe-panel',
  imports: [DecimalPipe, FormsModule],
  template: `
  @if (state.testPoint(); as p) {
    <div class="d-flex align-items-center gap-2 mb-1">
      <img [src]="pinIcon" width="22" height="22" alt="" />
      <b class="fh-grow">Test point</b>
      <button class="btn btn-sm btn-outline-secondary py-0" (click)="probe.clear()">Clear</button>
    </div>
    <div class="small text-body-secondary fh-mono">{{ p.lat | number: '1.5-5' }}, {{ p.lon | number: '1.5-5' }}</div>
    @if (probe.loading()) { <div class="small mt-2">Looking around…</div> }
    @if (probe.error()) { <div class="alert alert-danger py-1 small mt-2">{{ probe.error() }}</div> }
    @if (probe.result(); as r) {
      @if (r.area.zone; as z) { <div class="small mt-1">{{ z.name }} · {{ short(z.district) }}</div> }

      <div class="fh-section mt-3">Search area</div>
      @if (!r.area.defined) { <div class="small text-body-secondary">No search area saved yet (Area mode).</div> }
      @else {
        <div>{{ r.area.inside ? 'Inside' : r.area.distance_m + ' m outside' }} · score <b>{{ r.area.score | number: '1.2-2' }}</b>
          @if (r.area.score === 0) { <span class="badge text-bg-danger ms-1">outside</span> }</div>
        @for (c of r.area.contributions ?? []; track c.piece) {
          <div class="small mt-1">{{ c.label }} ×{{ c.weight }} · {{ c.distance_m ? c.distance_m + ' m' : 'inside' }} → {{ c.value | number: '1.2-2' }}</div>
          <div class="fh-bar" [style.width.%]="c.value * 100" [style.opacity]="c.piece === r.area.best_piece ? 1 : 0.4"></div>
        }
      }

      <div class="fh-section mt-3">Nearby</div>
      @if (r.pois.walk_error) { <div class="small text-body-secondary mb-1" [title]="r.pois.walk_error">Walking minutes estimated (straight line × 1.3): {{ walkReason(r.pois.walk_error) }}</div> }
      @for (c of r.pois.categories; track c.category) {
        <details class="fh-poi">
          <summary>
            <img [src]="icon(c.icon, c.color)" width="20" height="20" alt="" />
            <span class="fh-grow">{{ c.label }} <span class="text-body-secondary small">{{ c.items[0]?.name }}</span></span>
            @if (c.items[0]; as best) {
              <span class="fh-min" [class.ok]="c.within" [class.far]="c.max_walk_min && best.minutes > c.max_walk_min">{{ best.minutes | number: '1.0-0' }}′@if (best.est) {<sup>~</sup>}</span>
            }
          </summary>
          @for (i of c.items; track i.id) {
            <div class="small d-flex gap-2 ps-4"><span class="fh-grow">{{ i.name }}</span><span>{{ i.minutes | number: '1.0-0' }}′ · {{ i.straight_m }} m</span></div>
          }
        </details>
      }
      @if (r.pois.not_fetched.length) { <div class="small text-warning">Not fetched yet: {{ r.pois.not_fetched.join(', ') }} (findhome geo fetch poi)</div> }

      <div class="fh-section mt-3">Your points</div>
      @for (t of r.trips; track t.point_id) {
        <button class="fh-trip" [class.on]="probe.activeTrip() === t.point_id" (click)="probe.activeTrip.set(t.point_id)">
          <div class="d-flex gap-2 align-items-baseline">
            <span class="fh-grow text-start">{{ t.label }}</span>
            <b>{{ t.minutes == null ? '–' : (t.minutes | number: '1.0-0') + '′' }}</b>@if (t.est) {<sup title="straight-line estimate">~</sup>}
          </div>
          <div class="small text-body-secondary text-start">{{ t.direction === 'to_point' ? 'there' : 'back' }} · {{ t.day_type }} {{ t.kind === 'arrive_by' ? 'arrive' : 'leave' }} {{ t.slot }}
            @if (t.transfers != null) { · {{ t.transfers }} change{{ t.transfers === 1 ? '' : 's' }} }
            @if (zoneMin(r, t.point_id); as zm) { · <span [class.text-warning]="t.minutes != null && abs(zm - t.minutes) > 10" title="Connectivity matrix value for this zone">zone ~{{ zm | number: '1.0-0' }}′</span> }</div>
          @if (t.legs.length) {
            <div class="fh-legs">
              @for (l of t.legs; track $index) {
                <span class="fh-leg" [style.background]="l.color ?? colour(l.mode)" [class.walk]="l.mode === 'walk'"
                  [title]="(l.name ?? l.mode) + ': ' + l.from.name + ' → ' + l.to.name">{{ l.mode === 'walk' ? '🚶' : (l.line ?? l.mode) }}{{ l.minutes ? ' ' + l.minutes + '′' : '' }}</span>
              }
            </div>
          }
          @if (t.error) { <div class="small text-warning text-start">{{ t.error }}</div> }
        </button>
      }

      <div class="fh-section mt-3">Save <span class="badge text-bg-secondary">alpha</span></div>
      <div class="d-flex gap-2">
        <input class="form-control form-control-sm" placeholder="name, e.g. Hornstull idea" [(ngModel)]="name" />
        <button class="btn btn-sm btn-outline-primary" [disabled]="!name.trim()" (click)="save(p.lat, p.lon)">Save</button>
      </div>
    }
  } @else {
    <div class="small text-body-secondary">Right-click the map, or press <b>Test point</b> above the map and click, to see what a spot offers.</div>
  }

  @if (saved.compared().length > 1) {
    <div class="fh-section mt-3">Compare <span class="badge text-bg-secondary">alpha</span></div>
    <table class="table table-sm small fh-compare">
      <thead><tr><th></th>@for (c of saved.compared(); track c.probe.id) { <th>{{ c.probe.name }}</th> }</tr></thead>
      <tbody>
        <tr><td>Area</td>@for (c of saved.compared(); track c.probe.id) { <td>{{ c.result.area.defined ? (c.result.area.score | number: '1.2-2') : '–' }}</td> }</tr>
        @for (row of compareRows(); track row.key) {
          <tr><td>{{ row.label }}</td>@for (v of row.values; track $index) { <td>{{ v == null ? '–' : (v | number: '1.0-0') + '′' }}</td> }</tr>
        }
      </tbody>
    </table>
  }`,
  styles: [`
    .fh-grow { flex: 1; min-width: 0; }
    .fh-bar { height: 6px; border-radius: 3px; background: var(--fh-violet); }
    .fh-poi { border-bottom: 1px solid var(--bs-border-color); padding: 3px 0;
      summary { display: flex; align-items: center; gap: 6px; cursor: pointer; list-style: none; } }
    .fh-min { font-weight: 600; min-width: 34px; text-align: right; &.ok { color: var(--fh-good); } &.far { color: var(--fh-mid); } }
    .fh-trip { display: block; width: 100%; text-align: left; background: var(--fh-sub); border: 1px solid var(--bs-border-color);
      border-radius: 8px; padding: 6px 8px; margin-bottom: 6px; color: inherit;
      &.on { border-color: var(--fh-violet); box-shadow: inset 3px 0 0 var(--fh-violet); } }
    .fh-legs { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 4px; }
    .fh-leg { font-size: .72rem; font-weight: 600; color: #fff; border-radius: 4px; padding: 0 5px; text-shadow: 0 1px 1px #0008;
      &.walk { background: transparent !important; color: var(--bs-secondary-color); border: 1px dashed var(--bs-border-color); text-shadow: none; } }
    .fh-compare { --bs-table-bg: transparent; }
  `],
})
export class ProbePanel {
  protected state = inject(MapStateService);
  protected probe = inject(ProbeService);
  protected saved = inject(SavedProbesService);
  private conn = inject(ConnectivityService);
  protected name = '';
  protected pinIcon = blipUrl('target', '#b45cf0');

  protected compareRows = computed(() => {
    const cs = this.saved.compared();
    if (!cs.length) return [];
    const rows: { key: string; label: string; values: (number | null)[] }[] = [];
    for (const cat of cs[0].result.pois.categories) {
      rows.push({ key: `poi-${cat.category}`, label: cat.label,
        values: cs.map((c) => c.result.pois.categories.find((x) => x.category === cat.category)?.items[0]?.minutes ?? null) });
    }
    for (const t of cs[0].result.trips) {
      rows.push({ key: `trip-${t.point_id}`, label: t.label, values: cs.map((c) => c.result.trips.find((x) => x.point_id === t.point_id)?.minutes ?? null) });
    }
    return rows;
  });

  protected icon(glyph: string | null, color: string | null): string { return blipUrl(glyph, color); }
  protected colour(mode: string): string { return MODE_COLOURS[mode] ?? MODE_COLOURS['transit']; }
  protected short(d: string): string { return d.replace(/ stadsdelsområde$/, ''); }
  protected walkReason(e: string): string { return e.includes('not set') ? 'add ORS_API_KEY for real walking routes' : 'walking service unavailable'; }
  protected save(lat: number, lon: number): void { this.saved.save(this.name.trim(), lat, lon); this.name = ''; }
  protected zoneMin(r: ProbeResult, pointId: string): number | null { return this.conn.minutes(r.area.zone?.id, pointId); }
  protected abs(v: number): number { return Math.abs(v); }
}
