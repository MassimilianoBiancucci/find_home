import { Component, DestroyRef, TemplateRef, afterNextRender, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ZoneCommute } from '../../models';
import { ApiService } from '../../services/api.service';
import { LayoutService } from '../../services/layout.service';
import { ConnectivityService, RAMP } from './connectivity.service';
import { MapStateService } from './map-state.service';
import { ProbePanel } from './probe-panel';

/** Connectivity mode: zones coloured by commute minutes to your points (one point or the weighted mix). */
@Component({
  selector: 'fh-connectivity-mode',
  imports: [DecimalPipe, ProbePanel],
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
      <div class="fh-ramp mt-2">
        @for (r of ramp; track r[0]; let last = $last) { <span [style.background]="r[1]">{{ r[0] }}{{ last ? '+' : '' }}</span> }
        <span class="small text-body-secondary ms-1">min</span>
      </div>
      <label class="small mt-2 d-block">Opacity
        <input type="range" class="form-range" min="0.15" max="0.9" step="0.05" [value]="conn.opacity()" (input)="conn.setOpacity(+$any($event.target).value)" /></label>
      <div class="small text-body-secondary">Transit, from a point inside each zone, at the middle slot of each window; the weighted mix uses your point weights.</div>
    } @else { <div class="small text-body-secondary">Loading…</div> }
    @if (conn.error()) { <div class="small text-danger">{{ conn.error() }}</div> }
  </ng-template>

  <ng-template #refreshTpl>
    @if (conn.job(); as j) {
      <div class="small">{{ conn.coverage() }} zones · {{ j.running ? 'running' : (j.stopped ?? 'idle') }}</div>
      @if (j.running) {
        <div class="progress my-1" style="height:6px"><div class="progress-bar" [style.width.%]="j.total ? j.done / j.total * 100 : 0"></div></div>
        <div class="small text-body-secondary">{{ j.done }}/{{ j.total }} · {{ j.calls }} calls · {{ j.cached }} cached
          @if (j.eta_s) { · ~{{ (j.eta_s / 60) | number: '1.0-0' }} min left }</div>
        <button class="btn btn-sm btn-outline-danger mt-1" (click)="conn.cancel()">Cancel</button>
      } @else {
        <button class="btn btn-sm btn-outline-primary mt-1" (click)="conn.refresh()">Refresh matrix</button>
      }
      @if (estimates()) { <div class="small text-warning mt-1">Straight-line estimates: add TRAFIKLAB_RESROBOT_KEY and refresh for timetable times.</div> }
      @if (j.last_error) { <div class="small text-danger mt-1">{{ j.last_error }}</div> }
      <div class="small text-body-secondary mt-1">Resumes where it stopped; budget: providers.yaml budget.max_connectivity_calls_per_run.</div>
    }
  </ng-template>

  <ng-template #panelTpl>
    @if (zone(); as z) {
      <h6 class="mb-0">{{ z.zone.name }}</h6>
      <div class="small text-body-secondary mb-2">{{ short(z.zone.district) }} · {{ z.zone.kommun }}</div>
      @for (g of grouped(z); track g.point) {
        <div class="fh-section mt-2">{{ g.label }}</div>
        @for (r of g.rows; track $index) {
          <div class="d-flex small gap-2"><span class="fh-grow">{{ r.direction === 'to_point' ? 'there' : 'back' }} · {{ r.day_type }} · {{ r.window_label }}</span>
            <b>{{ r.minutes == null ? '–' : (r.minutes | number: '1.0-0') + '′' }}</b>@if (r.estimate) {<sup>~</sup>}</div>
        }
      }
      <hr class="my-3" />
    } @else { <div class="small text-body-secondary mb-3">Click a zone for its minutes per point and time window.</div> }
    <fh-probe-panel />
  </ng-template>`,
  styles: [`
    .fh-grow { flex: 1; min-width: 0; }
    .fh-ramp { display: flex; align-items: center; gap: 2px; span:not(.small) { font-size: .7rem; color: #fff; padding: 0 5px; border-radius: 3px; text-shadow: 0 1px 1px #0008; } }
  `],
})
export class ConnectivityMode {
  protected conn = inject(ConnectivityService);
  private state = inject(MapStateService);
  private api = inject(ApiService);
  private layout = inject(LayoutService);
  private viewTpl = viewChild.required<TemplateRef<unknown>>('viewTpl');
  private refreshTpl = viewChild.required<TemplateRef<unknown>>('refreshTpl');
  private panelTpl = viewChild.required<TemplateRef<unknown>>('panelTpl');
  protected readonly ramp = RAMP;
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
    destroy.onDestroy(() => {
      this.state.map()?.off('click', 'conn-fill', this.onZoneClick);
      this.conn.removeFill();
    });
    afterNextRender(() => this.layout.register(destroy, [
      { id: 'conn-view', title: 'View', tpl: this.viewTpl() },
      { id: 'conn-refresh', title: 'Refresh', tpl: this.refreshTpl() },
    ], { title: 'Connectivity', tpl: this.panelTpl() }));
  }

  private onZoneClick = (e: any): void => {
    const id = e.features?.[0]?.properties?.['zone_id'];
    if (id) this.api.connectivityZone(id).subscribe({ next: (z) => this.zone.set(z), error: () => this.zone.set(null) });
  };

  protected estimates(): boolean { const m = this.conn.matrix(); return !!m && Object.values(m.zones).some((z) => z.estimate); }
  protected short(d: string): string { return d.replace(/ stadsdelsområde$/, ''); }
  protected grouped(z: ZoneCommute) {
    const labels = new Map((this.conn.matrix()?.points ?? []).map((p) => [p.id, p.label]));
    const by = new Map<string, ZoneCommute['rows']>();
    for (const r of z.rows) by.set(r.point_id, [...(by.get(r.point_id) ?? []), r]);
    return [...by].map(([point, rows]) => ({ point, label: labels.get(point) ?? point, rows }));
  }
}
