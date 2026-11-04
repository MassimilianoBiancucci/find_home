import { Component, DestroyRef, TemplateRef, afterNextRender, computed, effect, inject, untracked, viewChild } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HeatSummary, ZoneLine } from '../../models';
import { LayoutService } from '../../services/layout.service';
import { MapStateService } from './map-state.service';
import { BEYOND, SET_COLOURS, ZoneService } from './zone.service';

const RAILISH = new Set(['metro', 'commuter_rail', 'local_rail', 'tram', 'train']);
const MODE_LABEL: Record<string, string> = { metro: 'Metro', commuter_rail: 'Commuter rail', local_rail: 'Local rail', tram: 'Tram',
  train: 'Train', bus: 'Bus', ferry: 'Ferry', other: 'Other' };

/** Map → Zone: pick a zone, fly into it, and study walking / cycling access to stops and services along the streets. */
@Component({
  selector: 'fh-zone-mode',
  imports: [DecimalPipe, RouterLink],
  template: `
  <ng-template #zoneTpl>
    @if (zone.facts(); as f) {
      <div class="small mb-1"><b>{{ f.zone.name }}</b> · {{ short(f.zone.district) }} · {{ f.zone.kommun }}</div>
      <button class="btn btn-sm btn-outline-secondary mb-2" (click)="pickAnother()">Pick another zone</button>
      <div class="d-flex gap-3 small">
        <label class="form-check"><input type="radio" class="form-check-input" name="zmode" [checked]="zone.mode() === 'walk'" (change)="zone.setMode('walk')" /> Walk</label>
        <label class="form-check"><input type="radio" class="form-check-input" name="zmode" [checked]="zone.mode() === 'bike'" (change)="zone.setMode('bike')" /> Bike</label>
      </div>
      <label class="form-check form-switch small"><input type="checkbox" class="form-check-input" [checked]="zone.neighbours()" (change)="zone.setNeighbours(!zone.neighbours())" />
        <span class="form-check-label">Include the {{ f.neighbours.length }} touching zones</span></label>
    } @else if (zone.selected()) { <div class="small text-body-secondary">Loading…</div> }
    @else { <div class="small">Hover a zone and click it, or right-click the map → <i>Open zone view</i>.</div>
      @if (zone.hoverName()) { <div class="small text-body-secondary mt-1">{{ zone.hoverName() }}</div> } }
    @if (zone.error()) { <div class="small text-danger mt-1">{{ zone.error() }}</div> }
  </ng-template>

  <ng-template #targetsTpl>
    @if (zone.facts(); as f) {
      @for (s of setIds(); track s) {
        <label class="fh-row">
          <input type="checkbox" class="form-check-input" [checked]="zone.sets().includes(s)" (change)="toggleSet(s)" />
          <span class="fh-dot" [style.background]="setColour(s)"></span><span class="fh-grow">{{ f.target_sets[s] }}</span>
          @if (summary(s); as m) { <span class="small text-body-secondary">{{ minutes(m.median_s) }}</span> }
        </label>
      }
      <label class="small mt-2 d-block">Colour streets by
        <select class="form-select form-select-sm" [value]="zone.colourBy()" (change)="zone.setColourBy($any($event.target).value)">
          <option value="t">Nearest of the selected</option>
          @for (s of zone.sets(); track s) { <option [value]="'t_' + s">{{ f.target_sets[s] }}</option> }
        </select></label>
      <div class="fh-legend mt-2">
        @for (l of zone.legend(); track l.label) { <span [style.background]="l.colour">{{ l.label }}</span> }
        <span [style.background]="beyond">+</span><span class="small text-body-secondary ms-1">min</span>
      </div>
      @if (zone.loading()) { <div class="small text-body-secondary mt-1">Computing…</div> }
    }
  </ng-template>

  <ng-template #panelTpl>
    @if (zone.facts(); as f) {
      <h6 class="mb-0">{{ f.zone.name }}</h6>
      <div class="small text-body-secondary mb-2">{{ short(f.zone.district) }} · {{ f.zone.kommun }}@if (f.zone.area_km2) { · {{ f.zone.area_km2 | number: '1.1-1' }} km² }</div>
      @if (zone.heatmap(); as h) {
        <div class="fh-tiles">
          @for (t of tiles(); track t.key) {
            <div class="fh-tile" [style.--c]="t.colour">
              <div class="fh-tile-v">{{ t.value }}</div><div class="fh-tile-l">{{ t.label }}</div>
              @if (t.note) { <div class="fh-tile-n">{{ t.note }}</div> }
            </div>
          }
        </div>
        <div class="small text-body-secondary mt-1">{{ zone.mode() === 'walk' ? 'Walking' : 'Cycling' }} along the streets from
          {{ h.homes }} {{ h.homes_source === 'buildings' ? 'homes (weighted by floors)' : 'street nodes (no buildings data)' }}@if (h.cached) { · cached }.</div>
      } @else if (zone.loading()) { <div class="small text-body-secondary">Computing the heatmap…</div> }

      @if (zone.lines(); as l) {
        @for (g of groups(l.lines); track g.mode) {
          <details class="fh-sec"><summary>{{ g.label }} <span>{{ g.lines.length }}</span></summary>
            @for (ln of g.lines; track ln.id) { <div class="fh-line-row">
              <span class="fh-badge" [style.background]="ln.colour">{{ ln.ref ?? '–' }}</span>
              <span class="fh-grow">{{ ln.stops.join(', ') }}</span>
              @if (ln.peak_per_hour != null) { <span class="small text-body-secondary" title="most departures in one hour at the zone's stops, both directions">{{ ln.peak_per_hour }}/h</span> }
            </div> }
          </details>
        }
        @if (!l.lines.length) { <div class="small text-body-secondary mt-2">No stops inside the zone.</div> }
        @if (l.source === 'osm') { <div class="small text-body-secondary">No timetable (OSM lines only): set TRAFIKLAB_GTFS_KEY and run <code>findhome geo fetch timetable</code>.</div> }
      }
      <details class="fh-sec"><summary>Services in the zone</summary>
        @for (p of poiRows(); track p.key) { <div class="d-flex small"><span class="fh-grow">{{ p.label }}</span><b>{{ p.n }}</b></div> }
      </details>
      @if (zone.lines(); as l) {
        <details class="fh-sec"><summary>Nearby zones: transport and services <span>{{ l.nearby_lines.length }}</span></summary>
          <div class="small text-body-secondary mb-1">@for (n of f.neighbours; track n.id; let last = $last) {
            <a [routerLink]="['/map/zone', n.id]">{{ n.name }}</a>{{ last ? '' : ', ' }} }</div>
          @for (ln of l.nearby_lines; track ln.id) { <div class="fh-line-row">
            <span class="fh-badge" [style.background]="ln.colour">{{ ln.ref ?? '–' }}</span>
            <span class="fh-grow">{{ modeLabel(ln.mode) }} · {{ ln.stops.slice(0, 3).join(', ') }}</span>
            @if (ln.peak_per_hour != null) { <span class="small text-body-secondary">{{ ln.peak_per_hour }}/h</span> }
          </div> }
        </details>
      }
    } @else { <div class="small text-body-secondary">Pick a zone to see its metrics, lines and services.</div> }
  </ng-template>`,
  styles: [`
    .fh-grow { flex: 1; min-width: 0; }
    .fh-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
    .fh-legend { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; span:not(.small) { font-size: .7rem; color: #111; padding: 0 5px; border-radius: 3px; } }
    .fh-tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
    .fh-tile { border-radius: 8px; padding: 6px 8px; background: var(--fh-sub); border-left: 4px solid var(--c); }
    .fh-tile-v { font-size: 1.15rem; font-weight: 700; } .fh-tile-l { font-size: .75rem; } .fh-tile-n { font-size: .7rem; color: var(--bs-secondary-color); }
    .fh-sec { margin-top: 8px; border-top: 1px solid var(--bs-border-color); padding-top: 6px;
      summary { font-weight: 600; font-size: .85rem; cursor: pointer; span { color: var(--bs-secondary-color); font-weight: 400; } } }
    .fh-line-row { display: flex; align-items: center; gap: 6px; font-size: .8rem; margin: 3px 0; }
    .fh-badge { min-width: 30px; text-align: center; border-radius: 4px; color: #fff; font-weight: 700; font-size: .75rem; padding: 0 4px; }
  `],
})
export class ZoneMode {
  protected zone = inject(ZoneService);
  private state = inject(MapStateService);
  private layout = inject(LayoutService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private zoneTpl = viewChild.required<TemplateRef<unknown>>('zoneTpl');
  private targetsTpl = viewChild.required<TemplateRef<unknown>>('targetsTpl');
  private panelTpl = viewChild.required<TemplateRef<unknown>>('panelTpl');
  protected readonly beyond = BEYOND;
  private stopPicker: (() => void) | null = null;
  protected setIds = computed(() => Object.keys(this.zone.facts()?.target_sets ?? {}));
  private params = toSignal(this.route.paramMap);

  constructor() {
    const destroy = inject(DestroyRef);
    effect(() => {                                       // /map/zone/:id → focus that zone (also when :id changes)
      const id = this.params()?.get('id') ?? null;
      const map = this.state.map();
      if (!map || !this.state.styleReady()) return;
      untracked(() => {
        if (id && this.zone.selected() === id) this.zone.restyle();
        else if (id) this.zone.select(id);
        else if (!this.stopPicker) this.stopPicker = this.zone.installPicker((z) => void this.router.navigate(['/map/zone', z]));
      });
    });
    destroy.onDestroy(() => { this.stopPicker?.(); this.zone.leave(); });
    afterNextRender(() => this.layout.register(destroy, [
      { id: 'zone-zone', title: 'Zone', tpl: this.zoneTpl() },
      { id: 'zone-targets', title: 'Heatmap targets', tpl: this.targetsTpl() },
    ], { title: 'Zone', tpl: this.panelTpl() }));
  }

  protected pickAnother(): void { void this.router.navigate(['/map/zone']); }
  protected toggleSet(s: string): void {
    const cur = this.zone.sets();
    const next = cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s];
    if (next.length) this.zone.setSets(next);
  }
  protected setColour(s: string): string { return SET_COLOURS[s] ?? '#8a8aa0'; }
  protected summary(s: string): HeatSummary | null { return this.zone.heatmap()?.summary[s] ?? null; }
  protected minutes(s: number | null): string { return s == null ? 'beyond cutoff' : `${Math.round(s / 60)} min`; }
  protected short(d: string): string { return d.replace(/ stadsdelsområde$/, ''); }
  protected modeLabel(m: string): string { return MODE_LABEL[m] ?? m; }

  /** KPI tiles: median walk per selected set, the share of homes within 5 / 10 minutes of the nearest, lines served. */
  protected tiles = computed(() => {
    const h = this.zone.heatmap(), f = this.zone.facts(), l = this.zone.lines();
    if (!h || !f) return [];
    const out = h.sets.map((s) => {
      const m = h.summary[s];
      return { key: s, colour: SET_COLOURS[s] ?? '#8a8aa0', value: this.minutes(m?.median_s ?? null),
        label: `to ${f.target_sets[s].toLowerCase()}`, note: m ? `90% within ${this.minutes(m.p90_s)} · ${m.targets} nearby` : '' };
    });
    const any = h.summary['any'];
    if (any) {
      out.push({ key: 'le5', colour: '#1a9850', value: `${Math.round(any.share_le_5min * 100)}%`, label: 'homes within 5 min', note: 'of the nearest selected' });
      out.push({ key: 'le10', colour: '#a6d96a', value: `${Math.round(any.share_le_10min * 100)}%`, label: 'homes within 10 min', note: '' });
    }
    if (l) {
      const rail = l.lines.filter((x) => RAILISH.has(x.mode)).length;
      out.push({ key: 'lines', colour: '#0089ca', value: String(l.lines.length), label: 'lines at the zone\'s stops', note: `${rail} rail / metro / tram` });
    }
    return out;
  });

  protected groups(lines: ZoneLine[]): { mode: string; label: string; lines: ZoneLine[] }[] {
    const metro = lines.filter((l) => l.mode === 'metro'), bus = lines.filter((l) => l.mode === 'bus');
    const other = lines.filter((l) => l.mode !== 'metro' && l.mode !== 'bus');
    return [{ mode: 'metro', label: 'Metro lines', lines: metro }, { mode: 'bus', label: 'Bus lines', lines: bus },
      { mode: 'other', label: 'Other transit', lines: other }].filter((g) => g.lines.length);
  }

  protected poiRows(): { key: string; label: string; n: number }[] {
    const f = this.zone.facts();
    if (!f) return [];
    const stops = Object.entries(f.stops_by_mode).map(([k, n]) => ({ key: `s-${k}`, label: `${this.modeLabel(k)} stops`, n }));
    return [...stops, ...Object.entries(f.poi).map(([k, n]) => ({ key: k, label: f.target_sets[k] ?? k, n }))];
  }
}
