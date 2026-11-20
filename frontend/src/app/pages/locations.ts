import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AddressInput } from '../components/address-input';
import { PointMap } from '../components/point-map';
import { AddressSuggestion, Category, LocationsConfig, Point, Trip, Window } from '../models';
import { ApiService, apiError } from '../services/api.service';

const MODES = ['transit', 'walk', 'bike', 'drive'];
const DIRECTIONS: { value: Trip['direction']; label: string }[] = [
  { value: 'to_point', label: 'home → point' }, { value: 'from_point', label: 'point → home' }, { value: 'both', label: 'both ways' },
];
const DAY_MIN = 24 * 60;
const HOURS = [0, 3, 6, 9, 12, 15, 18, 21, 24];

/** "08:30" as minutes since midnight; null when it does not parse. */
export function minutesOf(t: string | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((t ?? '').trim());
  if (!m) return null;
  const v = +m[1] * 60 + +m[2];
  return v >= 0 && v <= DAY_MIN ? v : null;
}

/** A piece of a window on the 24-hour bar, in percent of the day. A window over midnight is two pieces: to the
 *  end of the day and from its start; the wider one carries the label. */
export interface DaySegment { left: number; width: number; label: boolean; toMidnight?: boolean; fromMidnight?: boolean; }

/** A window's pieces on the 24-hour bar; none when its times do not parse. "18:00"–"03:00" runs over midnight. */
export function daySegments(from: string | undefined, to: string | undefined): DaySegment[] {
  const a = minutesOf(from), b = minutesOf(to);
  if (a == null || b == null) return [];
  const pct = (m: number) => (m / DAY_MIN) * 100;
  if (b >= a || b === 0) { const end = b >= a ? b : DAY_MIN; return [{ left: pct(a), width: Math.max(0.4, pct(end - a)), label: true }]; }
  const late = { left: pct(a), width: Math.max(0.4, pct(DAY_MIN - a)), label: false, toMidnight: true };
  const early = { left: 0, width: Math.max(0.4, pct(b)), label: false, fromMidnight: true };
  (late.width >= early.width ? late : early).label = true;
  return [early, late];
}

/**
 * Editor for config/locations.yaml: any number of points per category, each with its own trips
 * (direction, day types) and time windows (arrive_by / depart_at, weight, sampling step).
 * An overview map of every point heads the page (click one to jump to it); each point's card has the form on the
 * left and its own map on the right (the point large, the others small; click "Place on map" then the map to move
 * it). Each trip draws its windows on a 24-hour bar. Saving replaces one point through the comment-preserving config
 * writer; the server validates. A card with changes not saved yet says so.
 */
@Component({
  selector: 'fh-locations',
  imports: [FormsModule, AddressInput, PointMap],
  styles: [`
    /* fields that stand out from the card: a clear border, a violet ring on focus */
    :host ::ng-deep .form-control, :host ::ng-deep .form-select {
      border: 1px solid color-mix(in srgb, var(--bs-secondary-color) 45%, transparent); border-radius: 8px; font-size: .86rem;
      transition: border-color .15s, box-shadow .15s; }
    :host ::ng-deep .form-control:hover, :host ::ng-deep .form-select:hover { border-color: color-mix(in srgb, var(--fh-violet) 55%, transparent); }
    :host ::ng-deep .form-control:focus, :host ::ng-deep .form-select:focus { border-color: var(--fh-violet); box-shadow: 0 0 0 3px var(--fh-violet-soft); }
    .fh-flabel { display: block; font-size: .76rem; font-weight: 600; color: var(--bs-emphasis-color); opacity: .8; margin-bottom: 3px; }
    .fh-flabel small { font-weight: 400; opacity: .75; }

    .fh-overview { display: grid; grid-template-columns: 260px minmax(0, 1fr); gap: 14px; margin-bottom: 18px; padding: 12px;
      border-radius: 12px; border: 1px solid var(--bs-border-color); background: var(--bs-body-bg); }
    .fh-ov-list { display: flex; flex-direction: column; gap: 4px; overflow: auto; max-height: 300px; }
    .fh-ov-item { display: flex; align-items: center; gap: 8px; padding: 5px 8px; border-radius: 8px; border: 1px solid transparent;
      background: transparent; text-align: left; color: var(--bs-body-color); font-size: .84rem; cursor: pointer; }
    .fh-ov-item:hover { border-color: color-mix(in srgb, var(--cat) 60%, transparent); background: color-mix(in srgb, var(--cat) 10%, transparent); }
    .fh-ov-item b { font-weight: 600; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .fh-ov-item small { color: var(--bs-secondary-color); }
    .fh-ov-item .warn { color: var(--fh-amber); }

    .fh-point { border-left: 4px solid var(--cat) !important; scroll-margin-top: 12px; transition: box-shadow .4s; }
    .fh-point.flash { box-shadow: 0 0 0 3px color-mix(in srgb, var(--cat) 60%, transparent), 0 0 24px -4px var(--cat); }
    .fh-point-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .fh-point-title { font-weight: 700; font-size: 1.05rem; color: var(--bs-emphasis-color); }
    .fh-cat-dot { width: 11px; height: 11px; border-radius: 50%; background: var(--cat); box-shadow: 0 0 8px var(--cat); }
    .fh-cat-badge { padding: 2px 10px; border-radius: 999px; font-size: .74rem; font-weight: 700; color: #fff; background: var(--cat);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--cat) 22%, transparent), 0 3px 10px -3px var(--cat); }
    .fh-unsaved { padding: 1px 9px; border-radius: 999px; font-size: .72rem; font-weight: 700; color: #fff;
      background: linear-gradient(135deg, #ffd36b 0%, #ffa51f 50%, #f07b00 100%); box-shadow: 0 3px 10px -3px rgba(255, 165, 31, .8); }
    .fh-head-meta { margin-left: auto; display: flex; gap: 6px; flex-wrap: wrap; font-size: .76rem; color: var(--bs-secondary-color); }
    .fh-head-meta span { padding: 1px 8px; border-radius: 999px; border: 1px solid var(--bs-border-color); white-space: nowrap; }

    .fh-pt-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(320px, 40%); gap: 24px; align-items: start; }
    .fh-pt-side { position: sticky; top: 12px; display: flex; flex-direction: column; gap: 8px; }
    .fh-pt-tools { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: .78rem; color: var(--bs-secondary-color); }
    @media (max-width: 1250px) { .fh-pt-grid { grid-template-columns: 1fr; } .fh-pt-side { position: static; order: -1; }
      .fh-overview { grid-template-columns: 1fr; } }

    .fh-chips { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
    .fh-lbl { font-size: .72rem; font-weight: 600; color: var(--bs-secondary-color); margin-right: 2px; }
    .fh-trip { padding: 10px 12px; margin-bottom: 10px; border-radius: 10px; border: 1px solid var(--bs-border-color);
      background: color-mix(in srgb, var(--bs-body-bg) 60%, transparent); }
    .fh-trip-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; }
    .fh-trip-no { font-weight: 700; color: var(--fh-violet); min-width: 46px; }

    /* the day as a bar: each window a segment (arrive by: violet, depart at: cyan) */
    .fh-day { position: relative; height: 26px; margin: 12px 0 2px; border-radius: 6px;
      background: repeating-linear-gradient(90deg, transparent 0 calc(12.5% - 1px), color-mix(in srgb, var(--bs-secondary-color) 25%, transparent) calc(12.5% - 1px) 12.5%),
        color-mix(in srgb, var(--bs-secondary-color) 10%, transparent); }
    .fh-day-seg { position: absolute; top: 3px; bottom: 3px; min-width: 4px; border-radius: 4px; color: #fff; font-size: .68rem; font-weight: 700;
      display: flex; align-items: center; justify-content: center; overflow: hidden; white-space: nowrap; text-shadow: 0 1px 1px rgba(0,0,0,.35);
      background: linear-gradient(135deg, #ff6ad5 0%, #c43dff 50%, #6a5cff 100%); box-shadow: 0 0 8px -1px rgba(196, 61, 255, .8); }
    /* a window over midnight: the pieces meet the bar's ends square, as if it carried on */
    .fh-day-seg.on-right { border-top-right-radius: 0; border-bottom-right-radius: 0; }
    .fh-day-seg.on-left { border-top-left-radius: 0; border-bottom-left-radius: 0; }
    .fh-day-seg.dep { background: linear-gradient(135deg, #6ff3ff 0%, #19b8e6 50%, #2f6bff 100%); box-shadow: 0 0 8px -1px rgba(25, 184, 230, .8); }
    .fh-day-ticks { position: relative; height: 14px; font-size: .64rem; color: var(--bs-secondary-color); font-variant-numeric: tabular-nums; }
    .fh-day-ticks span { position: absolute; transform: translateX(-50%); }
    .fh-day-ticks span:first-child { transform: none; } .fh-day-ticks span:last-child { transform: translateX(-100%); }
    .fh-day-key { display: inline-flex; align-items: center; gap: 4px; margin-left: 10px; }
    .fh-day-key i { width: 10px; height: 10px; border-radius: 3px; background: linear-gradient(135deg, #ff6ad5, #6a5cff); }
    .fh-day-key i.dep { background: linear-gradient(135deg, #6ff3ff, #2f6bff); }

    .fh-windows { --bs-table-bg: transparent; margin: 8px 0 4px; font-size: .85rem;
      th { font-size: .7rem; font-weight: 700; color: var(--bs-secondary-color); text-transform: uppercase; letter-spacing: .05em; border-bottom-color: var(--bs-border-color); }
      td { border: 0; padding: 3px 6px 3px 0; } }
    .fh-btn-ghost.sm { padding: 2px 11px; font-size: .74rem; }
    .fh-btn-ghost.t-danger { color: var(--fh-bad); }
    .fh-btn-ghost.on { color: #fff; border-color: #c43dff; background: linear-gradient(135deg, #ff6ad5 0%, #c43dff 50%, #6a5cff 100%); }
    .fh-x { border: 0; background: none; color: var(--fh-bad); font-size: .9rem; padding: 0 4px; border-radius: 4px; }
    .fh-x:hover { background: var(--fh-bad-soft); }
  `],
  template: `
  <div class="fh-page-head">
    <h1>Locations</h1>
    <button class="fh-btn-glow" (click)="addPoint()">+ Add point</button>
    <span class="small text-body-secondary">Categories, colours and default weights: Settings → locations.yaml. Day types: time_model.yaml ({{ dayTypes().join(', ') }}).</span>
  </div>
  @if (error()) { <div class="alert alert-danger py-1 small" style="white-space:pre-wrap">{{ error() }}</div> }
  @if (info()) { <div class="alert alert-success py-1 small">{{ info() }}</div> }

  @if (draft().length) {
    <div class="fh-overview">
      <div>
        <div class="fh-section">Your points</div>
        <div class="fh-ov-list">
          @for (p of draft(); track $index; let i = $index) {
            <button type="button" class="fh-ov-item" [style.--cat]="colour(p)" (click)="goTo(i)" [title]="'Go to ' + (p.label || p.id)">
              <span class="fh-cat-dot"></span><b>{{ p.label || 'Untitled point' }}</b>
              @if (!p.coords) { <small class="warn" title="No coordinates">no position</small> }
              @else { <small>{{ cats()[p.category]?.label ?? p.category }}</small> }
            </button>
          }
        </div>
      </div>
      <fh-point-map [points]="draft()" [cats]="cats()" [stamp]="stamp()" [height]="300" (selected)="goTo($event)" />
    </div>
  }

  @for (p of draft(); track $index; let i = $index) {
    <div class="card mb-3 fh-point" [id]="'pt-' + i" [class.flash]="flashed() === i" [style.--cat]="colour(p)">
      <div class="card-header fh-point-head">
        <span class="fh-cat-dot"></span>
        <span class="fh-point-title">{{ p.label || 'Untitled point' }}</span>
        <span class="fh-cat-badge">{{ cats()[p.category]?.label ?? p.category }}</span>
        <span class="fh-mono text-body-secondary">{{ p.id }}</span>
        @if (dirty(i)) { <span class="fh-unsaved" title="Changes not saved yet">unsaved</span> }
        <span class="fh-head-meta">
          <span>weight {{ p.weight ?? cats()[p.category]?.default_weight }}</span>
          <span>{{ p.modes.join(' · ') || 'no modes' }}</span>
          <span>{{ p.trips.length }} trip{{ p.trips.length === 1 ? '' : 's' }}</span>
        </span>
      </div>
      <div class="card-body">
        <div class="fh-pt-grid">
          <div>
            <div class="fh-section">Place</div>
            <div class="row g-2">
              <div class="col-12"><label class="fh-flabel">Label</label><input class="form-control" [(ngModel)]="p.label" /></div>
              <div class="col-md-8"><label class="fh-flabel">Address <small>(type to get suggestions)</small></label>
                <fh-address-input [(value)]="p.address" (picked)="pickAddress(p, $event)" /></div>
              <div class="col-md-4"><label class="fh-flabel">Coords <small>(lat, lon)</small></label>
                <input class="form-control fh-mono" [ngModel]="coordsText(p)" (ngModelChange)="setCoords(p, $event)" placeholder="59.33, 18.06" /></div>
              @if (!p.coords && p.address) { <div class="col-12 small text-warning">No coordinates: pick a suggestion or place the point on the map, so it does not depend on geocoding.</div> }
              <div class="col-12"><label class="fh-flabel">Notes</label><textarea class="form-control" rows="2" [(ngModel)]="p.notes"></textarea></div>
            </div>

            <div class="fh-section mt-4">Scoring</div>
            <div class="row g-2">
              <div class="col-md-4"><label class="fh-flabel">Id</label><input class="form-control fh-mono" [(ngModel)]="p.id" /></div>
              <div class="col-md-4"><label class="fh-flabel">Category</label>
                <select class="form-select" [(ngModel)]="p.category">
                  @for (c of categories(); track c) { <option [value]="c">{{ cats()[c]?.label ?? c }}</option> }
                </select></div>
              <div class="col-md-4"><label class="fh-flabel">Weight</label>
                <input type="number" step="0.1" class="form-control" [(ngModel)]="p.weight" [placeholder]="'default ' + (cats()[p.category]?.default_weight ?? '')" /></div>
              <div class="col-12"><label class="fh-flabel">Modes</label>
                <div class="fh-chips">
                  @for (m of modes; track m) {
                    <button type="button" class="fh-chipf t-contract" [class.sel]="p.modes.includes(m)" [attr.aria-pressed]="p.modes.includes(m)"
                      (click)="toggle(p.modes, m)"><i class="fh-chipf-dot"></i>{{ m }}</button>
                  }
                </div></div>
            </div>

            <div class="fh-section mt-4">Trips</div>
            @for (t of p.trips; track $index; let j = $index) {
              <div class="fh-trip">
                <div class="fh-trip-head">
                  <span class="fh-trip-no">Trip {{ j + 1 }}</span>
                  <div class="fh-chips"><span class="fh-lbl">Direction</span>
                    @for (d of directions; track d.value) {
                      <button type="button" class="fh-chipf t-violet" [class.sel]="t.direction === d.value" (click)="t.direction = d.value">{{ d.label }}</button>
                    }</div>
                  <div class="fh-chips"><span class="fh-lbl">Days</span>
                    @for (dt of dayTypes(); track dt) {
                      <button type="button" class="fh-chipf t-ask" [class.sel]="t.day_types.includes(dt)" (click)="toggle(t.day_types, dt)">{{ dt }}</button>
                    }</div>
                  <div class="form-check form-switch small mb-0">
                    <input class="form-check-input" type="checkbox" [id]="'grid-' + i + '-' + j" [(ngModel)]="t.use_default_grid" />
                    <label class="form-check-label" [for]="'grid-' + i + '-' + j">default grid</label>
                  </div>
                  <button class="fh-btn-ghost sm t-danger ms-auto" (click)="p.trips.splice(j, 1)">Remove trip</button>
                </div>
                @if (t.use_default_grid) {
                  <div class="small text-body-secondary mt-2">Sampled on the default grid of time_model.yaml.</div>
                } @else {
                  <div class="fh-day" role="img" [attr.aria-label]="'Windows of trip ' + (j + 1)">
                    @for (w of t.windows ?? []; track $index) {
                      @for (s of segments(w); track $index) {
                        <span class="fh-day-seg" [class.dep]="w.type === 'depart_at'" [class.on-right]="s.toMidnight" [class.on-left]="s.fromMidnight"
                          [style.left.%]="s.left" [style.width.%]="s.width"
                          [title]="(w.type === 'arrive_by' ? 'arrive by ' : 'depart at ') + w.from + '–' + w.to + (s.toMidnight || s.fromMidnight ? ' (over midnight)' : '') + ' · weight ' + (w.weight ?? 1)">
                          {{ s.label && s.width > 7 ? w.from + '–' + w.to : '' }}</span>
                      }
                    }
                  </div>
                  <div class="fh-day-ticks">@for (h of hours; track h) { <span [style.left.%]="(h / 24) * 100">{{ h }}</span> }</div>
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
                          <td><button class="fh-x" title="Remove window" aria-label="Remove window" (click)="t.windows!.splice(k, 1)">✕</button></td>
                        </tr>
                      }
                    </tbody>
                  </table>
                  <div class="d-flex align-items-center">
                    <button class="fh-btn-ghost sm" (click)="addWindow(t)">+ Window</button>
                    <span class="small text-body-secondary ms-2">
                      <span class="fh-day-key"><i></i> arrive by</span><span class="fh-day-key"><i class="dep"></i> depart at</span></span>
                  </div>
                }
              </div>
            }
            <button class="fh-btn-ghost sm" (click)="addTrip(p)">+ Trip</button>
          </div>

          <div class="fh-pt-side">
            <fh-point-map [points]="draft()" [cats]="cats()" [focus]="i" [stamp]="stamp()" [height]="360"
              [picking]="picking() === i" (picked)="placed(p, $event)" (selected)="goTo($event)" />
            <div class="fh-pt-tools">
              <button type="button" class="fh-btn-ghost sm" [class.on]="picking() === i" (click)="picking.set(picking() === i ? null : i)"
                [title]="picking() === i ? 'Stop placing' : 'Then click the map where the point is'">📍 {{ picking() === i ? 'Click the map…' : 'Place on map' }}</button>
              @if (p.coords) {
                <span class="fh-mono">{{ p.coords[0] }}, {{ p.coords[1] }}</span>
                <button type="button" class="btn btn-link btn-sm p-0" (click)="clearCoords(p)">clear</button>
              }
              <span class="ms-auto">Other points are small; click one to go to it.</span>
            </div>
          </div>
        </div>
      </div>
      <div class="card-footer d-flex gap-2 align-items-center">
        @if (dirty(i)) { <span class="small text-body-secondary">Changes not saved yet</span> }
        @if (dirty(i)) { <button class="fh-btn-glow ms-auto" (click)="save(i)">Save point</button> }
        @else { <button class="fh-btn-ghost ms-auto" disabled title="Nothing to save">✓ Saved</button> }
        <button class="fh-btn-ghost t-danger" (click)="remove(i)">Delete point</button>
      </div>
    </div>
  }
  `,
})
export class LocationsPage implements OnInit {
  private api = inject(ApiService);
  protected modes = MODES;
  protected directions = DIRECTIONS;
  protected hours = HOURS;
  protected draft = signal<Point[]>([]);
  protected saved: Point[] = [];
  protected categories = signal<string[]>([]);
  protected cats = signal<Record<string, Category>>({});
  protected dayTypes = signal<string[]>(['weekday', 'saturday', 'sunday']);
  protected error = signal('');
  protected info = signal('');
  /** The card whose map places the point on the next click. */
  protected picking = signal<number | null>(null);
  /** The card just jumped to (it glows for a moment). */
  protected flashed = signal<number | null>(null);
  private flashTimer: ReturnType<typeof setTimeout> | null = null;

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

  protected colour(p: Point): string { return this.cats()[p.category]?.color ?? '#8888a0'; }
  /** Changes whenever a point moves, is renamed or changes category: the maps redraw (the points are edited in place). */
  protected stamp(): string { return this.draft().map((p) => `${p.label}|${p.category}|${p.coords?.join(',') ?? ''}`).join(';'); }
  /** The point differs from the saved file (or is new). */
  protected dirty(i: number): boolean {
    return i >= this.saved.length || JSON.stringify(this.clean(this.draft()[i])) !== JSON.stringify(this.clean(this.saved[i]));
  }
  /** A window's pieces on the 24-hour bar. */
  protected segments(w: Window): DaySegment[] { return daySegments(w.from, w.to); }
  protected goTo(i: number): void {
    document.getElementById(`pt-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    this.flashed.set(i);
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => this.flashed.set(null), 1600);
  }

  coordsText(p: Point): string { return p.coords ? p.coords.join(', ') : ''; }
  pickAddress(p: Point, s: AddressSuggestion): void {
    p.address = s.label;
    p.coords = [Math.round(s.lat * 1e5) / 1e5, Math.round(s.lon * 1e5) / 1e5];
  }
  /** A click on the point's map while placing: the new coordinates (the address is kept as typed). */
  protected placed(p: Point, at: [number, number]): void { p.coords = at; this.picking.set(null); }
  clearCoords(p: Point): void { delete p.coords; }
  setCoords(p: Point, text: string): void {
    const parts = text.split(',').map((x) => parseFloat(x.trim()));
    if (parts.length === 2 && parts.every((x) => !isNaN(x))) p.coords = [parts[0], parts[1]];
    else if (!text.trim()) delete p.coords;
  }
  toggle(list: string[], m: string): void {
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
    setTimeout(() => this.goTo(this.draft().length - 1));
  }

  private clean(p: Point): Point {
    const c: any = structuredClone(p);
    if (!c.address) delete c.address;
    if (c.weight === null || c.weight === '' || c.weight === undefined) delete c.weight;
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
