import { Component, DestroyRef, TemplateRef, afterNextRender, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ConnectivityJob, ConnectivityScope, RouteStatus, ZoneCommute } from '../../models';
import { ApiService } from '../../services/api.service';
import { LayoutService } from '../../services/layout.service';
import { ConnectivityDecision, ConnectivityRoutesDialog } from './connectivity-dialogs';
import { ConnectivityService, IDX_RAMP, RAMP, SCOPE_LABELS, STATUS_COLOURS } from './connectivity.service';
import { MapStateService } from './map-state.service';
import { ProbePanel } from './probe-panel';

/** Connectivity mode: zones coloured by commute minutes to your points (one point or the weighted mix). */
@Component({
  selector: 'fh-connectivity-mode',
  imports: [DecimalPipe, RouterLink, ProbePanel, ConnectivityDecision, ConnectivityRoutesDialog],
  template: `
  <ng-template #viewTpl>
    @if (conn.matrix(); as m) {
      <label class="fh-row"><input type="radio" class="form-check-input" name="cview" [checked]="conn.view() === 'weighted'" (change)="conn.setView('weighted')" />
        <span class="fh-grow">All points, weighted</span></label>
      @for (p of m.points; track p.id) {
        <label class="fh-row"><input type="radio" class="form-check-input" name="cview" [checked]="conn.view() === p.id" (change)="conn.setView(p.id)" />
          <span class="fh-swatch" [style.background]="p.color"></span><span class="fh-grow">{{ p.label }}</span>
          <span class="small text-body-secondary">×{{ p.weight }}</span></label>
      }
      <div class="fh-section mt-2">Mobility index</div>
      <label class="fh-row"><input type="radio" class="form-check-input" name="cview" [checked]="conn.view() === 'idx:transport'" (change)="conn.setView('idx:transport')" />
        <span class="fh-grow">Transport</span></label>
      <label class="fh-row"><input type="radio" class="form-check-input" name="cview" [checked]="conn.view() === 'idx:transport_services'" (change)="conn.setView('idx:transport_services')" />
        <span class="fh-grow">Transport + services</span></label>
      @if (conn.view().startsWith('idx:')) {
        @if (conn.indices(); as ix) {
          <select class="form-select form-select-sm mt-1" [value]="conn.indexWindow()" (change)="conn.setIndexWindow($any($event.target).value)">
            <option value="">Average of the day</option>
            @for (w of ix.windows; track w) { <option [value]="w">{{ w }}</option> }
          </select>
          <div class="fh-ramp mt-2">
            @for (r of idxRamp; track r[0]) { <span [style.background]="r[1]">{{ r[0] }}</span> }
            <span class="small text-body-secondary ms-1">percentile</span>
          </div>
          @if (ix.count < ix.zone_count) { <div class="small text-warning mt-1">{{ ix.count }}/{{ ix.zone_count }} zones computed: <code>findhome zone indices --all</code></div> }
        }
      } @else {
        <div class="fh-ramp mt-2">
          @for (r of ramp; track r[0]; let last = $last) { <span [style.background]="r[1]">{{ r[0] }}{{ last ? '+' : '' }}</span> }
          <span class="small text-body-secondary ms-1">min</span>
        </div>
      }
      <label class="small mt-2 d-block">Opacity
        <input type="range" class="form-range" min="0.15" max="0.9" step="0.05" [value]="conn.opacity()" (input)="conn.setOpacity(+$any($event.target).value)" /></label>
      <div class="small text-body-secondary">Transit, from a point inside each zone, at the middle slot of each window; the weighted mix uses your point weights.</div>
    } @else { <div class="small text-body-secondary">Loading…</div> }
    @if (conn.error()) { <div class="small text-danger">{{ conn.error() }}</div> }
  </ng-template>

  <ng-template #matrixTpl>
    @if (conn.job(); as j) {
      <div class="small mb-1"><b>{{ stateLabel(j) }}</b> · {{ j.provider ?? '–' }} · {{ conn.coverage() }} zones</div>
      @if (j.running) {
        <div class="progress my-1" style="height:6px"><div class="progress-bar" [style.width.%]="j.total ? j.done / j.total * 100 : 0"></div></div>
        <div class="small text-body-secondary">{{ j.done }}/{{ j.total }} · {{ j.calls }} calls · {{ j.cached }} from cache ·
          {{ j.failed }} failed@if (j.estimated) { · {{ j.estimated }} estimated }
          @if (j.eta_s) { · ~{{ (j.eta_s / 60) | number: '1.0-0' }} min left }</div>
      }
      @if (conn.matrix()?.counts; as c) {
        <div class="fh-counts my-2">
          <span class="fh-c"><b>{{ c.evaluated }}</b>/{{ c.planned }} evaluated</span>
          @for (s of statuses; track s) {
            @if (c[s]) { <span class="fh-c" [style.--c]="colours[s]" [title]="help[s]"><i></i>{{ c[s] }} {{ s }}</span> }
          }
        </div>
      }
      @if (j.running) {
        <button class="btn btn-sm btn-outline-danger" (click)="conn.cancel()">Cancel</button>
      } @else {
        <div class="d-flex flex-wrap gap-1">
          @for (a of actions; track a.key) {
            <button class="btn btn-sm" [class.btn-outline-primary]="a.key === main" [class.btn-outline-secondary]="a.key !== main"
              [disabled]="!enabled(a.key)" (click)="conn.refresh(a.scope)" [title]="costTitle(a.key)">
              {{ a.label }}@if (cost(a.key); as n) { · {{ n }} calls }</button>
          }
        </div>
      }
      <div class="d-flex align-items-center gap-2 mt-2">
        <button class="btn btn-sm btn-link p-0" (click)="conn.routesOpen.set(true)">Open route list</button>
        <label class="form-check form-switch small ms-auto mb-0" title="Zones with only estimates turn grey">
          <input type="checkbox" class="form-check-input" [checked]="conn.excludeEstimates()" (change)="conn.setExcludeEstimates(!conn.excludeEstimates())" />
          <span class="form-check-label">Exclude estimates</span></label>
      </div>
      @if (j.provider === 'haversine') { <div class="small text-warning mt-1">Straight-line estimates: add TRAFIKLAB_RESROBOT_KEY and refresh for timetable times.</div> }
      @if (j.last_error) { <div class="small text-danger mt-1">{{ j.last_error }}</div> }
      <div class="small text-body-secondary mt-1">Grey zones: no usable answer. Failed routes are never retried on their own; cache older than
        the TTL is marked stale and kept. Policy: {{ j.policy }} (providers.yaml connectivity).</div>
    }
  </ng-template>

  <ng-template #panelTpl>
    @if (zone(); as z) {
      <h6 class="mb-0">{{ z.zone.name }}</h6>
      <div class="small text-body-secondary mb-2">{{ short(z.zone.district) }} · {{ z.zone.kommun }} ·
        <a [routerLink]="['/map/zone', z.zone.id]">Open zone view</a></div>
      @for (g of grouped(z); track g.point) {
        <div class="fh-section mt-2">{{ g.label }}</div>
        @for (r of g.rows; track $index) {
          <div class="d-flex small gap-2"><span class="fh-grow">{{ r.direction === 'to_point' ? 'there' : 'back' }} · {{ r.day_type }} · {{ r.window_label }}</span>
            @if (r.status === 'failed') { <span class="small text-danger" [title]="r.error ?? ''">failed</span> }
            @else { <b>{{ r.minutes == null ? '–' : (r.minutes | number: '1.0-0') + '′' }}</b>@if (r.estimate) {<sup>~</sup>} }</div>
        }
      }
      <hr class="my-3" />
    } @else { <div class="small text-body-secondary mb-3">Click a zone for its minutes per point and time window.</div> }
    <fh-probe-panel />
  </ng-template>
  <fh-connectivity-decision />
  <fh-connectivity-routes />`,
  styles: [`
    .fh-grow { flex: 1; min-width: 0; }
    .fh-counts { display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: .8rem; }
    .fh-c { display: inline-flex; align-items: center; gap: 4px; i { width: 9px; height: 9px; border-radius: 50%; background: var(--c); } }
    .fh-ramp { display: flex; align-items: center; gap: 2px; span:not(.small) { font-size: .7rem; color: #fff; padding: 0 5px; border-radius: 3px; text-shadow: 0 1px 1px #0008; } }
  `],
})
export class ConnectivityMode {
  protected conn = inject(ConnectivityService);
  private state = inject(MapStateService);
  private api = inject(ApiService);
  private layout = inject(LayoutService);
  private viewTpl = viewChild.required<TemplateRef<unknown>>('viewTpl');
  private matrixTpl = viewChild.required<TemplateRef<unknown>>('matrixTpl');
  private panelTpl = viewChild.required<TemplateRef<unknown>>('panelTpl');
  protected readonly ramp = RAMP;
  protected readonly idxRamp = IDX_RAMP;
  protected readonly colours = STATUS_COLOURS;
  protected readonly statuses: RouteStatus[] = ['cached', 'stale', 'estimated', 'failed', 'pending', 'missing'];
  protected readonly main = 'missing,estimates';
  protected readonly actions = Object.entries(SCOPE_LABELS).map(([key, label]) => ({ key, label, scope: key.split(',') as ConnectivityScope[] }));
  protected readonly help: Record<RouteStatus, string> = {
    cached: 'answered by the provider, younger than the cache TTL', stale: 'answered, older than the TTL; kept until "Update stale"',
    estimated: 'straight-line estimate', failed: 'the provider could not answer; see the route list',
    pending: 'queued in the running refresh', missing: 'not computed yet',
  };
  protected zone = signal<ZoneCommute | null>(null);

  constructor() {
    const destroy = inject(DestroyRef);
    this.conn.load();
    effect(() => {
      const map = this.state.map();
      if (!map) return;
      untracked(() => {
        this.conn.addFill();
        map.on('click', 'conn-fill', this.onZoneClick);
      });
    });
    effect(() => {                                        // a route list row: fly to the zone and show its rows
      const f = this.conn.focus();
      const map = this.state.map();
      if (!f || !map) return;
      untracked(() => {
        map.flyTo({ center: [f.lon, f.lat], zoom: Math.max(map.getZoom(), 13), duration: 900 });
        this.api.connectivityZone(f.zone_id).subscribe({ next: (z) => this.zone.set(z), error: () => this.zone.set(null) });
        this.conn.focus.set(null);
      });
    });
    destroy.onDestroy(() => {
      this.state.map()?.off('click', 'conn-fill', this.onZoneClick);
      this.conn.removeFill();
    });
    afterNextRender(() => this.layout.register(destroy, [
      { id: 'conn-view', title: 'View', tpl: this.viewTpl() },
      { id: 'conn-matrix', title: 'Matrix', tpl: this.matrixTpl() },
    ], { title: 'Connectivity', tpl: this.panelTpl() }));
  }

  private onZoneClick = (e: any): void => {
    const id = e.features?.[0]?.properties?.['zone_id'];
    if (id) this.api.connectivityZone(id).subscribe({ next: (z) => this.zone.set(z), error: () => this.zone.set(null) });
  };

  protected stateLabel(j: ConnectivityJob): string {
    if (j.state === 'stopped') return { budget: 'stopped: call budget reached', cancelled: 'cancelled', decision: 'stopped by you', error: 'stopped by an error' }[j.stopped ?? 'error'] ?? 'stopped';
    return { idle: 'idle', running: j.estimating ? 'running (estimates)' : 'running', paused: 'paused: waiting for you', done: 'done' }[j.state] ?? j.state;
  }
  protected cost(key: string): number { return this.conn.plans()[key]?.calls ?? 0; }
  protected enabled(key: string): boolean { const p = this.conn.plans()[key]; return !p || p.calls + p.estimates + p.cached + p.failed_skipped > 0; }
  protected costTitle(key: string): string {
    const p = this.conn.plans()[key];
    if (!p) return '';
    const eta = p.eta_s ? `, about ${Math.round(p.eta_s / 60)} min` : '';
    return `${p.calls} provider calls${eta}; ${p.cached} from cache; ${p.failed_skipped} known failures skipped`
      + (p.calls_over_budget ? `; ${p.calls_over_budget} over the per-run budget (${p.max_calls})` : '');
  }
  protected short(d: string): string { return d.replace(/ stadsdelsområde$/, ''); }
  protected grouped(z: ZoneCommute) {
    const labels = new Map((this.conn.matrix()?.points ?? []).map((p) => [p.id, p.label]));
    const by = new Map<string, ZoneCommute['rows']>();
    for (const r of z.rows) by.set(r.point_id, [...(by.get(r.point_id) ?? []), r]);
    return [...by].map(([point, rows]) => ({ point, label: labels.get(point) ?? point, rows }));
  }
}
