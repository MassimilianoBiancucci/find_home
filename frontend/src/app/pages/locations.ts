import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AddressInput, PinPreview } from '../components/address-input';
import { AddressSuggestion, Category, LocationsConfig, Point, Trip, Window } from '../models';
import { ApiService, apiError } from '../services/api.service';

const MODES = ['transit', 'walk', 'bike', 'drive'];
const DIRECTIONS: { value: Trip['direction']; label: string }[] = [
  { value: 'to_point', label: 'home → point' }, { value: 'from_point', label: 'point → home' }, { value: 'both', label: 'both ways' },
];

/**
 * Editor for config/locations.yaml: any number of points per category, each with its own trips
 * (direction, day types) and time windows (arrive_by / depart_at, weight, sampling step).
 * Saving replaces one point through the comment-preserving config writer; the server validates.
 */
@Component({
  selector: 'fh-locations',
  imports: [FormsModule, AddressInput, PinPreview],
  styles: [`
    .fh-point { border-left: 4px solid var(--cat) !important; }
    .fh-point-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .fh-point-title { font-weight: 600; font-size: 1.02rem; color: var(--bs-emphasis-color); }
    .fh-cat-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--cat); box-shadow: 0 0 6px var(--cat); }
    .fh-cat-badge { background: color-mix(in srgb, var(--cat) 20%, transparent); color: var(--bs-emphasis-color);
      border: 1px solid color-mix(in srgb, var(--cat) 55%, transparent); font-weight: 500; }
    .fh-chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .fh-chip { --c: var(--fh-violet); --cs: var(--fh-violet-soft); font-size: 0.78rem; padding: 2px 10px; border-radius: 999px;
      border: 1px solid var(--bs-border-color); background: transparent; color: var(--bs-secondary-color); line-height: 1.5;
      &:hover { border-color: var(--c); color: var(--bs-emphasis-color); }
      &.on { border-color: var(--c); background: var(--cs); color: var(--c); font-weight: 600; } }
    .fh-chip.mode { --c: var(--fh-cyan); --cs: var(--fh-cyan-soft); }
    .fh-chip.day { --c: var(--fh-amber); --cs: var(--fh-amber-soft); }
    .fh-chip.dir { --c: var(--fh-blue); --cs: var(--fh-blue-soft); }
    .fh-trip-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; }
    .fh-trip-no { font-weight: 600; color: var(--fh-violet); min-width: 46px; }
    .fh-lbl { font-size: 0.72rem; color: var(--bs-secondary-color); margin-right: 4px; }
    .fh-windows { --bs-table-bg: transparent; margin: 8px 0 0; font-size: 0.85rem;
      th { font-size: 0.72rem; font-weight: 600; color: var(--bs-secondary-color); text-transform: uppercase; letter-spacing: 0.05em; border-bottom-color: var(--bs-border-color); }
      td { border: 0; padding: 3px 6px 3px 0; } }
  `],
  template: `
  <div class="fh-page-head">
    <h1>Locations</h1>
    <button class="btn btn-sm btn-outline-primary" (click)="addPoint()">+ Add point</button>
    <span class="small text-body-secondary">Categories, colours and default weights: Settings → locations.yaml. Day types: time_model.yaml ({{ dayTypes().join(', ') }}).</span>
  </div>
  @if (error()) { <div class="alert alert-danger py-1 small" style="white-space:pre-wrap">{{ error() }}</div> }
  @if (info()) { <div class="alert alert-success py-1 small">{{ info() }}</div> }

  @for (p of draft(); track $index; let i = $index) {
    <div class="card mb-3 fh-point" [style.--cat]="cats()[p.category]?.color ?? '#8888a0'">
      <div class="card-header fh-point-head">
        <span class="fh-cat-dot"></span>
        <span class="fh-point-title">{{ p.label || 'Untitled point' }}</span>
        <span class="badge fh-cat-badge">{{ cats()[p.category]?.label ?? p.category }}</span>
        <span class="fh-mono text-body-secondary">{{ p.id }}</span>
        <span class="ms-auto small text-body-secondary">
          weight {{ p.weight ?? cats()[p.category]?.default_weight }} · {{ p.trips.length }} trip{{ p.trips.length === 1 ? '' : 's' }}
        </span>
      </div>
      <div class="card-body">
        <div class="row g-4">
          <div class="col-lg-7">
            <div class="fh-section">Place</div>
            <div class="row g-2">
              <div class="col-12"><label class="form-label small mb-1">Label</label><input class="form-control form-control-sm" [(ngModel)]="p.label" /></div>
              <div class="col-md-8"><label class="form-label small mb-1">Address <span class="text-body-secondary">(type to get suggestions)</span></label>
                <fh-address-input [(value)]="p.address" (picked)="pickAddress(p, $event)" /></div>
              <div class="col-md-4"><label class="form-label small mb-1">Coords (lat, lon)
                  @if (p.coords) { <a href="" class="ms-1" (click)="$event.preventDefault(); clearCoords(p)">clear</a> }</label>
                <input class="form-control form-control-sm fh-mono" [ngModel]="coordsText(p)" (ngModelChange)="setCoords(p, $event)" placeholder="59.33, 18.06" /></div>
              @if (p.coords) { <div class="col-12"><fh-pin-preview [coords]="p.coords" /></div> }
              @else if (p.address) { <div class="col-12 small text-warning">No coordinates: pick a suggestion so the point does not depend on geocoding.</div> }
              <div class="col-12"><label class="form-label small mb-1">Notes</label><textarea class="form-control form-control-sm" rows="2" [(ngModel)]="p.notes"></textarea></div>
            </div>
          </div>
          <div class="col-lg-5">
            <div class="fh-section">Scoring</div>
            <div class="row g-2">
              <div class="col-6"><label class="form-label small mb-1">Id</label><input class="form-control form-control-sm fh-mono" [(ngModel)]="p.id" /></div>
              <div class="col-6"><label class="form-label small mb-1">Category</label>
                <select class="form-select form-select-sm" [(ngModel)]="p.category">
                  @for (c of categories(); track c) { <option [value]="c">{{ cats()[c]?.label ?? c }}</option> }
                </select></div>
              <div class="col-6"><label class="form-label small mb-1">Weight</label>
                <input type="number" step="0.1" class="form-control form-control-sm" [(ngModel)]="p.weight" [placeholder]="'default ' + (cats()[p.category]?.default_weight ?? '')" /></div>
              <div class="col-12"><label class="form-label small mb-1">Modes</label>
                <div class="fh-chips">
                  @for (m of modes; track m) {
                    <button type="button" class="fh-chip mode" [class.on]="p.modes.includes(m)" (click)="toggleMode(p.modes, m)">{{ m }}</button>
                  }
                </div></div>
            </div>
          </div>
        </div>

        <div class="fh-section mt-4">Trips</div>
        @for (t of p.trips; track $index; let j = $index) {
          <div class="fh-sub p-2 px-3 mb-2">
            <div class="fh-trip-head">
              <span class="fh-trip-no">Trip {{ j + 1 }}</span>
              <div class="fh-chips align-items-center"><span class="fh-lbl">Direction</span>
                @for (d of directions; track d.value) {
                  <button type="button" class="fh-chip dir" [class.on]="t.direction === d.value" (click)="t.direction = d.value">{{ d.label }}</button>
                }</div>
              <div class="fh-chips align-items-center"><span class="fh-lbl">Days</span>
                @for (dt of dayTypes(); track dt) {
                  <button type="button" class="fh-chip day" [class.on]="t.day_types.includes(dt)" (click)="toggleMode(t.day_types, dt)">{{ dt }}</button>
                }</div>
              <div class="form-check form-switch small mb-0">
                <input class="form-check-input" type="checkbox" [id]="'grid-' + i + '-' + j" [(ngModel)]="t.use_default_grid" />
                <label class="form-check-label" [for]="'grid-' + i + '-' + j">default grid</label>
              </div>
              <button class="btn btn-sm btn-link text-danger ms-auto p-0" (click)="p.trips.splice(j, 1)">remove trip</button>
            </div>
            @if (t.use_default_grid) {
              <div class="small text-body-secondary mt-2">Sampled on the default grid of time_model.yaml.</div>
            } @else {
              <table class="table table-sm fh-windows align-middle">
                <thead><tr><th>Window</th><th>From</th><th>To</th><th>Weight</th><th>Every (min)</th><th></th></tr></thead>
                <tbody>
                  @for (w of t.windows ?? []; track $index; let k = $index) {
                    <tr>
                      <td style="width:150px"><select class="form-select form-select-sm" [(ngModel)]="w.type">
                        <option value="arrive_by">arrive by</option><option value="depart_at">depart at</option></select></td>
                      <td style="width:95px"><input class="form-control form-control-sm fh-mono" [(ngModel)]="w.from" placeholder="08:00" /></td>
                      <td style="width:95px"><input class="form-control form-control-sm fh-mono" [(ngModel)]="w.to" placeholder="09:00" /></td>
                      <td style="width:90px"><input type="number" step="0.1" class="form-control form-control-sm" [(ngModel)]="w.weight" /></td>
                      <td style="width:100px"><input type="number" class="form-control form-control-sm" [(ngModel)]="w.step_min" /></td>
                      <td><button class="btn btn-sm btn-link text-danger p-0" title="Remove window" (click)="t.windows!.splice(k, 1)">✕</button></td>
                    </tr>
                  }
                </tbody>
              </table>
              <button class="btn btn-sm btn-link p-0" (click)="addWindow(t)">+ window</button>
            }
          </div>
        }
      </div>
      <div class="card-footer d-flex gap-2 align-items-center">
        <button class="btn btn-sm btn-link p-0" (click)="addTrip(p)">+ trip</button>
        <button class="btn btn-sm btn-primary ms-auto" (click)="save(i)">Save point</button>
        <button class="btn btn-sm btn-outline-danger" (click)="remove(i)">Delete point</button>
      </div>
    </div>
  }
  `,
})
export class LocationsPage implements OnInit {
  private api = inject(ApiService);
  protected modes = MODES;
  protected directions = DIRECTIONS;
  protected draft = signal<Point[]>([]);
  protected saved: Point[] = [];
  protected categories = signal<string[]>([]);
  protected cats = signal<Record<string, Category>>({});
  protected dayTypes = signal<string[]>(['weekday', 'saturday', 'sunday']);
  protected error = signal('');
  protected info = signal('');

  ngOnInit(): void {
    this.load();
    this.api.config('time_model').subscribe({ next: (f) => this.dayTypes.set(Object.keys(f.data.day_types)), error: () => { } });
  }

  load(): void {
    this.api.config<LocationsConfig>('locations').subscribe({
      next: (f) => {
        this.cats.set(f.data.categories);
        this.categories.set(Object.keys(f.data.categories));
        this.saved = f.data.points;
        this.draft.set(structuredClone(f.data.points));
      },
      error: (e) => this.error.set(apiError(e)),
    });
  }

  coordsText(p: Point): string { return p.coords ? p.coords.join(', ') : ''; }
  pickAddress(p: Point, s: AddressSuggestion): void {
    p.address = s.label;
    p.coords = [Math.round(s.lat * 1e5) / 1e5, Math.round(s.lon * 1e5) / 1e5];
  }
  clearCoords(p: Point): void { delete p.coords; }
  setCoords(p: Point, text: string): void {
    const parts = text.split(',').map((x) => parseFloat(x.trim()));
    if (parts.length === 2 && parts.every((x) => !isNaN(x))) p.coords = [parts[0], parts[1]];
    else if (!text.trim()) delete p.coords;
  }
  toggleMode(list: string[], m: string): void {
    const i = list.indexOf(m);
    i >= 0 ? list.splice(i, 1) : list.push(m);
  }
  addTrip(p: Point): void { p.trips.push({ direction: 'both', day_types: ['weekday'], windows: [{ type: 'depart_at', from: '18:00', to: '22:00', weight: 1, step_min: 60 }] }); }
  addWindow(t: Trip): void { (t.windows ??= []).push({ type: 'arrive_by', from: '08:00', to: '09:00', weight: 1, step_min: 15 } as Window); }

  addPoint(): void {
    this.draft.update((d) => [...d, {
      id: `point-${d.length + 1}`, category: this.categories().includes('generic') ? 'generic' : this.categories()[0],
      label: 'New point', address: '', modes: ['transit'], notes: '',
      trips: [{ direction: 'both', day_types: ['weekday'], windows: [{ type: 'depart_at', from: '17:00', to: '20:00', weight: 1, step_min: 60 }] }],
    }]);
  }

  private clean(p: Point): Point {
    const c: any = structuredClone(p);
    if (!c.address) delete c.address;
    if (c.weight === null || c.weight === '') delete c.weight;
    for (const t of c.trips) {
      if (t.use_default_grid) delete t.windows; else delete t.use_default_grid;
    }
    return c;
  }

  save(i: number): void {
    const point = this.clean(this.draft()[i]);
    const op = i < this.saved.length ? { op: 'replace', path: `/points/${i}`, value: point } : { op: 'add', path: '/points/-', value: point };
    this.api.patchConfig('locations', [op]).subscribe({
      next: (r) => { this.info.set(`Saved ${point.id} · config ${r.config_hash.slice(0, 7)} · scores need a recompute`); this.error.set(''); this.load(); },
      error: (e) => this.error.set(apiError(e)),
    });
  }

  remove(i: number): void {
    if (i >= this.saved.length) { this.draft.update((d) => d.filter((_, k) => k !== i)); return; }
    this.api.patchConfig('locations', [{ op: 'remove', path: `/points/${i}` }]).subscribe({
      next: () => { this.info.set('Point removed'); this.load(); },
      error: (e) => this.error.set(apiError(e)),
    });
  }
}
