import { Component, Injectable, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { InfoButton } from '../../components/info';
import { ConnectivityMatrix, DensityUnit, GeoCollection, IndicesMap, ZoneStats } from '../../models';
import { ApiService, apiError } from '../../services/api.service';
import { TagsStore } from '../../services/tags.store';
import { Classes, Display, FillLayer, RAMPS, RampName, ZoneFillService } from './zone-fill.service';

/** The listing filters of the Explore bar, as sent to GET /api/zone/stats (and kept in the URL as `f_<key>`). */
export interface ListingFilters {
  statuses: string; seen: 'all' | 'active' | 'gone'; active_days: number; scored: 'all' | 'passing' | 'rejected';
  posted_from: string; posted_to: string; first_seen_from: string; first_seen_to: string;
  rent_min: number | null; rent_max: number | null; size_min: number | null; size_max: number | null;
  rooms_min: number | null; rooms_max: number | null; min_n: number;
}
export const NO_FILTERS: ListingFilters = {
  statuses: '', seen: 'all', active_days: 14, scored: 'all', posted_from: '', posted_to: '', first_seen_from: '', first_seen_to: '',
  rent_min: null, rent_max: null, size_min: null, size_max: null, rooms_min: null, rooms_max: null, min_n: 3,
};

interface ViewOption { id: string; label: string; help: string; unit: string; listing?: boolean }
const SET_LABELS: Record<string, string> = { grocery: 'Groceries', pharmacy: 'Pharmacies', gym: 'Gyms', park: 'Parks', vet: 'Vets' };
const UNIT_LABELS: Record<DensityUnit, string> = { per_1000_homes: 'per 1,000 homes', per_km2: 'per km²', count: 'count' };
const LISTING_VIEWS: ViewOption[] = [
  { id: 'lst:n', label: 'Number of listings', help: 'explore.listings', unit: 'listings', listing: true },
  { id: 'lst:per_km2', label: 'Listings per km²', help: 'explore.listings', unit: '/km²', listing: true },
  { id: 'lst:rent_per_m2', label: 'Rent per m² (median)', help: 'explore.listings', unit: 'kr/m²', listing: true },
  { id: 'lst:rent', label: 'Rent (median)', help: 'explore.listings', unit: 'kr', listing: true },
  { id: 'lst:size', label: 'Size (median)', help: 'explore.listings', unit: 'm²', listing: true },
  { id: 'lst:rooms', label: 'Rooms (median)', help: 'explore.listings', unit: 'rok', listing: true },
];

/** Explore's zone heatmaps: which value colours the zones, the listing filters, and the data behind each view. */
@Injectable({ providedIn: 'root' })
export class ExploreHeatService {
  private api = inject(ApiService);
  private fill = inject(ZoneFillService);
  readonly view = signal<string>('');
  readonly poiUnit = signal<DensityUnit>('per_1000_homes');
  readonly filters = signal<ListingFilters>({ ...NO_FILTERS });
  readonly indices = signal<IndicesMap | null>(null);
  readonly matrix = signal<ConnectivityMatrix | null>(null);
  readonly stats = signal<ZoneStats | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');

  readonly options = computed(() => {
    const ix = this.indices(), m = this.matrix();
    const groups: { label: string; help: string; items: ViewOption[] }[] = [
      { label: 'Zone indices', help: 'explore.indices', items: [
        { id: 'idx:transport', label: 'Transport index', help: 'zone.transport', unit: '/100' },
        { id: 'idx:services', label: 'Services index', help: 'zone.services', unit: '/100' },
        { id: 'idx:combined', label: 'Combined score', help: 'zone.combined', unit: '/100' }] },
      { label: 'Services amount', help: 'explore.poi', items: (ix?.density_sets ?? Object.keys(SET_LABELS)).map((s) => (
        { id: `poi:${s}`, label: SET_LABELS[s] ?? s, help: 'explore.poi', unit: UNIT_LABELS[this.poiUnit()] })) },
      { label: 'Commute', help: 'explore.commute', items: [
        { id: 'com:weighted', label: 'All your points (weighted)', help: 'explore.commute', unit: 'min' },
        ...(m?.points ?? []).map((p) => ({ id: `com:${p.id}`, label: p.label, help: 'explore.commute', unit: 'min' }))] },
      { label: 'Listings', help: 'explore.listings', items: LISTING_VIEWS },
    ];
    return groups;
  });
  readonly current = computed(() => this.options().flatMap((g) => g.items).find((o) => o.id === this.view()) ?? null);
  readonly isListing = computed(() => this.view().startsWith('lst:'));

  setView(id: string): void { this.view.set(id); this.load(); }
  /** The matrix's points list the per-point commute views: fetched once when the bubble opens. */
  ensureMatrix(): void { if (!this.matrix()) this.api.connectivity().subscribe({ next: (m) => this.matrix.set(m), error: () => undefined }); }
  setPoiUnit(u: DensityUnit): void { this.poiUnit.set(u); this.draw(); }
  setFilters(f: ListingFilters): void { this.filters.set(f); this.stats.set(null); if (this.isListing()) this.load(); }

  /** Fetch what the view needs (once per kind), then draw. */
  load(): void {
    const v = this.view();
    this.error.set('');
    if (!v) { this.fill.clear(); return; }
    const done = { next: () => { this.loading.set(false); this.draw(); }, error: (e: unknown) => { this.loading.set(false); this.error.set(apiError(e)); } };
    if ((v.startsWith('idx:') || v.startsWith('poi:')) && !this.indices()) {
      this.loading.set(true);
      this.api.allIndices().subscribe({ ...done, next: (i) => { this.indices.set(i); done.next(); } });
    } else if (v.startsWith('com:') && !this.matrix()) {
      this.loading.set(true);
      this.api.connectivity().subscribe({ ...done, next: (m) => { this.matrix.set(m); done.next(); } });
    } else if (v.startsWith('lst:') && !this.stats()) {
      this.loading.set(true);
      this.api.zoneStats({ ...this.filters() }).subscribe({ ...done, next: (s) => { this.stats.set(s); done.next(); } });
    } else this.draw();
  }

  /** Build the per-zone values of the view and hand them to the fill. */
  draw(): void {
    const v = this.view(), o = this.current();
    if (!v || !o) { this.fill.clear(); return; }
    const [kind, key] = [v.slice(0, 3), v.slice(4)];
    const values: Record<string, number | null> = {};
    let points: GeoCollection | undefined;
    if (kind === 'idx') for (const [z, x] of Object.entries(this.indices()?.zones ?? {})) values[z] = x[key as 'transport']?.value ?? null;
    if (kind === 'poi') for (const [z, x] of Object.entries(this.indices()?.zones ?? {})) values[z] = x.density?.[key]?.[this.poiUnit()]?.value ?? null;
    if (kind === 'com') for (const [z, x] of Object.entries(this.matrix()?.zones ?? {})) values[z] = key === 'weighted' ? x.weighted : x.by_point[key] ?? null;
    if (kind === 'lst') {
      const st = this.stats();
      for (const [z, x] of Object.entries(st?.zones ?? {})) {
        values[z] = key === 'n' ? x.n : key === 'per_km2' ? x.per_km2 : (x as any)[key]?.median ?? null;
      }
      points = { type: 'FeatureCollection', features: (st?.points ?? []).map((c) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: {} })) };
    }
    const layer: FillLayer = { key: v, label: o.label, unit: kind === 'poi' ? UNIT_LABELS[this.poiUnit()] : o.unit, help: o.help, values, points,
      higherIsBetter: kind === 'idx' || kind === 'poi' };
    this.fill.show(layer);
  }
}

/** "Colour zones by": the grouped list of views, the POI unit, the legend and the hovered zone. */
@Component({
  selector: 'fh-explore-colour',
  imports: [InfoButton, DecimalPipe],
  template: `
    <label class="fh-row"><input type="radio" class="form-check-input" name="xview" [checked]="!heat.view()" (change)="pick('')" />
      <span class="fh-grow">None</span></label>
    @for (g of heat.options(); track g.label) {
      <div class="fh-section mt-2 d-flex align-items-center gap-1">{{ g.label }} <fh-info [id]="g.help" /></div>
      @for (o of g.items; track o.id) {
        <label class="fh-row"><input type="radio" class="form-check-input" name="xview" [checked]="heat.view() === o.id" (change)="pick(o.id)" />
          <span class="fh-grow">{{ o.label }}</span></label>
      }
      @if (g.label === 'Services amount' && heat.view().startsWith('poi:')) {
        <select class="form-select form-select-sm mt-1" [value]="heat.poiUnit()" (change)="heat.setPoiUnit($any($event.target).value)">
          <option value="per_1000_homes">per 1,000 homes</option><option value="per_km2">per km²</option><option value="count">count in the zone</option>
        </select>
      }
    }
    @if (heat.loading()) { <div class="small text-body-secondary mt-2">Loading…</div> }
    @if (heat.error()) { <div class="small text-danger mt-2">{{ heat.error() }}</div> }
    @if (fill.layer(); as l) {
      <div class="fh-section mt-3">{{ l.label }} <span class="text-body-secondary fw-normal">{{ l.unit }}</span></div>
      <div class="fh-xlegend">
        @for (c of fill.legend(); track $index) {
          <div class="fh-row"><span class="fh-xsw" [style.background]="c.colour"></span>
            <span>{{ c.from | number: '1.0-1' }} – {{ c.to | number: '1.0-1' }}{{ fill.settings().classes === 'percentile' ? ' pct' : '' }}</span></div>
        }
        <div class="fh-row"><span class="fh-xsw nd"></span><span>no data{{ heat.isListing() ? ' (fewer than ' + heat.filters().min_n + ' listings)' : '' }}</span></div>
      </div>
      @if (fill.hover(); as h) {
        <div class="small mt-2"><b>{{ h.name }}</b>: {{ h.value == null ? 'no data' : (h.value | number: '1.0-1') + ' ' + l.unit }}
          @if (h.rank != null) { · better than or equal to {{ h.rank | number: '1.0-0' }}% of zones }</div>
      } @else { <div class="small text-body-secondary mt-2">Hover a zone for its value.</div> }
    }`,
  styles: [`.fh-xsw { display: inline-block; width: 22px; height: 12px; border-radius: 3px; box-shadow: 0 0 0 1px #0005; }
    .fh-xsw.nd { background: repeating-linear-gradient(45deg, #5a5a66 0 3px, #33333b 3px 6px); }
    .fh-xlegend .fh-row { padding: 1px 0; font-size: .8rem; }`],
})
export class ExploreColour {
  protected heat = inject(ExploreHeatService);
  protected fill = inject(ZoneFillService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  constructor() { this.heat.ensureMatrix(); }
  /** Pick a view and keep it in the URL (?view=), so the map can be reloaded or shared as it is. */
  protected pick(id: string): void {
    this.heat.setView(id);
    void this.router.navigate([], { relativeTo: this.route, queryParams: { view: id || null }, queryParamsHandling: 'merge', replaceUrl: true });
  }
}

/** "Listing filters": which listings the listing statistics count; applied to the URL so a view can be shared. */
@Component({
  selector: 'fh-explore-filters',
  imports: [FormsModule],
  template: `
    @let f = draft;
    <div class="fh-xf">
      <label>Pipeline status
        <select class="form-select form-select-sm" multiple size="3" [(ngModel)]="statusList">
          @for (s of tags.statuses(); track s) { <option [value]="s">{{ s }}</option> }
        </select></label>
      <label>Seen on the site
        <select class="form-select form-select-sm" [(ngModel)]="f.seen">
          <option value="all">every listing ever seen</option><option value="active">active (seen recently)</option><option value="gone">gone (not seen recently)</option>
        </select></label>
      @if (f.seen !== 'all') { <label>"Recently" = last <input type="number" min="1" class="form-control form-control-sm d-inline w-auto" [(ngModel)]="f.active_days" /> days</label> }
      <label>Score
        <select class="form-select form-select-sm" [(ngModel)]="f.scored">
          <option value="all">all</option><option value="passing">passing the hard filters</option><option value="rejected">rejected by a hard filter</option>
        </select></label>
      <div class="fh-xf-pair"><label>Posted from <input type="date" class="form-control form-control-sm" [(ngModel)]="f.posted_from" /></label>
        <label>to <input type="date" class="form-control form-control-sm" [(ngModel)]="f.posted_to" /></label></div>
      <div class="fh-xf-pair"><label>First seen from <input type="date" class="form-control form-control-sm" [(ngModel)]="f.first_seen_from" /></label>
        <label>to <input type="date" class="form-control form-control-sm" [(ngModel)]="f.first_seen_to" /></label></div>
      <div class="fh-xf-pair"><label>Rent min <input type="number" class="form-control form-control-sm" [(ngModel)]="f.rent_min" /></label>
        <label>max <input type="number" class="form-control form-control-sm" [(ngModel)]="f.rent_max" /></label></div>
      <div class="fh-xf-pair"><label>m² min <input type="number" class="form-control form-control-sm" [(ngModel)]="f.size_min" /></label>
        <label>max <input type="number" class="form-control form-control-sm" [(ngModel)]="f.size_max" /></label></div>
      <div class="fh-xf-pair"><label>Rooms min <input type="number" step="0.5" class="form-control form-control-sm" [(ngModel)]="f.rooms_min" /></label>
        <label>max <input type="number" step="0.5" class="form-control form-control-sm" [(ngModel)]="f.rooms_max" /></label></div>
      <label>Colour a zone from <input type="number" min="1" class="form-control form-control-sm d-inline w-auto" [(ngModel)]="f.min_n" /> listings</label>
      <div class="d-flex gap-2 mt-1">
        <button class="btn btn-sm btn-primary" (click)="apply()">Apply</button>
        <button class="btn btn-sm btn-outline-secondary" (click)="reset()">Reset</button>
      </div>
      @if (heat.stats(); as s) {
        <div class="small text-body-secondary">{{ s.listings }} listings, {{ s.in_zones }} inside a zone, {{ coloured() }} zones with {{ s.min_n }}+.</div>
      }
      @if (!heat.isListing()) { <div class="small text-body-secondary">Filters apply to the Listings views.</div> }
    </div>`,
  styles: [`.fh-xf { display: flex; flex-direction: column; gap: 6px; font-size: .8rem; label { display: block; color: var(--bs-secondary-color); } }
    .fh-xf-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }`],
})
export class ExploreFilters {
  protected heat = inject(ExploreHeatService);
  protected tags = inject(TagsStore);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  protected draft: ListingFilters = { ...this.heat.filters() };
  protected statusList: string[] = this.draft.statuses ? this.draft.statuses.split(',') : [];
  protected coloured = computed(() => Object.values(this.heat.stats()?.zones ?? {}).filter((z) => z.rent || z.size).length);

  constructor() {
    // filters from the URL (f_<key>), so a filtered view survives a reload and can be shared
    const q = this.route.snapshot.queryParamMap;
    const fromUrl: Partial<ListingFilters> = {};
    for (const k of Object.keys(NO_FILTERS) as (keyof ListingFilters)[]) {
      const v = q.get(`f_${k}`);
      if (v != null) (fromUrl as any)[k] = typeof NO_FILTERS[k] === 'number' || NO_FILTERS[k] === null ? Number(v) : v;
    }
    if (Object.keys(fromUrl).length) {
      this.draft = { ...NO_FILTERS, ...fromUrl };
      this.statusList = this.draft.statuses ? this.draft.statuses.split(',') : [];
      this.heat.setFilters({ ...this.draft });
    }
  }

  protected apply(): void {
    const f = { ...this.draft, statuses: this.statusList.join(',') };
    this.heat.setFilters(f);
    const qp: Record<string, string | null> = {};
    for (const k of Object.keys(NO_FILTERS) as (keyof ListingFilters)[]) {
      const v = f[k];
      qp[`f_${k}`] = v === NO_FILTERS[k] || v === '' || v == null ? null : String(v);
    }
    void this.router.navigate([], { relativeTo: this.route, queryParams: qp, queryParamsHandling: 'merge', replaceUrl: true });
  }
  protected reset(): void { this.draft = { ...NO_FILTERS }; this.statusList = []; this.apply(); }
}

/** "Heatmap settings": opacity, colour ramp, classes, display type, outlines. */
@Component({
  selector: 'fh-explore-settings',
  template: `
    @let s = fill.settings();
    <div class="fh-xf">
      <label>Opacity {{ (s.opacity * 100).toFixed(0) }}%
        <input type="range" class="form-range" min="0.1" max="1" step="0.05" [value]="s.opacity" (input)="fill.update({ opacity: +$any($event.target).value })" /></label>
      <label>Colour scale
        <select class="form-select form-select-sm" [value]="s.ramp" (change)="fill.update({ ramp: $any($event.target).value })">
          @for (r of ramps; track r) { <option [value]="r">{{ r }}</option> }
        </select></label>
      <label class="form-check"><input type="checkbox" class="form-check-input" [checked]="s.reverse" (change)="fill.update({ reverse: !s.reverse })" /> Reverse the scale</label>
      <label>Classes
        <select class="form-select form-select-sm" [value]="s.classes" (change)="fill.update({ classes: $any($event.target).value })">
          <option value="quantile">quantile (equal counts)</option><option value="equal">equal intervals</option><option value="percentile">percentile rank</option>
        </select></label>
      <label>Steps
        <select class="form-select form-select-sm" [value]="s.steps" (change)="fill.update({ steps: +$any($event.target).value })">
          @for (n of [4, 5, 6, 7]; track n) { <option [value]="n">{{ n }}</option> }
        </select></label>
      <label>Display
        <select class="form-select form-select-sm" [value]="s.display" (change)="fill.update({ display: $any($event.target).value })">
          <option value="fill">zone fill</option><option value="extrude">3D: height by value</option>
          <option value="heat" [disabled]="!heat.isListing()">listing density (points)</option>
        </select></label>
      <label class="form-check"><input type="checkbox" class="form-check-input" [checked]="s.outline" (change)="fill.update({ outline: !s.outline })" /> Zone outlines</label>
    </div>`,
  styles: [`.fh-xf { display: flex; flex-direction: column; gap: 6px; font-size: .8rem; label { display: block; color: var(--bs-secondary-color); } }`],
})
export class ExploreSettings {
  protected fill = inject(ZoneFillService);
  protected heat = inject(ExploreHeatService);
  protected ramps = Object.keys(RAMPS) as RampName[];
}

export type { Classes, Display };
