import { Component, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Listing } from '../models';
import { valueOf } from '../value-scale';

// ── The Candidates columns: which are shown and in what order (autosaved), named views, the default ──────────────

export type ColumnGroup = 'main' | 'building' | 'contract' | 'ad' | 'score';
export const GROUP_LABEL: Record<ColumnGroup, string> = {
  main: 'Default columns', building: 'Building & flat', contract: 'Contract & dates', ad: 'Ad & data quality',
  score: 'Score parts',
};

export interface ColumnDef {
  key: string; label: string; group: ColumnGroup; tip?: string; cls?: string;
  /** The value the column sorts by, and the direction of its first click (the better end first). */
  sort: (l: Listing) => number | string | null; first: 1 | -1;
}

type Attrs = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
const attrs = (l: Listing): Attrs => (l.attributes ?? {}) as Attrs;
const terms = (l: Listing): Attrs => attrs(l)['contract_terms'] ?? {};
const PET_RANK: Record<string, number> = { yes: 4, ask: 3, conflict: 2, unknown: 1, no: 0 };
const bool = (v: boolean | null | undefined) => (v == null ? null : v ? 1 : 0);
/** A score group's 0..1 value from the breakdown (null when the group returned none). */
export const part = (l: Listing, g: string): number | null => l.breakdown?.[g]?.score ?? null;

/** Every column, in the default order first (today's layout), then the ones you can add. */
export const COLUMNS: ColumnDef[] = [
  { key: 'score', label: 'Score', group: 'main', sort: (l) => l.score ?? null, first: -1 },
  { key: 'transport', label: 'Transport', group: 'main', cls: 'text-center', first: -1, sort: (l) => l.house_transport ?? null,
    tip: 'The home\'s transport score, 0-100, from its exact address: walks to rail and bus, lines and departures nearby. Click to sort.' },
  { key: 'services', label: 'Services', group: 'main', cls: 'text-center', first: -1, sort: (l) => l.house_services ?? null,
    tip: 'The home\'s services score, 0-100, from its exact address: walks to groceries, pharmacy, gym, park, vet and how many are near. Click to sort.' },
  { key: 'status', label: 'Status', group: 'main', sort: (l) => l.status, first: 1 },
  { key: 'area', label: 'Area / address', group: 'main', sort: (l) => (l.area ?? l.address_raw ?? '').toLowerCase() || null, first: 1 },
  { key: 'move_in', label: 'Move in', group: 'main', first: 1, sort: (l) => l.available_from ?? null,
    tip: 'The move-in date the ad gives, against your window in config/profile.yaml (move_in_from → move_in_to): green inside, amber before, red after (rejected). Click to sort.' },
  { key: 'issues', label: 'Issues', group: 'main', cls: 'text-center', first: 1, sort: (l) => l.issue_codes?.length ?? 0,
    tip: 'What the listing is missing (move-in, photos, floor plan, street number …): hover the badge for each issue and whether the ad lacks it or the extraction should be checked. Click to sort.' },
  { key: 'rooms', label: 'Rooms', group: 'main', sort: (l) => l.rooms_rok ?? null, first: -1 },
  { key: 'size', label: 'm²', group: 'main', sort: (l) => l.size_m2 ?? null, first: -1 },
  { key: 'rent', label: 'Rent', group: 'main', sort: (l) => l.rent_sek ?? null, first: 1 },
  { key: 'per_m2', label: 'kr/m²', group: 'main', sort: (l) => valueOf(l, 'rent_per_m2'), first: 1 },
  { key: 'pets', label: 'Pets', group: 'main', sort: (l) => PET_RANK[l.pet_status] ?? 1, first: -1 },
  { key: 'contract', label: 'Contract', group: 'main', sort: (l) => l.contract_type ?? null, first: 1 },
  // building & flat
  { key: 'floor', label: 'Floor', group: 'building', cls: 'text-center', sort: (l) => l.floor ?? null, first: 1 },
  { key: 'lift', label: 'Lift', group: 'building', cls: 'text-center', sort: (l) => bool(l.has_elevator), first: -1 },
  { key: 'balcony', label: 'Balcony', group: 'building', cls: 'text-center', sort: (l) => bool(l.has_balcony), first: -1 },
  { key: 'build_year', label: 'Built', group: 'building', cls: 'text-center', sort: (l) => l.build_year ?? null, first: -1 },
  { key: 'furnished', label: 'Furnished', group: 'building', cls: 'text-center', first: -1,
    sort: (l) => bool((l as Listing & { furnished?: boolean | null }).furnished) },
  { key: 'sovalkov', label: 'Alcove', group: 'building', cls: 'text-center', sort: (l) => bool(l.has_sovalkov), first: -1,
    tip: 'A sleeping alcove (sovalkov). Click to sort.' },
  // contract & dates
  { key: 'contract_start', label: 'Contract from', group: 'contract', sort: (l) => l.contract_start ?? null, first: 1 },
  { key: 'contract_end', label: 'Contract to', group: 'contract', sort: (l) => l.contract_end ?? null, first: -1 },
  { key: 'guaranteed', label: 'Guaranteed', group: 'contract', cls: 'text-center', first: -1,
    sort: (l) => terms(l)['guaranteed_months'] ?? null, tip: 'Guaranteed months of the contract, as the ad states them. Click to sort.' },
  { key: 'notice', label: 'Notice', group: 'contract', cls: 'text-center', sort: (l) => terms(l)['notice_months'] ?? null, first: 1,
    tip: 'Notice period in months, as the ad states it. Click to sort.' },
  { key: 'short_term', label: 'Short-term', group: 'contract', cls: 'text-center', sort: (l) => bool(terms(l)['short_term']), first: 1 },
  { key: 'apply_by', label: 'Apply by', group: 'contract', sort: (l) => attrs(l)['apply_by'] ?? null, first: 1,
    tip: 'Bostadsförmedlingen: the last day to register interest. Click to sort.' },
  { key: 'move_in_raw', label: 'Move-in wording', group: 'contract', sort: (l) => attrs(l)['move_in_raw'] ?? null, first: 1,
    tip: 'The ad\'s own move-in words ("Nu", "1 dec", "Nu → Tillsvidare"). Click to sort.' },
  { key: 'deposit', label: 'Deposit', group: 'contract', sort: (l) => l.deposit_sek ?? null, first: 1 },
  // ad & data quality
  { key: 'ad_status', label: 'Ad status', group: 'ad', first: -1,
    sort: (l) => (l.ad_sources ?? []).filter((s) => s.status === 'open').length,
    tip: 'Whether you can still apply, on each site the home was found on. Click to sort (open first).' },
  { key: 'ad_checked', label: 'Confirmed', group: 'ad', sort: (l) => l.ad_checked_at ?? null, first: -1,
    tip: 'When a scan or a status check last confirmed the ad is open. Click to sort.' },
  { key: 'found_on', label: 'Found on', group: 'ad', sort: (l) => (l.found_on ?? []).join(',') || null, first: 1 },
  { key: 'first_seen', label: 'First seen', group: 'ad', sort: (l) => l.first_seen_at ?? null, first: -1 },
  { key: 'last_changed', label: 'Changed', group: 'ad', sort: (l) => l.last_changed_at ?? null, first: -1 },
  { key: 'photos', label: 'Photos', group: 'ad', cls: 'text-center', sort: (l) => l.photo_urls?.length ?? 0, first: -1 },
  { key: 'plan', label: 'Plan', group: 'ad', cls: 'text-center', first: -1,
    sort: (l) => (l.floorplan_urls?.length || (attrs(l)['floorplans'] ?? []).length ? 1 : 0) },
  // score parts
  ...(['cost', 'space', 'commute', 'cat_suitability', 'area', 'building_comfort', 'contract_availability'] as const).map((g) => ({
    key: `part_${g}`, label: g === 'cat_suitability' ? 'Cats' : g === 'building_comfort' ? 'Building' :
      g === 'contract_availability' ? 'Contract fit' : g[0].toUpperCase() + g.slice(1),
    group: 'score' as ColumnGroup, cls: 'text-center', first: -1 as const, sort: (l: Listing) => part(l, g),
    tip: `The ${g.replace(/_/g, ' ')} part of the score, 0-100 (config/profile.yaml preferences.${g}). Click to sort.`,
  })),
  { key: 'zone', label: 'Zone', group: 'score', sort: (l) => l.zone_name ?? null, first: 1 },
];
export const COLUMN = new Map(COLUMNS.map((c) => [c.key, c]));
/** Today's layout: the default view, restored by Reset. */
export const DEFAULT_COLUMNS = COLUMNS.filter((c) => c.group === 'main').map((c) => c.key);

const LAYOUT_KEY = 'candidates.columns', VIEWS_KEY = 'candidates.views';

/** The shown columns in order (autosaved to the app database, ui_settings) and your named views. */
@Injectable({ providedIn: 'root' })
export class ColumnsStore {
  private http = inject(HttpClient);
  readonly visible = signal<string[]>(DEFAULT_COLUMNS);
  readonly views = signal<Record<string, string[]>>({});
  readonly defs = computed(() => this.visible().map((k) => COLUMN.get(k)!).filter(Boolean));
  readonly isDefault = computed(() => this.visible().join() === DEFAULT_COLUMNS.join());
  private loaded = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // autosave: the layout half a second after the last change, once the saved one has been loaded
    effect(() => {
      const v = this.visible();
      untracked(() => {
        if (!this.loaded) return;
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => this.put(LAYOUT_KEY, v), 500);
      });
    });
  }

  load(): void {
    if (this.loaded) return;
    this.http.get<{ value: string[] | null }>(`/api/ui-settings/${LAYOUT_KEY}`).subscribe({
      next: (r) => { const v = clean(r.value); if (v) this.visible.set(v); this.loaded = true; },
      error: () => { this.loaded = true; },
    });
    this.http.get<{ value: Record<string, string[]> | null }>(`/api/ui-settings/${VIEWS_KEY}`).subscribe({
      next: (r) => this.views.set(Object.fromEntries(Object.entries(r.value ?? {}).map(([n, v]) => [n, clean(v) ?? DEFAULT_COLUMNS]))),
      error: () => {},
    });
  }

  toggle(key: string): void {
    this.visible.update((v) => (v.includes(key) ? (v.length > 1 ? v.filter((k) => k !== key) : v) : [...v, key]));
  }
  /** Move a shown column by `step` places (−1 left, +1 right). */
  move(key: string, step: number): void {
    this.visible.update((v) => {
      const i = v.indexOf(key), j = i + step;
      if (i < 0 || j < 0 || j >= v.length) return v;
      const out = [...v];
      [out[i], out[j]] = [out[j], out[i]];
      return out;
    });
  }
  /** Drop `key` before `target` (drag and drop). */
  place(key: string, target: string): void {
    if (key === target) return;
    this.visible.update((v) => {
      const out = v.filter((k) => k !== key);
      out.splice(Math.max(0, out.indexOf(target)), 0, key);
      return out;
    });
  }
  reset(): void { this.visible.set(DEFAULT_COLUMNS); }
  saveView(name: string): void {
    const n = name.trim();
    if (!n) return;
    this.views.update((all) => ({ ...all, [n]: this.visible() }));
    this.put(VIEWS_KEY, this.views());
  }
  applyView(name: string): void { const v = this.views()[name]; if (v) this.visible.set(v); }
  deleteView(name: string): void {
    this.views.update((all) => { const o = { ...all }; delete o[name]; return o; });
    this.put(VIEWS_KEY, this.views());
  }
  private put(key: string, value: unknown): void {
    this.http.put(`/api/ui-settings/${key}`, { value }).subscribe({ error: () => {} });
  }
}

/** A saved layout without the keys that no longer exist; null when nothing usable is left. */
function clean(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const keys = v.filter((k): k is string => typeof k === 'string' && COLUMN.has(k));
  return keys.length ? [...new Set(keys)] : null;
}

/**
 * The Columns bubble (box 1, under Filters): the shown columns in order (drag a row, or ↑ ↓), the others by group
 * to add, your named views, and Reset to today's layout. Every change is saved at once.
 */
@Component({
  selector: 'fh-candidate-columns',
  imports: [FormsModule],
  template: `
  <div class="fh-cols">
    <div class="fh-cols-head">
      <span class="fh-rf-label">Shown, in order</span>
      <button type="button" class="fh-btn-ghost ms-auto" [disabled]="store.isDefault()" (click)="store.reset()"
              title="Back to the default columns and order">Reset</button>
    </div>
    <ol class="fh-cols-list">
      @for (c of store.defs(); track c.key; let first = $first; let last = $last) {
        <li draggable="true" [class.drag-over]="over() === c.key" (dragstart)="drag = c.key" (dragend)="over.set(null)"
            (dragover)="$event.preventDefault(); over.set(c.key)" (drop)="$event.preventDefault(); drop(c.key)">
          <span class="fh-cols-grip" aria-hidden="true">⠿</span>
          <span class="fh-cols-name">{{ c.label }}</span>
          <button type="button" class="fh-cols-btn" [disabled]="first" (click)="store.move(c.key, -1)" [attr.aria-label]="'Move ' + c.label + ' left'">↑</button>
          <button type="button" class="fh-cols-btn" [disabled]="last" (click)="store.move(c.key, 1)" [attr.aria-label]="'Move ' + c.label + ' right'">↓</button>
          <button type="button" class="fh-cols-btn" [disabled]="store.defs().length === 1" (click)="store.toggle(c.key)" [attr.aria-label]="'Hide ' + c.label">✕</button>
        </li>
      }
    </ol>
    @for (g of hiddenGroups(); track g.group) {
      <div class="fh-rf-label mt-2">{{ g.label }}</div>
      <div class="fh-chips">
        @for (c of g.cols; track c.key) {
          <button type="button" class="fh-chipf" (click)="store.toggle(c.key)" [title]="c.tip || ('Add ' + c.label)"><i class="fh-chipf-dot"></i>{{ c.label }}</button>
        }
      </div>
    }
    <div class="fh-rf-label mt-3">Views</div>
    @if (viewNames().length) {
      <div class="fh-chips">
        @for (n of viewNames(); track n) {
          <span class="fh-cols-view" [class.sel]="isActive(n)">
            <button type="button" class="fh-cols-view-name" (click)="store.applyView(n)" [title]="'Show the columns of ' + n">{{ n }}</button>
            <button type="button" class="fh-cols-view-x" (click)="store.deleteView(n)" [attr.aria-label]="'Delete view ' + n" title="Delete this view">✕</button>
          </span>
        }
      </div>
    }
    <div class="d-flex gap-1 mt-1">
      <input class="form-control form-control-sm" placeholder="name this view" [(ngModel)]="name" (keyup.enter)="save()" aria-label="View name" />
      <button type="button" class="fh-btn-glow" [disabled]="!name.trim()" (click)="save()"
              [title]="store.views()[name.trim()] ? 'Replace the view ' + name.trim() + ' with these columns' : 'Save these columns as a view'">Save</button>
    </div>
  </div>`,
})
export class CandidateColumns {
  protected store = inject(ColumnsStore);
  protected name = '';
  protected drag: string | null = null;
  protected over = signal<string | null>(null);
  protected viewNames = computed(() => Object.keys(this.store.views()).sort((a, b) => a.localeCompare(b)));
  protected hiddenGroups = computed(() => {
    const shown = new Set(this.store.visible());
    return (Object.keys(GROUP_LABEL) as ColumnGroup[])
      .map((group) => ({ group, label: GROUP_LABEL[group], cols: COLUMNS.filter((c) => c.group === group && !shown.has(c.key)) }))
      .filter((g) => g.cols.length);
  });
  protected isActive(n: string): boolean { return this.store.views()[n]?.join() === this.store.visible().join(); }
  protected drop(target: string): void { if (this.drag) this.store.place(this.drag, target); this.drag = null; this.over.set(null); }
  protected save(): void { this.store.saveView(this.name); this.name = ''; }
}
