import { Component, Injectable, computed, inject, input, signal } from '@angular/core';
import { SiteLogo } from '../components/site-logo';
import { SitesStore } from '../services/sites.store';
import { fmtKr } from '../format';
import { Listing } from '../models';
import { ValueScaleStore, valueOf } from '../value-scale';

// ── Fields, filters and sorting of the candidates list (pure) ───────────────────────────────────────────────

export type FilterKey = 'score' | 'rent_sek' | 'rent_per_m2' | 'rooms_rok' | 'size_m2' | 'move_in' | 'house_transport' | 'house_services';
/** One range per field; a null end is open (follows the data). `dropUnknown` leaves out homes without the value. */
export interface RangeFilter { lo: number | null; hi: number | null; dropUnknown: boolean; }
export type Filters = Partial<Record<FilterKey, RangeFilter>>;

export interface FilterField { key: FilterKey; label: string; step: number; get: (l: Listing) => number | null; fmt: (v: number) => string; }

const DAY = 86_400_000;
/** An ISO date as a day number (days since 1970-01-01, UTC). */
export const dayOf = (iso: string) => Math.floor(Date.parse(iso.slice(0, 10) + 'T00:00:00Z') / DAY);
export const isoOfDay = (d: number) => new Date(d * DAY).toISOString().slice(0, 10);
const fmtDay = (d: number) => new Date(d * DAY).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export const FILTER_FIELDS: FilterField[] = [
  { key: 'score', label: 'Score', step: 0.01, get: (l) => l.score ?? null, fmt: (v) => v.toFixed(2) },
  { key: 'rent_sek', label: 'Rent', step: 100, get: (l) => l.rent_sek ?? null, fmt: (v) => fmtKr(v) },
  { key: 'rent_per_m2', label: 'Rent per m²', step: 5, get: (l) => valueOf(l, 'rent_per_m2'), fmt: (v) => `${Math.round(v)} kr/m²` },
  { key: 'move_in', label: 'Move in', step: 1, get: (l) => (l.available_from ? dayOf(l.available_from) : null), fmt: fmtDay },
  { key: 'rooms_rok', label: 'Rooms', step: 0.5, get: (l) => l.rooms_rok ?? null, fmt: (v) => `${+v.toFixed(1)} rok` },
  { key: 'size_m2', label: 'Size', step: 1, get: (l) => l.size_m2 ?? null, fmt: (v) => `${Math.round(v)} m²` },
  { key: 'house_transport', label: 'Transport', step: 1, get: (l) => l.house_transport ?? null, fmt: (v) => `${Math.round(v)}` },
  { key: 'house_services', label: 'Services', step: 1, get: (l) => l.house_services ?? null, fmt: (v) => `${Math.round(v)}` },
];
const FIELD = new Map(FILTER_FIELDS.map((f) => [f.key, f]));

export const isActive = (f: RangeFilter | undefined) => !!f && (f.lo != null || f.hi != null || f.dropUnknown);

/** Does a home pass one range? */
export function passes(l: Listing, key: FilterKey, f: RangeFilter | undefined): boolean {
  if (!isActive(f)) return true;
  const v = FIELD.get(key)!.get(l);
  if (v == null) return !f!.dropUnknown;
  return (f!.lo == null || v >= f!.lo - 1e-9) && (f!.hi == null || v <= f!.hi + 1e-9);
}

/** The homes that pass every range, except the one of `skip` (its own histogram shows the others' effect). */
export function applyFilters(rows: Listing[], filters: Filters, skip?: FilterKey): Listing[] {
  const keys = (Object.keys(filters) as FilterKey[]).filter((k) => k !== skip && isActive(filters[k]));
  return keys.length ? rows.filter((l) => keys.every((k) => passes(l, k, filters[k]))) : rows;
}

export type CatKey = 'site' | 'pets' | 'contract';
/** Chosen values per category; an empty or missing list is no filter. */
export type Cats = Partial<Record<CatKey, string[]>>;
export interface CatField { key: CatKey; label: string; values: (l: Listing) => string[]; }
export const CAT_FIELDS: CatField[] = [
  { key: 'site', label: 'Website', values: (l) => [...new Set([l.origin_site, ...(l.found_on ?? [])].filter((x): x is string => !!x))] },
  { key: 'pets', label: 'Pets', values: (l) => [l.pet_status] },
  { key: 'contract', label: 'Contract', values: (l) => [l.contract_type || 'unknown'] },
];
const CAT = new Map(CAT_FIELDS.map((c) => [c.key, c]));
const PET_ORDER = ['yes', 'ask', 'conflict', 'unknown', 'no'];

/** The homes that pass every range and every category (a home on any chosen site, with any chosen pets / contract),
 *  except the filter `skip`. */
export function applyAll(rows: Listing[], filters: Filters, cats: Cats, skip?: FilterKey | CatKey): Listing[] {
  const ranged = applyFilters(rows, filters, skip as FilterKey);
  const keys = (Object.keys(cats) as CatKey[]).filter((k) => k !== skip && cats[k]?.length);
  return keys.length ? ranged.filter((l) => keys.every((k) => CAT.get(k)!.values(l).some((v) => cats[k]!.includes(v)))) : ranged;
}

/**
 * The slider's [min, max] for a field, snapped outwards to its step; null when nobody has a value. With 20 values or
 * more it spans the 2nd to 98th percentile, so a few outliers do not squash the chart: an end left at the edge is
 * open, so the homes beyond it stay in, and the edge bars count them.
 */
export function domainOf(rows: Listing[], field: FilterField, clip = 0.02): [number, number] | null {
  const vals: number[] = [];
  for (const l of rows) { const v = field.get(l); if (v != null) vals.push(v); }
  if (!vals.length) return null;
  vals.sort((a, b) => a - b);
  const cut = vals.length >= 20 ? Math.floor(vals.length * clip) : 0;
  const min = vals[cut], max = vals[vals.length - 1 - cut];
  const s = field.step;
  return [+(Math.floor(min / s) * s).toFixed(4), +(Math.ceil(max / s) * s).toFixed(4)];
}

/** A bar: its value span, or its single `value` when the field has one bar per step (rooms, a short range). */
export interface Bin { from: number; to: number; value?: number; count: number; inRange: number; }

/** Counts per bin over [min, max], and how many of each fall inside [lo, hi]. Discrete fields get one bin per step. */
export function histogram(values: number[], [min, max]: [number, number], step: number, lo: number, hi: number, most = 28): Bin[] {
  const span = max - min, steps = Math.round(span / step) + 1;
  const discrete = steps <= most;
  // a long range: bars of a whole number of steps (round edges such as 9 000 – 10 000 kr), as many as fit in `most`
  const n = discrete ? steps : Math.max(1, Math.ceil(span / (Math.ceil(span / most / step) * step)));
  const w = discrete ? span / n || 1 : Math.ceil(span / most / step) * step;
  const bins: Bin[] = Array.from({ length: n }, (_, i) => ({ from: min + i * w, to: Math.min(max, min + (i + 1) * w), count: 0, inRange: 0,
    ...(discrete ? { value: +(min + i * step).toFixed(4) } : {}) }));
  for (const v of values) {
    const i = Math.min(n - 1, Math.max(0, Math.floor((v - min) / w)));
    bins[i].count++;
    if (v >= lo - 1e-9 && v <= hi + 1e-9) bins[i].inRange++;
  }
  return bins;
}

export type SortKey = 'score' | 'transport' | 'services' | 'status' | 'area' | 'move_in' | 'rooms' | 'size' | 'rent' | 'per_m2' | 'pets' | 'contract';
export interface Sort { key: SortKey; dir: 1 | -1; }
const PET_RANK: Record<string, number> = { yes: 4, ask: 3, conflict: 2, unknown: 1, no: 0 };
/** Each column's value and the direction of its first click (the better end first). */
export const SORTS: Record<SortKey, { get: (l: Listing) => number | string | null; first: 1 | -1 }> = {
  score: { get: (l) => l.score ?? null, first: -1 },
  transport: { get: (l) => l.house_transport ?? null, first: -1 },
  services: { get: (l) => l.house_services ?? null, first: -1 },
  status: { get: (l) => l.status, first: 1 },
  area: { get: (l) => (l.area ?? l.address_raw ?? '').toLowerCase() || null, first: 1 },
  move_in: { get: (l) => l.available_from ?? null, first: 1 },
  rooms: { get: (l) => l.rooms_rok ?? null, first: -1 },
  size: { get: (l) => l.size_m2 ?? null, first: -1 },
  rent: { get: (l) => l.rent_sek ?? null, first: 1 },
  per_m2: { get: (l) => valueOf(l, 'rent_per_m2'), first: 1 },
  pets: { get: (l) => PET_RANK[l.pet_status] ?? 1, first: -1 },
  contract: { get: (l) => l.contract_type ?? null, first: 1 },
};

/** Sorted copy: homes without the value last in both directions; ties keep the server's order (score, then newest). */
export function sortRows(rows: Listing[], s: Sort): Listing[] {
  const get = SORTS[s.key].get;
  return rows.map((l, i) => ({ l, i, v: get(l) })).sort((a, b) => {
    if (a.v == null || b.v == null) return a.v == null && b.v == null ? a.i - b.i : a.v == null ? 1 : -1;
    const c = a.v < b.v ? -1 : a.v > b.v ? 1 : 0;
    return c ? c * s.dir : a.i - b.i;
  }).map((x) => x.l);
}

// ── State shared by the list, its Filters bubble and the listing page ───────────────────────────────────────

/** Filters, sort and "hide rejected" of the candidates list: kept while you open homes and come back. */
@Injectable({ providedIn: 'root' })
export class CandidateFiltersStore {
  readonly filters = signal<Filters>({});
  readonly cats = signal<Cats>({});
  readonly sort = signal<Sort>({ key: 'score', dir: -1 });
  readonly hideRejected = signal(false);
  /** The list's homes before the ranges (server filters and "hide rejected" applied): the bubble's distributions. */
  readonly base = signal<Listing[]>([]);
  /** Set for a moment when the list reloads after "hide rejected": the charts open and animate to the new data. */
  readonly pulse = signal(false);
  readonly active = computed(() => (Object.values(this.filters()) as RangeFilter[]).filter(isActive).length
    + Object.values(this.cats()).filter((v) => v?.length).length);

  set(key: FilterKey, f: RangeFilter | null): void {
    this.filters.update((all) => { const next = { ...all }; if (f && isActive(f)) next[key] = f; else delete next[key]; return next; });
  }
  clear(): void { this.filters.set({}); this.cats.set({}); }
  /** Adds or removes one value of a category. */
  toggleCat(key: CatKey, value: string): void {
    this.cats.update((all) => {
      const cur = all[key] ?? [], next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
      const out = { ...all }; if (next.length) out[key] = next; else delete out[key]; return out;
    });
  }
  sortBy(key: SortKey): void {
    const s = this.sort();
    this.sort.set(s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: SORTS[key].first });
  }
  private pulseTimer: ReturnType<typeof setTimeout> | null = null;
  flash(ms = 1800): void {
    if (this.pulseTimer) clearTimeout(this.pulseTimer);
    this.pulse.set(true);
    this.pulseTimer = setTimeout(() => this.pulse.set(false), ms);
  }
}

// ── The Filters bubble: one two-ended slider per field, its distribution on hover ───────────────────────────

interface View {
  f: FilterField; dom: [number, number] | null; lo: number; hi: number; on: boolean; drop: boolean;
  /** Open ends with homes beyond the slider's reach (outliers): shown as ≤ / +. */
  below: boolean; above: boolean;
  bins: Bin[]; peak: number; inCount: number; unknown: number; a: number; b: number;
}

interface CatView { c: CatField; on: boolean; chips: { v: string; n: number; sel: boolean }[]; }
interface Tip { key: FilterKey; x: number; y: number; edge: 'l' | 'r' | null; head: string; body: string; }

@Component({
  selector: 'fh-candidate-filters',
  imports: [SiteLogo],
  template: `
  <div class="fh-cf-top">
    <span><b>{{ count() }}</b> of {{ store.base().length }} homes</span>
    @if (store.active()) { <button type="button" class="btn btn-link btn-sm p-0 ms-auto" (click)="store.clear()">reset {{ store.active() }} filter{{ store.active() === 1 ? '' : 's' }}</button> }
  </div>
  @for (v of views(); track v.f.key) {
    <div class="fh-rf" [class.on]="v.on" [class.show]="store.pulse()" [class.flat]="!v.dom || v.dom[0] === v.dom[1]">
      <div class="fh-rf-head">
        <span class="fh-rf-label">{{ v.f.label }}</span>
        @if (v.dom) { <span class="fh-rf-val">{{ v.below ? '≤ ' : '' }}{{ v.f.fmt(v.lo) }} – {{ v.f.fmt(v.hi) }}{{ v.above ? '+' : '' }}</span> } @else { <span class="fh-rf-val">no values</span> }
        @if (v.on) { <button type="button" class="fh-rf-x" title="Clear this filter" [attr.aria-label]="'Clear ' + v.f.label" (click)="store.set(v.f.key, null)">✕</button> }
      </div>
      @if (v.dom && v.dom[0] !== v.dom[1]) {
        @if (tip(); as t) { @if (t.key === v.f.key) {
          <div class="fh-rf-tip" [class.l]="t.edge === 'l'" [class.r]="t.edge === 'r'" [style.left.px]="t.x" [style.top.px]="t.y" role="tooltip">
            <b>{{ t.head }}</b><span>{{ t.body }}</span></div>
        } }
        <div class="fh-rf-chart" aria-hidden="true" (mouseleave)="tip.set(null)">
          @for (b of v.bins; track $index) {
            <div class="fh-rf-col" [style.--i]="$index" [class.hot]="tip()?.key === v.f.key && tipBin === $index" (mouseenter)="showTip(v, b, $index, $event)">
              <i class="fh-rf-bar" [style.height.%]="v.peak ? (b.count / v.peak) * 100 : 0"><b [style.height.%]="b.count ? (b.inRange / b.count) * 100 : 0"></b></i>
            </div>
          }
        </div>
        <div class="fh-rf-slider" [style.--a]="v.a" [style.--b]="v.b">
          <input type="range" [min]="v.dom[0]" [max]="v.dom[1]" [step]="v.f.step" [value]="v.lo" [attr.aria-label]="v.f.label + ' from'"
            (input)="move(v, 'lo', $any($event.target))" />
          <input type="range" [min]="v.dom[0]" [max]="v.dom[1]" [step]="v.f.step" [value]="v.hi" [attr.aria-label]="v.f.label + ' to'"
            (input)="move(v, 'hi', $any($event.target))" />
        </div>
        <div class="fh-rf-foot">
          <span>{{ v.inCount }} in range</span>
          @if (v.f.key === 'move_in' && window(); as w) { <button type="button" class="btn btn-link btn-sm p-0" (click)="useWindow(v, w)"
            title="Your move-in window in config/profile.yaml">your window</button> }
          @if (v.unknown) {
            <label class="ms-auto" [title]="'Homes without a ' + v.f.label.toLowerCase() + ': keep them in the list or leave them out'">
              <input type="checkbox" [checked]="!v.drop" (change)="keepUnknown(v, $any($event.target).checked)" /> +{{ v.unknown }} no value</label>
          }
        </div>
      }
    </div>
  }
  @for (g of cats(); track g.c.key) {
    <div class="fh-cg" [class.on]="g.on">
      <div class="fh-rf-head"><span class="fh-rf-label">{{ g.c.label }}</span>
        @if (g.on) { <button type="button" class="fh-rf-x ms-auto" title="Clear this filter" [attr.aria-label]="'Clear ' + g.c.label" (click)="clearCat(g.c.key)">✕</button> }</div>
      <div class="fh-chips">
        @for (ch of g.chips; track ch.v) {
          <button type="button" [class]="'fh-chipf ' + chipTone(g.c.key, ch.v)" [class.sel]="ch.sel" [class.zero]="!ch.n"
            [attr.aria-pressed]="ch.sel" (click)="store.toggleCat(g.c.key, ch.v)"
            [title]="(ch.sel ? 'Remove ' : 'Keep only homes with ') + chipLabel(g.c.key, ch.v) + ' (' + ch.n + ' with the other filters)'">
            @if (g.c.key === 'site') { <fh-site-logo [slug]="ch.v" /> } @else { <i class="fh-chipf-dot"></i> }
            <span class="fh-chipf-t">{{ chipLabel(g.c.key, ch.v) }}</span><span class="fh-chipf-n">{{ ch.n }}</span></button>
        }
      </div>
    </div>
  }`,
  styles: [`
    :host { display: block; --rf-hot: linear-gradient(180deg, #ff6ad5 0%, #c43dff 45%, #6a5cff 100%); }
    .fh-cf-top { display: flex; align-items: baseline; gap: 6px; font-size: .8rem; color: var(--bs-secondary-color); margin-bottom: 6px; }
    .fh-cf-top b { color: var(--bs-body-color); }
    .fh-rf { padding: 6px 8px 4px; margin: 0 -8px 2px; border-radius: 8px; transition: background .2s; }
    .fh-rf:hover, .fh-rf:focus-within { background: var(--fh-hover); }
    .fh-rf-head { display: flex; align-items: baseline; gap: 6px; font-size: .8rem; }
    .fh-rf-label { font-weight: 600; }
    .fh-rf-val { color: var(--bs-secondary-color); font-variant-numeric: tabular-nums; margin-left: auto; font-size: .76rem; }
    .fh-rf.on .fh-rf-val { color: var(--fh-violet); font-weight: 600; }
    .fh-rf-x { border: 0; background: none; padding: 0 2px; color: var(--bs-secondary-color); font-size: .72rem; line-height: 1; }
    .fh-rf-x:hover { color: var(--fh-bad); }
    .fh-rf.flat { opacity: .6; }

    /* the distribution: folded away, it grows open on hover (and for a moment after "hide rejected") */
    .fh-rf-chart { display: flex; align-items: flex-end; gap: 2px; padding: 0 7px; height: 0; opacity: 0; overflow: hidden;
      transition: height .35s cubic-bezier(.2,.8,.2,1), opacity .25s, margin .35s; }
    .fh-rf:hover .fh-rf-chart, .fh-rf:focus-within .fh-rf-chart, .fh-rf.show .fh-rf-chart { height: 58px; opacity: 1; margin-top: 6px; }
    .fh-rf-col { flex: 1; height: 100%; display: flex; align-items: flex-end; min-width: 0; }
    .fh-rf-bar { position: relative; display: block; width: 100%; min-height: 0; border-radius: 4px 4px 0 0;
      background: color-mix(in srgb, var(--bs-secondary-color) 28%, transparent);
      transform: scaleY(0); transform-origin: bottom;
      transition: transform .55s cubic-bezier(.25,1.35,.45,1) calc(var(--i) * 14ms), height .5s cubic-bezier(.2,.8,.2,1); }
    .fh-rf-bar b { position: absolute; left: 0; right: 0; bottom: 0; border-radius: inherit; background: var(--rf-hot);
      background-size: 100% 200%; box-shadow: 0 0 8px rgba(196, 61, 255, .55); transition: height .5s cubic-bezier(.2,.8,.2,1);
      animation: fh-rf-shine 2.4s ease-in-out infinite alternate; }
    .fh-rf:hover .fh-rf-bar, .fh-rf:focus-within .fh-rf-bar, .fh-rf.show .fh-rf-bar { transform: scaleY(1); }
    @keyframes fh-rf-shine { from { background-position: 0 0; filter: saturate(1); } to { background-position: 0 100%; filter: saturate(1.35) brightness(1.12); } }

    /* two thumbs on one track: the inputs let clicks through except on their thumbs */
    .fh-rf-slider { position: relative; height: 22px; margin-top: 2px; }
    .fh-rf-slider::before, .fh-rf-slider::after { content: ''; position: absolute; top: 9px; height: 4px; border-radius: 2px; }
    .fh-rf-slider::before { left: 7px; right: 7px; background: var(--bs-border-color); }
    .fh-rf-slider::after { left: calc(7px + (100% - 14px) * var(--a) / 100); right: calc(7px + (100% - 14px) * (100 - var(--b)) / 100);
      background: linear-gradient(90deg, #ff6ad5, #c43dff, #6a5cff); box-shadow: 0 0 6px rgba(196, 61, 255, .5); opacity: .45; transition: opacity .2s; }
    .fh-rf.on .fh-rf-slider::after, .fh-rf:hover .fh-rf-slider::after { opacity: 1; }
    .fh-rf-slider input { position: absolute; inset: 0; width: 100%; height: 22px; margin: 0; background: none; pointer-events: none;
      -webkit-appearance: none; appearance: none; z-index: 1; }
    .fh-rf-slider input::-webkit-slider-runnable-track { background: none; height: 22px; }
    .fh-rf-slider input::-moz-range-track { background: none; }
    .fh-rf-slider input::-webkit-slider-thumb { -webkit-appearance: none; pointer-events: auto; width: 14px; height: 14px; margin-top: 4px;
      border-radius: 50%; background: #fff; border: 2px solid #c43dff; box-shadow: 0 0 0 3px rgba(196, 61, 255, .2); cursor: grab; }
    .fh-rf-slider input::-moz-range-thumb { pointer-events: auto; width: 12px; height: 12px; border-radius: 50%; background: #fff;
      border: 2px solid #c43dff; box-shadow: 0 0 0 3px rgba(196, 61, 255, .2); cursor: grab; }
    .fh-rf-slider input:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 4px rgba(196, 61, 255, .5); }
    .fh-rf-slider input:active::-webkit-slider-thumb { cursor: grabbing; transform: scale(1.15); }
    .fh-rf-foot { display: flex; align-items: center; gap: 8px; white-space: nowrap; font-size: .72rem; color: var(--bs-secondary-color); }
    .fh-rf-foot label { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
    .fh-rf-foot .btn-link { font-size: .72rem; }
    .fh-rf { position: relative; }
    .fh-rf-col.hot .fh-rf-bar { filter: brightness(1.35); box-shadow: 0 0 0 1px rgba(255,255,255,.55); }
    .fh-rf-tip { position: absolute; z-index: 5; transform: translate(-50%, calc(-100% - 6px)); pointer-events: none; white-space: nowrap;
      display: flex; flex-direction: column; gap: 1px; padding: 4px 9px; border-radius: 8px; font-size: .72rem; line-height: 1.25;
      color: #fff; background: linear-gradient(135deg, #2a1640 0%, #1b1430 100%); border: 1px solid rgba(196, 61, 255, .6);
      box-shadow: 0 0 0 3px rgba(196, 61, 255, .15), 0 6px 18px -4px rgba(196, 61, 255, .6); animation: fh-rf-pop .14s ease-out; }
    .fh-rf-tip.l { transform: translate(-12px, calc(-100% - 6px)); }
    .fh-rf-tip.r { transform: translate(calc(-100% + 12px), calc(-100% - 6px)); }
    .fh-rf-tip b { font-weight: 700; } .fh-rf-tip span { color: #e2c9ff; }
    @keyframes fh-rf-pop { from { opacity: 0; margin-top: 4px; } to { opacity: 1; margin-top: 0; } }

    /* category chips: the bright badge look, outlined until chosen, then filled and glowing */
    .fh-cg { padding: 6px 0 4px; border-top: 1px dashed var(--bs-border-color); margin-top: 4px; }
    .fh-chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 5px; }
    .fh-chipf { --c1: #ff6ad5; --c2: #c43dff; --c3: #6a5cff; --glow: rgba(196, 61, 255, .6);
      display: inline-flex; align-items: center; gap: 5px; padding: 2px 9px 2px 6px; border-radius: 999px; font-size: .74rem; font-weight: 700;
      cursor: pointer; color: var(--c2); background: transparent; border: 1.5px solid var(--c2);
      transition: background .2s, color .2s, box-shadow .2s, transform .12s, opacity .2s; }
    .fh-chipf:hover { transform: translateY(-1px); box-shadow: 0 0 0 3px color-mix(in srgb, var(--c2) 18%, transparent); }
    .fh-chipf.sel { color: #fff; border-color: var(--c2); background: linear-gradient(135deg, var(--c1) 0%, var(--c2) 50%, var(--c3) 100%);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--c2) 22%, transparent), 0 4px 14px -4px var(--glow); text-shadow: 0 1px 1px rgba(0,0,0,.25); }
    .fh-chipf.zero:not(.sel) { opacity: .4; }
    .fh-chipf-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--c2); box-shadow: 0 0 5px var(--c2); }
    .fh-chipf.sel .fh-chipf-dot { background: #fff; box-shadow: 0 0 6px #fff; }
    .fh-chipf { max-width: 100%; white-space: nowrap; }
    .fh-chipf-t { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
    .fh-chipf-n { font-weight: 500; opacity: .75; font-variant-numeric: tabular-nums; }
    .fh-chipf.t-yes { --c1: #5cf2a0; --c2: #16c172; --c3: #0b9b5a; --glow: rgba(22, 193, 114, .65); }
    .fh-chipf.t-no { --c1: #ff7a8f; --c2: #ff2d55; --c3: #d70f3d; --glow: rgba(255, 45, 85, .65); }
    .fh-chipf.t-ask { --c1: #ffd36b; --c2: #ffa51f; --c3: #f07b00; --glow: rgba(255, 165, 31, .65); }
    .fh-chipf.t-unknown { --c1: #c9c9d6; --c2: #9494a8; --c3: #6e6e82; --glow: rgba(148, 148, 168, .55); }
    .fh-chipf.t-conflict { --c1: #ff6ad5; --c2: #e040fb; --c3: #a020f0; }
    .fh-chipf.t-contract { --c1: #6ff3ff; --c2: #19b8e6; --c3: #2f6bff; --glow: rgba(25, 184, 230, .6); }

    @media (prefers-reduced-motion: reduce) {
      .fh-rf-chart, .fh-rf-bar, .fh-rf-bar b { transition: none; animation: none; }
    }
  `],
})
export class CandidateFilters {
  protected store = inject(CandidateFiltersStore);
  private values = inject(ValueScaleStore);
  private sites = inject(SitesStore);
  /** The bar under the mouse: its value span and how many homes it holds. */
  protected tip = signal<Tip | null>(null);
  protected tipBin = -1;
  /** How many homes the list shows (all ranges applied). */
  readonly count = input(0);
  protected window = computed(() => this.values.scale()?.move_in ?? null);

  protected views = computed<View[]>(() => {
    const base = this.store.base(), filters = this.store.filters(), cats = this.store.cats();
    return FILTER_FIELDS.map((f) => {
      const dom = domainOf(base, f), cur = filters[f.key];
      const lo = Math.max(dom?.[0] ?? 0, cur?.lo ?? dom?.[0] ?? 0), hi = Math.min(dom?.[1] ?? 0, cur?.hi ?? dom?.[1] ?? 0);
      const others = applyAll(base, filters, cats, f.key);
      const vals: number[] = [];
      let unknown = 0;
      for (const l of others) { const v = f.get(l); if (v == null) unknown++; else vals.push(v); }
      const bins = dom ? histogram(vals, dom, f.step, cur?.lo ?? -Infinity, cur?.hi ?? Infinity) : [];
      const below = dom && cur?.lo == null && vals.some((x) => x < dom[0]), above = dom && cur?.hi == null && vals.some((x) => x > dom[1]);
      const span = dom ? dom[1] - dom[0] || 1 : 1;
      return { f, dom, lo, hi, below: !!below, above: !!above, on: isActive(cur), drop: !!cur?.dropUnknown, bins, unknown,
        peak: Math.max(0, ...bins.map((b) => b.count)), inCount: bins.reduce((a, b) => a + b.inRange, 0),
        a: dom ? ((lo - dom[0]) / span) * 100 : 0, b: dom ? ((hi - dom[0]) / span) * 100 : 100 };
    });
  });

  /** The chip groups: every value present in the list, counted among the homes that pass the other filters. */
  protected cats = computed<CatView[]>(() => {
    const base = this.store.base(), filters = this.store.filters(), cats = this.store.cats();
    return CAT_FIELDS.map((c) => {
      const all = new Set<string>(), n = new Map<string, number>();
      for (const l of base) for (const v of c.values(l)) all.add(v);
      for (const l of applyAll(base, filters, cats, c.key)) for (const v of c.values(l)) n.set(v, (n.get(v) ?? 0) + 1);
      const sel = cats[c.key] ?? [];
      const order = c.key === 'pets' ? (a: string, b: string) => PET_ORDER.indexOf(a) - PET_ORDER.indexOf(b)
        : (a: string, b: string) => (n.get(b) ?? 0) - (n.get(a) ?? 0) || a.localeCompare(b);
      return { c, on: sel.length > 0, chips: [...all].sort(order).map((v) => ({ v, n: n.get(v) ?? 0, sel: sel.includes(v) })) };
    });
  });
  protected chipLabel(key: CatKey, v: string): string {
    if (key === 'site') return this.sites.name(v);
    return v.replace(/_/g, '-');
  }
  protected chipTone(key: CatKey, v: string): string { return key === 'pets' ? `t-${v}` : key === 'contract' ? 't-contract' : ''; }
  protected clearCat(key: CatKey): void { this.store.cats.update((all) => { const o = { ...all }; delete o[key]; return o; }); }

  /** The tooltip of a bar, above it inside the slider's block (kept inside the bubble at both ends). */
  protected showTip(v: View, b: Bin, i: number, ev: MouseEvent): void {
    const col = ev.currentTarget as HTMLElement, box = col.closest('.fh-rf') as HTMLElement, chart = col.parentElement as HTMLElement;
    const c = col.getBoundingClientRect(), r = box.getBoundingClientRect(), top = chart.getBoundingClientRect().top - r.top;
    const x = c.left + c.width / 2 - r.left;
    this.tipBin = i;
    const head = b.value != null ? v.f.fmt(b.value) : `${v.f.fmt(b.from)} – ${v.f.fmt(b.to)}`;
    const first = i === 0 && v.below, last = i === v.bins.length - 1 && v.above;
    this.tip.set({ key: v.f.key, x, y: top, edge: x < 70 ? 'l' : x > r.width - 70 ? 'r' : null,
      head: (first ? '≤ ' : '') + head + (last ? ' and above' : ''),
      body: `${b.count} home${b.count === 1 ? '' : 's'}` + (b.count && b.inRange !== b.count ? ` · ${b.inRange} in your range` : '') });
  }

  /** A thumb moved: the ends never cross; an end back at the edge of the data is open again. */
  protected move(v: View, end: 'lo' | 'hi', el: HTMLInputElement): void {
    if (!v.dom) return;
    let x = +el.value;
    if (end === 'lo' && x > v.hi) { x = v.hi; el.value = String(x); }
    if (end === 'hi' && x < v.lo) { x = v.lo; el.value = String(x); }
    const cur = this.store.filters()[v.f.key] ?? { lo: null, hi: null, dropUnknown: false };
    const open = end === 'lo' ? x <= v.dom[0] : x >= v.dom[1];
    this.store.set(v.f.key, { ...cur, [end]: open ? null : x });
  }
  protected keepUnknown(v: View, keep: boolean): void {
    const cur = this.store.filters()[v.f.key] ?? { lo: null, hi: null, dropUnknown: false };
    this.store.set(v.f.key, { ...cur, dropUnknown: !keep });
  }
  protected useWindow(v: View, w: { from: string | null; to: string | null }): void {
    this.store.set(v.f.key, { lo: w.from ? dayOf(w.from) : null, hi: w.to ? dayOf(w.to) : null, dropUnknown: v.drop });
  }
}
