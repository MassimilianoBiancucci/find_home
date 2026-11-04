import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ConnectivityRoute, RouteStatus } from '../../models';
import { ApiService, apiError } from '../../services/api.service';
import { ConnectivityService, STATUS_COLOURS } from './connectivity.service';

const STATUS_ORDER: RouteStatus[] = ['failed', 'missing', 'pending', 'estimated', 'stale', 'cached'];
const PAGE = 100;

/** Shown while a refresh is paused by repeated provider errors: continue, switch to estimates, or stop. */
@Component({
  selector: 'fh-connectivity-decision',
  template: `
  @if (conn.job(); as j) { @if (j.state === 'paused') {
    <div class="modal-backdrop fade show"></div>
    <div class="modal d-block" role="dialog" aria-modal="true" aria-labelledby="fh-dec-title">
      <div class="modal-dialog modal-dialog-centered"><div class="modal-content">
        <div class="modal-header"><h6 class="modal-title" id="fh-dec-title">Connectivity refresh paused</h6></div>
        <div class="modal-body small">
          <p class="mb-2">{{ j.pause_reason }}</p>
          <p class="mb-2">So far: {{ j.done }}/{{ j.total }} routes · {{ j.calls }} calls · {{ j.cached }} from cache ·
            {{ j.failed }} failed · {{ j.estimated }} estimated.</p>
          @if (j.failed_coords.length) {
            <div class="text-body-secondary mb-1">Zone points with no stop nearby (never retried on their own):</div>
            <ul class="mb-2">@for (c of j.failed_coords; track c.zone_id) { <li>{{ c.zone_id }} · {{ c.lat }}, {{ c.lon }} · {{ c.code }}</li> }</ul>
          }
          <p class="mb-2"><b>Continue</b> keeps calling {{ j.provider }}; failed routes stay failed.
            <b>Use estimates</b> fills the remaining routes with straight-line estimates, tagged as such.
            <b>Stop</b> ends the refresh; what was computed is kept.</p>
          <label class="form-check"><input type="checkbox" class="form-check-input" [checked]="remember()" (change)="remember.set(!remember())" />
            <span class="form-check-label">Don't ask again (saved as <code>connectivity.on_provider_failure</code> in providers.yaml)</span></label>
        </div>
        <div class="modal-footer">
          <button class="btn btn-sm btn-outline-danger me-auto" (click)="conn.decide('stop', false)">Stop</button>
          <button class="btn btn-sm btn-outline-primary" (click)="conn.decide('estimate', remember())">Use estimates</button>
          <button class="btn btn-sm btn-primary" (click)="conn.decide('continue', remember())">Continue</button>
        </div>
      </div></div>
    </div>
  } }`,
})
export class ConnectivityDecision {
  protected conn = inject(ConnectivityService);
  protected remember = signal(false);
}

/** Every planned route with its status: filter, page, and jump to a zone. */
@Component({
  selector: 'fh-connectivity-routes',
  imports: [DecimalPipe],
  template: `
  @if (conn.routesOpen()) {
    <div class="modal-backdrop fade show"></div>
    <div class="modal d-block" role="dialog" aria-modal="true" aria-labelledby="fh-routes-title" (keydown.escape)="close()">
      <div class="modal-dialog modal-xl modal-dialog-scrollable"><div class="modal-content">
        <div class="modal-header">
          <h6 class="modal-title" id="fh-routes-title">Connectivity routes</h6>
          <button type="button" class="btn-close" aria-label="Close" (click)="close()"></button>
        </div>
        <div class="modal-body small">
          <div class="d-flex flex-wrap gap-1 mb-2">
            @for (s of statuses; track s) {
              <button class="btn btn-sm fh-chip" [class.fh-on]="wanted().has(s)" [style.--c]="colours[s]" (click)="toggle(s)">
                {{ s }} <span class="fh-n">{{ conn.matrix()?.counts?.[s] ?? 0 }}</span></button>
            }
          </div>
          <div class="d-flex gap-2 mb-2">
            <select class="form-select form-select-sm w-auto" [value]="point()" (change)="setPoint($any($event.target).value)">
              <option value="">All points</option>
              @for (p of conn.matrix()?.points ?? []; track p.id) { <option [value]="p.id">{{ p.label }}</option> }
            </select>
            <input class="form-control form-control-sm" placeholder="Zone name" [value]="q()" (input)="setQ($any($event.target).value)" />
          </div>
          @if (error()) { <div class="text-danger mb-2">{{ error() }}</div> }
          <table class="table table-sm table-hover align-middle mb-2">
            <thead><tr><th>Status</th><th>Zone</th><th>Point</th><th>Trip</th><th class="text-end">Min</th><th>Detail</th></tr></thead>
            <tbody>
              @for (r of items(); track $index) {
                <tr class="fh-click" (click)="open(r)" [title]="'Show ' + r.zone + ' on the map'">
                  <td><span class="fh-tag" [style.--c]="colours[r.status]">{{ r.status }}</span></td>
                  <td>{{ r.zone }}</td>
                  <td>{{ r.point }}</td>
                  <td class="text-nowrap">{{ r.direction === 'to_point' ? 'there' : 'back' }} · {{ r.day_type }} · {{ r.window_label }}</td>
                  <td class="text-end">{{ r.minutes == null ? '–' : (r.minutes | number: '1.0-0') }}</td>
                  <td class="text-body-secondary">{{ r.error ?? (r.fetched_at ? 'answered ' + r.fetched_at.slice(0, 10) : '') }}</td>
                </tr>
              } @empty { <tr><td colspan="6" class="text-body-secondary">No routes match.</td></tr> }
            </tbody>
          </table>
          <div class="d-flex align-items-center gap-2">
            <button class="btn btn-sm btn-outline-secondary" [disabled]="offset() === 0" (click)="page(-1)">Previous</button>
            <span>{{ total() ? offset() + 1 : 0 }}–{{ offset() + items().length }} of {{ total() }}</span>
            <button class="btn btn-sm btn-outline-secondary" [disabled]="offset() + items().length >= total()" (click)="page(1)">Next</button>
          </div>
        </div>
      </div></div>
    </div>
  }`,
  styles: [`
    .fh-chip { border: 1px solid var(--c); color: var(--c); padding: 0 8px; }
    .fh-chip.fh-on { background: var(--c); color: #fff; }
    .fh-n { opacity: .8; margin-left: 2px; }
    .fh-tag { display: inline-block; padding: 0 6px; border-radius: 3px; color: #fff; background: var(--c); font-size: .75rem; }
    .fh-click { cursor: pointer; }
  `],
})
export class ConnectivityRoutesDialog {
  protected conn = inject(ConnectivityService);
  private api = inject(ApiService);
  protected readonly statuses = STATUS_ORDER;
  protected readonly colours = STATUS_COLOURS;
  protected wanted = signal(new Set<RouteStatus>(['failed', 'missing', 'estimated']));
  protected point = signal('');
  protected q = signal('');
  protected offset = signal(0);
  protected items = signal<ConnectivityRoute[]>([]);
  protected total = signal(0);
  protected error = signal('');
  private filters = computed(() => ({ status: [...this.wanted()], point: this.point(), q: this.q(), offset: this.offset() }));

  constructor() {
    effect(() => {
      if (!this.conn.routesOpen()) return;
      const f = this.filters();
      untracked(() => this.api.connectivityRoutes({ ...f, limit: PAGE }).subscribe({
        next: (r) => { this.items.set(r.items); this.total.set(r.total); this.error.set(''); },
        error: (e) => this.error.set(apiError(e)),
      }));
    });
  }

  protected toggle(s: RouteStatus): void {
    const next = new Set(this.wanted());
    if (next.has(s)) next.delete(s); else next.add(s);
    this.wanted.set(next);
    this.offset.set(0);
  }
  protected setPoint(v: string): void { this.point.set(v); this.offset.set(0); }
  protected setQ(v: string): void { this.q.set(v); this.offset.set(0); }
  protected page(dir: 1 | -1): void { this.offset.set(Math.max(0, this.offset() + dir * PAGE)); }
  protected close(): void { this.conn.routesOpen.set(false); }
  protected open(r: ConnectivityRoute): void {
    this.conn.focus.set({ zone_id: r.zone_id, lat: r.lat, lon: r.lon });
    this.close();
  }
}
