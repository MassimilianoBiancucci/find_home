import { Component, DestroyRef, TemplateRef, afterNextRender, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import type { MapMouseEvent } from 'maplibre-gl';
import { TerraDraw, TerraDrawCircleMode, TerraDrawFreehandMode, TerraDrawPolygonMode } from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import { AreaPiece, AreaReach, AreaResult, AreaState, ConnectivityMinutes, GeoCollection, GeoFeature, TravelPeriod } from '../../models';
import { ApiService, apiError } from '../../services/api.service';
import { LayoutService } from '../../services/layout.service';
import { ZoneGeoStore } from '../../services/zone-geo.store';
import { DEFAULT_REACH, ReachSplit, reachLabel, reachMinutes, reachSplit } from './area-reach';
import { MapStateService } from './map-state.service';
import { ProbePanel } from './probe-panel';

type Tool = 'pan' | 'zones' | 'reach' | 'brush' | 'erase' | 'lasso' | 'circle' | 'polygon';
interface ZoneNode { id: string; name: string; km2: number; }
interface DistrictNode { name: string; zones: ZoneNode[]; }
interface KommunNode { name: string; districts: DistrictNode[]; }

const VIOLET = '#a020e0';
const EMPTY: GeoCollection = { type: 'FeatureCollection', features: [] };

/**
 * Area mode: edit the search area (config/search_area.yaml). Pieces are zone sets (toggle RegSO zones on the map
 * or in the tree) or drawn shapes (brush, lasso, circle, polygon); erasers cut every piece. Saved through the
 * config writer; the server computes the area function, here only previews are drawn. A reach piece is a zone set
 * kept in sync with a rule (the zones within N minutes of transit from a point or the weighted mix, in one travel
 * period), read from the Connectivity matrix through GET /api/connectivity/minutes.
 */
@Component({
  selector: 'fh-area-mode',
  imports: [FormsModule, DecimalPipe, NgTemplateOutlet, ProbePanel],
  styles: [`
    .fh-tools { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
    .fh-tool { font-size: .78rem; padding: 4px 2px; border-radius: 6px; border: 1px solid var(--bs-border-color); background: transparent;
      color: var(--bs-body-color); &.on { border-color: var(--fh-violet); background: var(--fh-violet-soft); color: var(--fh-violet); font-weight: 600; } }
    .fh-piece { border: 1px solid var(--bs-border-color); border-radius: 6px; padding: 6px 8px; margin-bottom: 6px; cursor: pointer;
      &.on { border-color: var(--fh-violet); box-shadow: inset 3px 0 0 var(--fh-violet); }
      label.d-flex { white-space: nowrap; } .form-range { flex: 1; min-width: 0; } }
    .fh-tree { max-height: 340px; overflow-y: auto; font-size: .82rem; }
    .fh-tree details { margin-left: 4px; } .fh-tree summary { cursor: pointer; padding: 1px 0; }
    .fh-tree label { display: flex; gap: 6px; align-items: center; padding: 1px 0 1px 14px; }
    .fh-bar { height: 6px; border-radius: 3px; background: var(--fh-violet); }
    .fh-dirty { color: var(--fh-amber); font-weight: 600; }
    .fh-reach { margin-top: 6px; padding-top: 6px; border-top: 1px dashed var(--bs-border-color); cursor: default;
      .fh-hlabel { font-size: .66rem; text-transform: uppercase; letter-spacing: .06em; color: var(--bs-secondary-color); margin: 6px 0 2px; }
      .fh-reach-min { font-size: 1.05rem; font-weight: 800; color: var(--fh-violet); text-transform: none; letter-spacing: 0; }
      .fh-chips { margin-top: 2px; } }
    .fh-reach-tool { margin: 6px 0 8px; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--fh-violet-soft);
      background: linear-gradient(135deg, color-mix(in srgb, #ff6ad5 8%, transparent), color-mix(in srgb, #6a5cff 8%, transparent)); }
  `],
  template: `
  <ng-template #toolsTpl>
    <div class="fh-tools mb-2">
      @for (t of tools; track t.id) {
        <button class="fh-tool" [class.on]="tool() === t.id" [title]="t.hint" (click)="setTool(t.id)">{{ t.label }}</button>
      }
    </div>
    @if (tool() === 'reach') {
      <div class="fh-reach-tool">
        <div class="small mb-2">Select the zones you reach by transit within a number of minutes, from one of your points or
          the weighted mix, in a travel period (the Connectivity matrix). Set the rule on the piece in <b>Area pieces</b>.</div>
        <button type="button" class="fh-btn-glow" (click)="addReach()">＋ Reach piece</button>
      </div>
    }
    @if (tool() === 'brush' || tool() === 'erase') {
      <label class="small d-block">Brush radius {{ radius() }} m
        <input type="range" class="form-range" min="50" max="1500" step="50" [ngModel]="radius()" (ngModelChange)="radius.set(+$event)" /></label>
    }
    <label class="small d-block">New piece weight {{ newWeight() | number: '1.1-1' }}
      <input type="range" class="form-range" min="0.1" max="1" step="0.1" [ngModel]="newWeight()" (ngModelChange)="newWeight.set(+$event)" /></label>
    @if (tool() !== 'reach') { <div class="small text-body-secondary">{{ toolHint() }}</div> }
  </ng-template>

  <ng-template #piecesTpl>
    <div class="fh-row mb-2"><span class="fh-grow small">Buffer outside the area</span>
      <input type="number" class="form-control form-control-sm" style="width:90px" min="0" step="100" [ngModel]="buffer()" (ngModelChange)="buffer.set(+$event); dirty.set(true)" /> m</div>
    @for (p of pieces(); track p.id) {
      <div class="fh-piece" [class.on]="p.id === selected()" (click)="selected.set(p.id)">
        <div class="fh-row">
          <span class="fh-swatch" [style.background]="p.kind === 'eraser' ? '#e53e3e' : violet" [style.opacity]="p.kind === 'eraser' ? 1 : 0.3 + 0.7 * (p.weight ?? 1)"></span>
          <input class="form-control form-control-sm fh-grow" [ngModel]="p.label ?? p.id" (ngModelChange)="update(p, { label: $event })" (click)="$event.stopPropagation()" />
          <input type="checkbox" class="form-check-input" title="Show on map" [checked]="p.visible !== false" (change)="update(p, { visible: p.visible === false })" (click)="$event.stopPropagation()" />
          <button class="btn btn-sm btn-link text-danger p-0" title="Delete piece" (click)="remove(p); $event.stopPropagation()">✕</button>
        </div>
        <div class="small text-body-secondary">{{ p.kind === 'zones' ? (p.zones?.length ?? 0) + ' zones' : p.kind === 'eraser' ? 'eraser' : (p.source ?? 'shape') }}
          @if (p.reach) { · reach {{ label(p.reach) }} }</div>
        @if (p.kind !== 'eraser') {
          <label class="small d-flex gap-2 align-items-center">weight {{ p.weight ?? 1 | number: '1.1-1' }}
            <input type="range" class="form-range" min="0.1" max="1" step="0.1" [ngModel]="p.weight ?? 1" (ngModelChange)="update(p, { weight: +$event })" (click)="$event.stopPropagation()" /></label>
        }
        @if (p.reach; as r) { <ng-container [ngTemplateOutlet]="reachTpl" [ngTemplateOutletContext]="{ p, r }" /> }
      </div>
    } @empty { <div class="small text-body-secondary mb-2">No pieces yet: toggle zones or draw a shape.</div> }
    <div class="d-flex gap-2 align-items-center">
      <button class="btn btn-sm btn-primary" [disabled]="!dirty()" (click)="save()">Save area</button>
      <button class="btn btn-sm btn-outline-secondary" [disabled]="!dirty()" (click)="load()">Discard</button>
      @if (dirty()) { <span class="small fh-dirty">unsaved</span> }
    </div>
  </ng-template>

  <ng-template #reachTpl let-p="p" let-r="r">
    @let per = period(r.window);
    <div class="fh-reach" (click)="$event.stopPropagation()">
      <div class="fh-hlabel">From</div>
      <div class="fh-chips">
        <button type="button" class="fh-chipf t-violet" [class.sel]="r.from === 'weighted'" (click)="setReach(p, { from: 'weighted' })"
          title="The mix of your points, weighted as in the commute score"><i class="fh-chipf-dot"></i><span class="fh-chipf-t">All my points</span></button>
        @for (pt of reachPoints(); track pt.id) {
          <button type="button" class="fh-chipf t-violet" [class.sel]="r.from === pt.id" [disabled]="!!per && !per.points.includes(pt.id)"
            [title]="per && !per.points.includes(pt.id) ? 'Not timed in this travel period' : pt.label" (click)="setReach(p, { from: pt.id })">
            <i class="fh-chipf-dot" [style.background]="pt.color" [style.box-shadow]="'0 0 5px ' + (pt.color ?? '')"></i><span class="fh-chipf-t">{{ pt.label }}</span></button>
        }
      </div>
      <div class="fh-hlabel">Travel period</div>
      <select class="form-select form-select-sm" [ngModel]="r.window ?? ''" (ngModelChange)="setReach(p, { window: $event || undefined })">
        <option value="">Every period, weighted</option>
        @for (w of reachPeriods(); track w.key) { <option [value]="w.key">{{ w.label }} ({{ pointNames(w) }})</option> }
      </select>
      <div class="fh-hlabel">Within <span class="fh-reach-min">{{ r.max_min }} min</span></div>
      <input type="range" class="form-range" min="5" max="120" step="5" [ngModel]="r.max_min" (ngModelChange)="setReach(p, { max_min: +$event })" />
      <label class="form-check form-switch small mb-1" title="Use only timetable answers: zones with only straight-line estimates count as no data">
        <input type="checkbox" class="form-check-input" [checked]="!!r.exclude_estimates" (change)="setReach(p, { exclude_estimates: !r.exclude_estimates })" />
        <span class="form-check-label">Exclude estimates</span></label>
      @if (reachStats()[p.id]; as st) {
        <div class="fh-chips">
          <span class="fh-chipf t-yes sel" title="In the piece"><span class="fh-chipf-t">{{ st.inside.length }} within</span></span>
          <span class="fh-chipf t-no" title="Farther than the limit: left out"><span class="fh-chipf-t">{{ st.outside.length }} farther</span></span>
          @if (st.noData.length) { <span class="fh-chipf t-unknown" title="No minutes in the Connectivity matrix: left out (refresh it in Map → Connectivity)">
            <span class="fh-chipf-t">{{ st.noData.length }} no data</span></span> }
        </div>
        @if (drift(p, st); as n) {
          <div class="small fh-dirty mt-1">The matrix changed: {{ n }} zones differ.
            <button type="button" class="btn btn-link btn-sm p-0 align-baseline" (click)="reapply(p)">Re-apply</button></div>
        }
        <div class="d-flex mt-2">
          <button type="button" class="fh-btn-ghost" [class.disabled]="!trimCount(p, st)" [disabled]="!trimCount(p, st)" (click)="trimOthers(st)"
            title="Untick the zones farther than the limit in your other zone pieces">Trim other pieces ({{ trimCount(p, st) }})</button>
        </div>
      } @else { <div class="small text-body-secondary mt-1">Loading the minutes…</div> }
    </div>
  </ng-template>

  <ng-template #zonesTpl>
    <div class="d-flex gap-2 mb-2">
      <button class="btn btn-sm btn-outline-primary" [disabled]="!allZones().length || allOn(allZones())" (click)="selectAll()"
        title="Put every mapped zone in the search area, then click zones on the map (Zones tool) or untick them here to remove the unwanted ones">
        Select all {{ allZones().length }} zones</button>
      <button class="btn btn-sm btn-outline-secondary" [disabled]="!zoneOn().size" (click)="clearAll()" title="Remove every zone from the zone pieces">Clear zones</button>
    </div>
    <input class="form-control form-control-sm mb-2" placeholder="Search zones" [ngModel]="query()" (ngModelChange)="query.set($event)" />
    <div class="fh-tree">
      @for (k of tree(); track k.name) {
        <details [open]="!!query()">
          <summary><input type="checkbox" class="form-check-input me-1" [checked]="allOn(kZones(k))" [indeterminate]="someOn(kZones(k))"
            (click)="$event.stopPropagation()" (change)="toggleMany(kZones(k))" />{{ k.name }} <span class="text-body-secondary">{{ kZones(k).length }}</span></summary>
          @for (d of k.districts; track d.name) {
            @if (k.districts.length > 1) {
              <details [open]="!!query()" class="ms-2">
                <summary><input type="checkbox" class="form-check-input me-1" [checked]="allOn(d.zones)" [indeterminate]="someOn(d.zones)"
                  (click)="$event.stopPropagation()" (change)="toggleMany(d.zones)" />{{ short(d.name) }}</summary>
                @for (z of d.zones; track z.id) {
                  <label><input type="checkbox" class="form-check-input" [checked]="zoneOn().has(z.id)" (change)="toggleZone(z.id)" />{{ z.name }}</label>
                }
              </details>
            } @else {
              @for (z of d.zones; track z.id) {
                <label><input type="checkbox" class="form-check-input" [checked]="zoneOn().has(z.id)" (change)="toggleZone(z.id)" />{{ z.name }}</label>
              }
            }
          }
        </details>
      }
    </div>
  </ng-template>

  <ng-template #panelTpl>
    @if (error()) { <div class="alert alert-danger py-1 small" style="white-space:pre-wrap">{{ error() }}</div> }
    @if (info()) { <div class="alert alert-success py-1 small">{{ info() }}</div> }
    @if (saved(); as s) {
      <div class="fh-section">Saved area</div>
      <dl class="fh-kv mb-2">
        <dt>Size</dt><dd>{{ s.area_km2 }} km²</dd>
        <dt>Buffer</dt><dd>{{ s.buffer_m }} m</dd>
        <dt>Listings</dt><dd>{{ s.listings.inside }} inside · {{ s.listings.near }} near · {{ s.listings.outside }} outside
          @if (s.listings.unknown) { · {{ s.listings.unknown }} no coords }</dd>
      </dl>
      @if (s.missing_zones.length) { <div class="small text-warning">Unknown zones: {{ s.missing_zones.join(', ') }} (rebuild: findhome geo fetch zones)</div> }
    }
    @if (hovered(); as z) {
      <div class="fh-section mt-3">Zone</div>
      <div><b>{{ z.name }}</b> <span class="text-body-secondary small">{{ z.id }}</span></div>
      <div class="small text-body-secondary">{{ short(z.district) }} · {{ z.kommun }} · {{ z.km2 }} km²</div>
      @if (hoverReach(); as h) { <div class="small mt-1">Reach: <b>{{ h }}</b></div> }
    }
    @if (probe(); as r) {
      <div class="fh-section mt-3">{{ probeLabel() }}</div>
      @if (r.score === null) { <div class="small text-body-secondary">No saved area yet.</div> }
      @else {
        <div>{{ r.inside ? 'Inside' : r.distance_m + ' m outside' }} · score <b>{{ r.score | number: '1.2-2' }}</b>
          @if (r.score === 0) { <span class="badge text-bg-danger ms-1">outside_search_area</span> }</div>
        @if (r.zone) { <div class="small text-body-secondary">{{ r.zone.name }} · {{ short(r.zone.district) }}</div> }
        @for (c of r.contributions; track c.piece) {
          <div class="small mt-1">{{ c.label }} ×{{ c.weight }} · {{ c.distance_m ? c.distance_m + ' m' : 'inside' }} → {{ c.value | number: '1.2-2' }}</div>
          <div class="fh-bar" [style.width.%]="c.value * 100" [style.opacity]="c.piece === r.best_piece ? 1 : 0.4"></div>
        }
      }
    } @else { <div class="small text-body-secondary mt-3">Click a listing to see how the saved area scores it.</div> }
    <hr class="my-3" />
    <fh-probe-panel />
  </ng-template>`,
})
export class AreaMode {
  private api = inject(ApiService);
  private layout = inject(LayoutService);
  private state = inject(MapStateService);
  private geo = inject(ZoneGeoStore);
  private toolsTpl = viewChild.required<TemplateRef<unknown>>('toolsTpl');
  private piecesTpl = viewChild.required<TemplateRef<unknown>>('piecesTpl');
  private zonesTpl = viewChild.required<TemplateRef<unknown>>('zonesTpl');
  private panelTpl = viewChild.required<TemplateRef<unknown>>('panelTpl');
  protected readonly violet = VIOLET;
  protected readonly tools: { id: Tool; label: string; hint: string }[] = [
    { id: 'pan', label: 'Pan', hint: 'Move the map; click listings to inspect them' },
    { id: 'zones', label: 'Zones', hint: 'Click zones on the map to add or remove them' },
    { id: 'reach', label: 'Reach', hint: 'Select the zones within a travel time of your points' },
    { id: 'brush', label: 'Brush', hint: 'Paint an area' }, { id: 'erase', label: 'Erase', hint: 'Paint an eraser that cuts every piece' },
    { id: 'lasso', label: 'Lasso', hint: 'Draw freehand: press, drag, release' }, { id: 'circle', label: 'Circle', hint: 'Click the centre, then the radius' },
    { id: 'polygon', label: 'Polygon', hint: 'Click corners, click the first one to close' },
  ];
  protected tool = signal<Tool>('pan');
  protected radius = signal(300);
  protected newWeight = signal(1);
  protected buffer = signal(1500);
  protected pieces = signal<AreaPiece[]>([]);
  protected selected = signal<string | null>(null);
  protected dirty = signal(false);
  protected saved = signal<AreaState | null>(null);
  protected zones = signal<GeoFeature[]>([]);
  protected query = signal('');
  protected hovered = signal<{ id: string; name: string; district: string; kommun: string; km2: number } | null>(null);
  protected probe = signal<AreaResult | null>(null);
  protected probeLabel = signal('');
  protected error = signal('');
  protected info = signal('');
  /** Connectivity minutes per travel period ('' = every period, weighted), loaded on demand for reach pieces. */
  protected minutes = signal<Record<string, ConnectivityMinutes>>({});
  private loadingMinutes = new Set<string>();
  private pendingReach = new Set<string>();             // reach pieces whose zones wait for their minutes
  private draw?: TerraDraw;
  private stroke: [number, number][] = [];

  private anyMinutes = computed(() => this.minutes()[''] ?? Object.values(this.minutes())[0] ?? null);
  protected reachPoints = computed(() => this.anyMinutes()?.points ?? []);
  protected reachPeriods = computed(() => this.anyMinutes()?.periods ?? []);
  /** Per reach piece: how its rule splits the zones today (null while its minutes load). */
  protected reachStats = computed<Record<string, ReachSplit | null>>(() => {
    const ids = this.allZones().map((z) => z.id);
    const all = this.minutes();
    return Object.fromEntries(this.pieces().filter((p) => p.reach).map((p) => {
      const data = all[p.reach!.window ?? ''];
      return [p.id, data && ids.length ? reachSplit(ids, data, p.reach!) : null];
    }));
  });
  /** The hovered zone's minutes under the selected reach piece's rule. */
  protected hoverReach = computed(() => {
    const p = this.pieces().find((x) => x.id === this.selected() && x.reach);
    const z = this.hovered();
    const data = p && this.minutes()[p.reach!.window ?? ''];
    if (!p || !z || !data) return '';
    const m = reachMinutes(data, p.reach!, z.id);
    return m == null ? 'no data' : `${Math.round(m)} min (limit ${p.reach!.max_min})`;
  });
  protected toolHint = computed(() => this.tools.find((t) => t.id === this.tool())?.hint ?? '');
  protected zoneOn = computed(() => new Set(this.pieces().filter((p) => p.kind === 'zones').flatMap((p) => p.zones ?? [])));
  protected tree = computed<KommunNode[]>(() => {
    const q = this.query().trim().toLowerCase();
    const by = new Map<string, Map<string, ZoneNode[]>>();
    for (const f of this.zones()) {
      const p = f.properties;
      if (q && !String(p['name']).toLowerCase().includes(q) && !String(p['district']).toLowerCase().includes(q)) continue;
      const k = by.get(p['kommun']) ?? new Map<string, ZoneNode[]>();
      by.set(p['kommun'], k);
      const list = k.get(p['district']) ?? [];
      k.set(p['district'], list);
      list.push({ id: p['zone_id'], name: p['name'], km2: p['area_km2'] });
    }
    return [...by].map(([name, ds]) => ({ name, districts: [...ds].map(([dn, zs]) => ({ name: dn, zones: zs })) }));
  });

  constructor() {
    const destroy = inject(DestroyRef);
    afterNextRender(() => {
      this.layout.register(destroy, [
        { id: 'area-tools', title: 'Tools', tpl: this.toolsTpl() },
        { id: 'area-pieces', title: 'Area pieces', tpl: this.piecesTpl() },
        { id: 'area-zones', title: 'Zones', tpl: this.zonesTpl() },
      ], { title: 'Area', tpl: this.panelTpl() });
      this.load();
      this.api.geoZones().subscribe({ next: (fc) => { this.zones.set(fc.features); this.applyPendingReach(); this.paint(); }, error: (e) => this.error.set(apiError(e)) });
    });
    effect(() => {
      const map = this.state.map();
      this.state.styleReady();
      if (map && this.state.ready()) untracked(() => this.setupMap());
    });
    effect(() => {
      const sel = this.state.selection();
      if (sel?.kind === 'listing' || sel?.kind === 'point') untracked(() => this.evalSelection(sel.props, sel.kind));
    });
    destroy.onDestroy(() => this.teardown());
  }

  // ── data ───────────────────────────────────────────────
  load(): void {
    this.api.area().subscribe({
      next: (a) => {
        this.saved.set(a);
        this.pieces.set(structuredClone(a.pieces));
        this.buffer.set(a.buffer_m);
        this.dirty.set(false);
        if (!this.selected() || !a.pieces.some((p) => p.id === this.selected())) this.selected.set(a.pieces[0]?.id ?? null);
        for (const p of a.pieces) if (p.reach) this.ensureMinutes(p.reach.window ?? '');
        this.paint();
      },
      error: (e) => this.error.set(apiError(e)),
    });
  }

  save(): void {
    const pieces = this.pieces().map((p) => {
      const c: any = { ...p };
      if (c.kind !== 'zones') delete c.zones;
      if (c.kind === 'zones') delete c.geometry;
      if (c.visible !== false) delete c.visible;
      return c;
    });
    this.api.patchConfig('search_area', [{ op: 'replace', path: '/buffer_m', value: this.buffer() }, { op: 'replace', path: '/pieces', value: pieces }])
      .subscribe({
        next: (r) => { this.info.set(`Area saved · config ${r.config_hash.slice(0, 7)} · recompute scores to apply it`); this.error.set(''); this.load(); this.geo.reloadRegion(); },
        error: (e) => this.error.set(apiError(e)),
      });
  }

  protected update(p: AreaPiece, patch: Partial<AreaPiece>): void {
    this.pieces.update((ps) => ps.map((x) => (x.id === p.id ? { ...x, ...patch } : x)));
    this.dirty.set(true);
    this.paint();
  }

  protected remove(p: AreaPiece): void {
    this.pieces.update((ps) => ps.filter((x) => x.id !== p.id));
    if (this.selected() === p.id) this.selected.set(this.pieces()[0]?.id ?? null);
    this.dirty.set(true);
    this.paint();
  }

  private newId(prefix: string): string {
    const ids = new Set(this.pieces().map((p) => p.id));
    let i = 1;
    while (ids.has(`${prefix}-${i}`)) i++;
    return `${prefix}-${i}`;
  }

  private addPiece(p: AreaPiece): void {
    this.pieces.update((ps) => [...ps, p]);
    this.selected.set(p.id);
    this.dirty.set(true);
    this.paint();
  }

  /** The zones piece that toggles act on: the selected one if it is a manual zones piece, else the first, else a new one. */
  private zonePiece(): AreaPiece {
    const ps = this.pieces();
    const manual = (p: AreaPiece) => p.kind === 'zones' && !p.reach;      // a reach piece follows its rule, not clicks
    const sel = ps.find((p) => p.id === this.selected() && manual(p)) ?? ps.find(manual);
    if (sel) return sel;
    const created: AreaPiece = { id: this.newId('zones'), label: 'Zones', kind: 'zones', source: 'zones', weight: this.newWeight(), zones: [] };
    this.addPiece(created);
    return created;
  }

  protected toggleZone(id: string): void {
    const on = this.zoneOn().has(id);
    if (on) {
      this.pieces.update((ps) => ps.map((p) => (p.kind === 'zones' && p.zones?.includes(id) ? { ...p, zones: p.zones.filter((z) => z !== id) } : p)));
    } else {
      const target = this.zonePiece();
      this.pieces.update((ps) => ps.map((p) => (p.id === target.id ? { ...p, zones: [...(p.zones ?? []), id] } : p)));
    }
    this.dirty.set(true);
    this.paint();
  }

  protected toggleMany(zs: ZoneNode[]): void {
    const ids = zs.map((z) => z.id);
    if (this.allOn(zs)) {
      this.pieces.update((ps) => ps.map((p) => (p.kind === 'zones' ? { ...p, zones: (p.zones ?? []).filter((z) => !ids.includes(z)) } : p)));
    } else {
      const target = this.zonePiece();
      const on = this.zoneOn();
      this.pieces.update((ps) => ps.map((p) => (p.id === target.id ? { ...p, zones: [...(p.zones ?? []), ...ids.filter((z) => !on.has(z))] } : p)));
    }
    this.dirty.set(true);
    this.paint();
  }

  /** Every mapped zone (not filtered by the search box). */
  protected allZones = computed<ZoneNode[]>(() => this.zones().map((f) => {
    const p: any = f.properties;
    return { id: p['zone_id'], name: p['name'], km2: p['area_km2'] };
  }));
  /** Add every zone to the zone piece, and switch to the Zones tool so a click on the map removes one. */
  protected selectAll(): void {
    const zs = this.allZones();
    if (!zs.length || this.allOn(zs)) return;
    this.toggleMany(zs);
    this.setTool('zones');
  }
  protected clearAll(): void {
    const on = this.allZones().filter((z) => this.zoneOn().has(z.id));
    if (on.length) this.toggleMany(on);
  }
  protected allOn(zs: ZoneNode[]): boolean { return zs.length > 0 && zs.every((z) => this.zoneOn().has(z.id)); }
  protected someOn(zs: ZoneNode[]): boolean { return !this.allOn(zs) && zs.some((z) => this.zoneOn().has(z.id)); }
  protected kZones(k: KommunNode): ZoneNode[] { return k.districts.flatMap((d) => d.zones); }
  protected short(name: string): string { return name.replace(/s? stadsdelsområde$/, ''); }

  // ── reach pieces ───────────────────────────────────────
  protected addReach(): void {
    const id = this.newId('reach');
    this.addPiece({ id, label: 'Reach', kind: 'zones', source: 'reach', weight: this.newWeight(), zones: [], reach: { ...DEFAULT_REACH } });
    this.reapply(this.pieces().find((p) => p.id === id)!);
  }

  protected setReach(p: AreaPiece, patch: Partial<AreaReach>): void {
    const reach: AreaReach = { ...(p.reach ?? DEFAULT_REACH), ...patch };
    if (!reach.window) delete reach.window;
    if (!reach.exclude_estimates) delete reach.exclude_estimates;
    const per = this.period(reach.window);
    if (per && reach.from !== 'weighted' && !per.points.includes(reach.from)) reach.from = 'weighted';   // not timed then
    this.update(p, { reach });
    this.reapply({ ...p, reach });
  }

  /** Recompute a reach piece's zones from its rule (once its minutes are loaded). */
  protected reapply(p: AreaPiece): void {
    this.pendingReach.add(p.id);
    this.ensureMinutes(p.reach?.window ?? '');
    this.applyPendingReach();
  }

  private ensureMinutes(w: string): void {
    if (this.minutes()[w] || this.loadingMinutes.has(w)) return;
    this.loadingMinutes.add(w);
    this.api.connectivityMinutes(w || undefined).subscribe({
      next: (m) => { this.loadingMinutes.delete(w); this.minutes.update((all) => ({ ...all, [w]: m })); this.applyPendingReach(); },
      error: (e) => { this.loadingMinutes.delete(w); this.error.set(apiError(e)); },
    });
  }

  private applyPendingReach(): void {
    const ids = this.allZones().map((z) => z.id);
    if (!ids.length) return;                              // the zones are not loaded yet: called again when they are
    for (const id of [...this.pendingReach]) {
      const p = this.pieces().find((x) => x.id === id);
      const data = p?.reach && this.minutes()[p.reach.window ?? ''];
      if (p?.reach && !data) continue;
      this.pendingReach.delete(id);
      if (p?.reach && data) this.update(p, { zones: reachSplit(ids, data, p.reach).inside });
    }
  }

  /** Zones the rule puts in but the saved piece lacks, or the other way round (the matrix changed since). */
  protected drift(p: AreaPiece, st: ReachSplit): number {
    const have = new Set(p.zones ?? []);
    const want = new Set(st.inside);
    return [...want].filter((z) => !have.has(z)).length + [...have].filter((z) => !want.has(z)).length;
  }

  /** Zones of the manual zone pieces that are farther than the reach limit. */
  protected trimCount(p: AreaPiece, st: ReachSplit): number {
    const far = new Set(st.outside);
    return new Set(this.pieces().filter((x) => x.kind === 'zones' && !x.reach && x.id !== p.id).flatMap((x) => (x.zones ?? []).filter((z) => far.has(z)))).size;
  }

  /** Untick the zones farther than the reach limit in every manual zone piece. */
  protected trimOthers(st: ReachSplit): void {
    const far = new Set(st.outside);
    this.pieces.update((ps) => ps.map((x) => (x.kind === 'zones' && !x.reach ? { ...x, zones: (x.zones ?? []).filter((z) => !far.has(z)) } : x)));
    this.dirty.set(true);
    this.paint();
  }

  protected period(key: string | undefined): TravelPeriod | null { return key ? this.reachPeriods().find((w) => w.key === key) ?? null : null; }
  protected pointNames(w: TravelPeriod): string {
    const names = new Map(this.reachPoints().map((p) => [p.id, p.label]));
    return w.points.map((id) => names.get(id) ?? id).join(', ');
  }
  protected label(r: AreaReach): string { return reachLabel(r, this.reachPoints()); }

  private evalSelection(props: Record<string, any>, kind: string): void {
    const lat = Number(props['lat']), lon = Number(props['lon']);
    if (isNaN(lat) || isNaN(lon)) return;
    this.probeLabel.set(kind === 'listing' ? `Listing ${props['short_id']}` : String(props['label'] ?? 'Point'));
    this.api.areaEval([{ lat, lon }]).subscribe({ next: (r) => this.probe.set(r.items[0]), error: (e) => this.error.set(apiError(e)) });
  }

  // ── map ────────────────────────────────────────────────
  private bound = false;

  private setupMap(): void {
    const map = this.state.map()!;
    this.state.addGroup({
      id: 'area-zones', below: 'listings',
      sources: { 'area-zones': { type: 'geojson', data: EMPTY as any, promoteId: 'zone_id' } },
      layers: (style) => [
        { id: 'area-zones-fill', type: 'fill', source: 'area-zones',
          paint: { 'fill-color': VIOLET, 'fill-opacity': ['case', ['>', ['get', 'w'], 0], ['+', 0.08, ['*', 0.3, ['get', 'w']]], 0.02] } },
        { id: 'area-zones-line', type: 'line', source: 'area-zones',
          paint: { 'line-color': ['case', ['>', ['get', 'w'], 0], '#c084fc', '#8888a0'], 'line-width': ['case', ['>', ['get', 'w'], 0], 1.4, 0.6], 'line-opacity': 0.8 } },
        ...(style.glyphs ? [{ id: 'area-zones-label', type: 'symbol', source: 'area-zones', minzoom: 12,
          layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 11 },
          paint: { 'text-color': '#e8e8f0', 'text-halo-color': '#18181c', 'text-halo-width': 1.2, 'text-opacity': 0.85 } } as any] : []),
      ],
    });
    this.state.addGroup({
      id: 'area-shapes', below: 'listings',
      sources: { 'area-shapes': { type: 'geojson', data: EMPTY as any } },
      layers: [
        { id: 'area-shapes-fill', type: 'fill', source: 'area-shapes',
          paint: { 'fill-color': ['case', ['==', ['get', 'kind'], 'eraser'], '#e53e3e', VIOLET], 'fill-opacity': ['case', ['==', ['get', 'kind'], 'eraser'], 0.3, ['+', 0.15, ['*', 0.35, ['get', 'w']]]] } },
        { id: 'area-shapes-line', type: 'line', source: 'area-shapes',
          paint: { 'line-color': ['case', ['==', ['get', 'kind'], 'eraser'], '#ff6b6b', ['case', ['get', 'sel'], '#ffffff', '#c084fc']],
            'line-width': ['case', ['get', 'sel'], 2.5, 1.5], 'line-dasharray': [2, 1] } },
      ],
    });
    this.state.addGroup({
      id: 'area-outline', below: 'listings',
      sources: { 'area-outline': { type: 'geojson', data: EMPTY as any } },
      layers: [{ id: 'area-outline', type: 'line', source: 'area-outline', paint: { 'line-color': '#ffffff', 'line-width': 2, 'line-opacity': 0.9 } }],
    });
    this.state.addGroup({
      id: 'area-stroke',
      sources: { 'area-stroke': { type: 'geojson', data: EMPTY as any } },
      layers: [{ id: 'area-stroke', type: 'line', source: 'area-stroke',
        layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': VIOLET, 'line-opacity': 0.45, 'line-width': 10 } }],
    });
    this.paint();
    if (!this.bound) {
      this.bound = true;
      map.on('click', 'area-zones-fill', this.onZoneClick);
      map.on('mousemove', 'area-zones-fill', this.onZoneHover);
      map.on('mousedown', this.onDown);
    }
    this.startDraw();
  }

  private teardown(): void {
    const map = this.state.map();
    this.draw?.stop();
    this.draw = undefined;
    if (map) {
      map.off('click', 'area-zones-fill', this.onZoneClick);
      map.off('mousemove', 'area-zones-fill', this.onZoneHover);
      map.off('mousedown', this.onDown);
      map.dragPan.enable();
    }
    for (const g of ['area-zones', 'area-shapes', 'area-outline', 'area-stroke']) this.state.removeGroup(g);
  }

  /** Redraw zone weights, shape pieces and the saved outline from the current draft. */
  private paint(): void {
    const weightOf = new Map<string, number>();
    for (const p of this.pieces()) {
      if (p.kind !== 'zones' || p.visible === false) continue;
      for (const z of p.zones ?? []) weightOf.set(z, Math.max(weightOf.get(z) ?? 0, p.weight ?? 1));
    }
    this.state.setData('area-zones', { type: 'FeatureCollection',
      features: this.zones().map((f) => ({ ...f, properties: { ...f.properties, w: weightOf.get(f.properties['zone_id']) ?? 0 } })) });
    this.state.setData('area-shapes', { type: 'FeatureCollection',
      features: this.pieces().filter((p) => p.kind !== 'zones' && p.geometry && p.visible !== false).map((p) => ({
        type: 'Feature', geometry: p.geometry, properties: { id: p.id, kind: p.kind, w: p.weight ?? 1, sel: p.id === this.selected() } })) });
    const outline = this.saved()?.outline;
    this.state.setData('area-outline', outline ? { type: 'Feature', geometry: outline, properties: {} } : EMPTY);
  }

  private onZoneClick = (e: MapMouseEvent & { features?: any[] }) => {
    if (this.tool() !== 'zones') return;
    const id = e.features?.[0]?.properties?.zone_id;
    if (id) this.toggleZone(id);
  };

  private onZoneHover = (e: MapMouseEvent & { features?: any[] }) => {
    const p = e.features?.[0]?.properties;
    if (p && p.zone_id !== this.hovered()?.id) this.hovered.set({ id: p.zone_id, name: p.name, district: p.district, kommun: p.kommun, km2: p.area_km2 });
  };

  // ── brush and eraser ───────────────────────────────────
  private onDown = (e: MapMouseEvent) => {
    const t = this.tool();
    if (t !== 'brush' && t !== 'erase') return;
    const map = this.state.map()!;
    e.preventDefault();
    this.stroke = [[e.lngLat.lng, e.lngLat.lat]];
    const mpp = 156543.03 * Math.cos((e.lngLat.lat * Math.PI) / 180) / 2 ** map.getZoom();
    map.setPaintProperty('area-stroke', 'line-width', Math.max(2, (2 * this.radius()) / mpp));
    map.setPaintProperty('area-stroke', 'line-color', t === 'erase' ? '#e53e3e' : VIOLET);
    const move = (ev: MapMouseEvent) => {
      this.stroke.push([ev.lngLat.lng, ev.lngLat.lat]);
      this.state.setData('area-stroke', { type: 'Feature', geometry: { type: 'LineString', coordinates: this.stroke }, properties: {} });
    };
    const up = () => {
      map.off('mousemove', move);
      map.off('mouseup', up);
      this.finishStroke(t);
    };
    map.on('mousemove', move);
    map.on('mouseup', up);
  };

  private finishStroke(t: 'brush' | 'erase'): void {
    const stroke = this.stroke;
    this.stroke = [];
    const kind = t === 'erase' ? 'eraser' : 'shape';
    const sel = this.pieces().find((p) => p.id === this.selected());
    const target = sel && sel.kind === kind && (kind === 'eraser' || sel.source === 'brush') ? sel : null;
    this.api.areaBrush({ stroke, radius_m: this.radius(), base: target?.geometry }).subscribe({
      next: (r) => {
        this.state.setData('area-stroke', EMPTY);
        if (!r.geometry) return;
        if (target) this.update(target, { geometry: r.geometry });
        else this.addPiece({ id: this.newId(kind === 'eraser' ? 'erase' : 'brush'), label: kind === 'eraser' ? 'Eraser' : 'Brush',
          kind, source: 'brush', weight: this.newWeight(), geometry: r.geometry });
      },
      error: (e) => { this.state.setData('area-stroke', EMPTY); this.error.set(apiError(e)); },
    });
  }

  // ── lasso, circle, polygon (Terra Draw) ────────────────
  private startDraw(): void {
    const map = this.state.map();
    if (!map) return;
    this.draw?.stop();
    const sty = { fillColor: VIOLET as `#${string}`, outlineColor: '#c084fc' as `#${string}`, fillOpacity: 0.25 };
    this.draw = new TerraDraw({
      adapter: new TerraDrawMapLibreGLAdapter({ map, prefixId: 'fh-td' }),
      modes: [new TerraDrawFreehandMode({ styles: sty }), new TerraDrawCircleMode({ styles: sty }), new TerraDrawPolygonMode({ styles: sty })],
    });
    this.draw.start();
    this.draw.on('finish', (id) => {
      const f = this.draw?.getSnapshotFeature(id);
      this.draw?.removeFeatures([id]);
      if (!f || f.geometry.type !== 'Polygon') return;
      const source = this.tool() === 'lasso' ? 'lasso' : this.tool() === 'circle' ? 'circle' : 'polygon';
      const geometry = { type: 'Polygon', coordinates: (f.geometry.coordinates as number[][][]).map((ring) => ring.map(([x, y]) => [+x.toFixed(6), +y.toFixed(6)])) };
      this.addPiece({ id: this.newId(source), label: source[0].toUpperCase() + source.slice(1), kind: 'shape', source, weight: this.newWeight(), geometry });
    });
    this.setTool(this.tool());
  }

  protected setTool(t: Tool): void {
    this.tool.set(t);
    const map = this.state.map();
    if (!map) return;
    if (t === 'brush' || t === 'erase') map.dragPan.disable(); else map.dragPan.enable();
    map.getCanvas().style.cursor = t === 'pan' ? '' : 'crosshair';
    const mode = t === 'lasso' ? 'freehand' : t === 'circle' ? 'circle' : t === 'polygon' ? 'polygon' : 'static';
    try { this.draw?.setMode(mode); } catch { /* draw not started yet */ }
  }
}
