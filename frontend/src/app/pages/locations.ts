import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LocationsConfig, Point, Trip, Window } from '../models';
import { ApiService, apiError } from '../services/api.service';

const MODES = ['transit', 'walk', 'bike', 'drive'];

/**
 * Editor for config/locations.yaml: any number of points per category, each with its own trips
 * (direction, day types) and time windows (arrive_by / depart_at, weight, sampling step).
 * Saving replaces one point through the comment-preserving config writer; the server validates.
 */
@Component({
  selector: 'fh-locations',
  imports: [FormsModule],
  template: `
  <div class="fh-page-head">
    <h1>Locations</h1>
    <button class="btn btn-sm btn-outline-primary" (click)="addPoint()">+ Add point</button>
    <span class="small text-body-secondary">Categories, colours and default weights: Settings → locations.yaml. Day types: time_model.yaml ({{ dayTypes().join(', ') }}).</span>
  </div>
  @if (error()) { <div class="alert alert-danger py-1 small" style="white-space:pre-wrap">{{ error() }}</div> }
  @if (info()) { <div class="alert alert-success py-1 small">{{ info() }}</div> }

  @for (p of draft(); track $index; let i = $index) {
    <div class="card mb-3"><div class="card-body">
      <div class="row g-2 align-items-end">
        <div class="col-md-2"><label class="form-label small">Id</label><input class="form-control form-control-sm fh-mono" [(ngModel)]="p.id" /></div>
        <div class="col-md-2"><label class="form-label small">Category</label>
          <select class="form-select form-select-sm" [(ngModel)]="p.category">
            @for (c of categories(); track c) { <option [value]="c">{{ c }}</option> }
          </select></div>
        <div class="col-md-3"><label class="form-label small">Label</label><input class="form-control form-control-sm" [(ngModel)]="p.label" /></div>
        <div class="col-md-1"><label class="form-label small">Weight</label><input type="number" step="0.1" class="form-control form-control-sm" [(ngModel)]="p.weight" /></div>
        <div class="col-md-4"><label class="form-label small">Modes</label><div>
          @for (m of modes; track m) {
            <label class="me-2 small"><input type="checkbox" class="form-check-input me-1" [checked]="p.modes.includes(m)" (change)="toggleMode(p.modes, m)" />{{ m }}</label>
          }</div></div>
        <div class="col-md-6"><label class="form-label small">Address</label><input class="form-control form-control-sm" [(ngModel)]="p.address" placeholder="street, city" /></div>
        <div class="col-md-3"><label class="form-label small">Coords (lat, lon) — optional</label>
          <input class="form-control form-control-sm" [ngModel]="coordsText(p)" (ngModelChange)="setCoords(p, $event)" placeholder="59.33, 18.06" /></div>
        <div class="col-md-3"><label class="form-label small">Notes</label><input class="form-control form-control-sm" [(ngModel)]="p.notes" /></div>
      </div>

      @for (t of p.trips; track $index; let j = $index) {
        <div class="border rounded p-2 mt-2">
          <div class="d-flex flex-wrap gap-2 align-items-center small">
            <b>Trip {{ j + 1 }}</b>
            <select class="form-select form-select-sm w-auto" [(ngModel)]="t.direction">
              <option value="to_point">home → point</option><option value="from_point">point → home</option><option value="both">both</option>
            </select>
            @for (dt of dayTypes(); track dt) {
              <label><input type="checkbox" class="form-check-input me-1" [checked]="t.day_types.includes(dt)" (change)="toggleMode(t.day_types, dt)" />{{ dt }}</label>
            }
            <label><input type="checkbox" class="form-check-input me-1" [(ngModel)]="t.use_default_grid" />default grid</label>
            <button class="btn btn-sm btn-outline-danger ms-auto" (click)="p.trips.splice(j, 1)">remove trip</button>
          </div>
          @if (!t.use_default_grid) {
            @for (w of t.windows ?? []; track $index; let k = $index) {
              <div class="d-flex flex-wrap gap-2 align-items-center small mt-1">
                <select class="form-select form-select-sm w-auto" [(ngModel)]="w.type">
                  <option value="arrive_by">arrive by</option><option value="depart_at">depart at</option></select>
                <input class="form-control form-control-sm" style="width:80px" [(ngModel)]="w.from" placeholder="08:00" />
                –<input class="form-control form-control-sm" style="width:80px" [(ngModel)]="w.to" placeholder="09:00" />
                weight <input type="number" step="0.1" class="form-control form-control-sm" style="width:70px" [(ngModel)]="w.weight" />
                every <input type="number" class="form-control form-control-sm" style="width:70px" [(ngModel)]="w.step_min" /> min
                <button class="btn btn-sm btn-link text-danger" (click)="t.windows!.splice(k, 1)">✕</button>
              </div>
            }
            <button class="btn btn-sm btn-link" (click)="addWindow(t)">+ window</button>
          }
        </div>
      }
      <div class="mt-2 d-flex gap-2">
        <button class="btn btn-sm btn-link" (click)="addTrip(p)">+ trip</button>
        <button class="btn btn-sm btn-primary ms-auto" (click)="save(i)">Save point</button>
        <button class="btn btn-sm btn-outline-danger" (click)="remove(i)">Delete point</button>
      </div>
    </div></div>
  }
  `,
})
export class LocationsPage implements OnInit {
  private api = inject(ApiService);
  protected modes = MODES;
  protected draft = signal<Point[]>([]);
  protected saved: Point[] = [];
  protected categories = signal<string[]>([]);
  protected dayTypes = signal<string[]>(['weekday', 'saturday', 'sunday']);
  protected error = signal('');
  protected info = signal('');

  ngOnInit(): void {
    this.load();
    this.api.config('time_model').subscribe({ next: (f) => this.dayTypes.set(Object.keys(f.data.day_types)), error: () => {} });
  }

  load(): void {
    this.api.config<LocationsConfig>('locations').subscribe({
      next: (f) => {
        this.categories.set(Object.keys(f.data.categories));
        this.saved = f.data.points;
        this.draft.set(structuredClone(f.data.points));
      },
      error: (e) => this.error.set(apiError(e)),
    });
  }

  coordsText(p: Point): string { return p.coords ? p.coords.join(', ') : ''; }
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
