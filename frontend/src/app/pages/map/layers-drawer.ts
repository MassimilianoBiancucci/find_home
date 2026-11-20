import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { blipUrl, houseUrl } from '../../components/map-icons';
import { MapStateService } from './map-state.service';
import { PoiLayersService } from './poi-layers.service';
import { TransitLayersService } from './transit-layers.service';

/** A layer chip: its visibility id, label, colour and optional icon or line swatch. */
interface Chip { id: string; label: string; colour: string; icon?: string; swatch?: string; n?: number; disabled?: boolean; title?: string; }
interface Section { title: string; hint?: string; chips: Chip[]; note?: string; }

const OPEN_KEY = 'fh-map-layers-open';
const TINT = 'linear-gradient(90deg,#1f9d55,#d6c94a,#b0303a)';

/**
 * The map's layers in a sheet under the map, as wide as it, in every mode (Explore, Area, Connectivity, Zone): one row
 * of toggle chips per group (map, places, transit), each in its layer's colour, filled and glowing while shown.
 * The Layers pill opens it: the sheet slides up and the map's bottom edge with it (the map shrinks to make room)
 * while the pill fades out; a click on the map, the fold button or Escape slides both back down and the pill fades
 * back in.
 * Open or folded is remembered in this browser.
 */
@Component({
  selector: 'fh-layers-drawer',
  host: { '(document:keydown.escape)': 'close()', '[class.open]': 'open()' },
  template: `
  <div class="fh-lyr-clip">
    <div class="fh-lyr-panel" id="fh-lyr-panel" [class.open]="open()" [attr.aria-hidden]="!open()" [attr.inert]="open() ? null : ''">
      <button type="button" class="fh-lyr-fold" (click)="close()" title="Fold the layers away (or click the map)" aria-label="Fold the layers away">▾</button>
      @for (s of sections(); track s.title) {
        <div class="fh-lyr-sec">
          <span class="fh-lyr-h" [title]="s.hint ?? ''">{{ s.title }}</span>
          <div class="fh-lyr-chips">
            @for (c of s.chips; track c.id) {
              <button type="button" class="fh-chipf fh-lyr-chip" [class.sel]="on(c)" [disabled]="c.disabled"
                [style.--lc]="c.colour" [attr.aria-pressed]="on(c)" [title]="c.title ?? (on(c) ? 'Hide ' : 'Show ') + c.label" (click)="flip(c)">
                @if (c.icon) { <img [src]="c.icon" width="16" height="16" alt="" /> }
                @else if (c.swatch) { <i class="fh-lyr-line" [style.background]="c.swatch"></i> }
                <span class="fh-chipf-t">{{ c.label }}</span>
                @if (c.n != null) { <span class="fh-chipf-n">{{ c.n }}</span> }
              </button>
            }
            @if (s.note) { <span class="fh-lyr-note">{{ s.note }}</span> }
          </div>
        </div>
      }
      @if (poi.error() || transit.error()) { <div class="small text-danger">{{ poi.error() || transit.error() }}</div> }
    </div>
  </div>
  <button type="button" class="fh-lyr-tab" [class.gone]="open()" (click)="toggle()" [attr.aria-expanded]="open()" aria-controls="fh-lyr-panel"
    [attr.tabindex]="open() ? -1 : null" title="Choose the map layers">
    <i class="fh-lyr-caret">▴</i> Layers <span class="fh-lyr-count">{{ count() }}</span>
  </button>`,
  styles: [`
    /* under the map, in the page flow: its height grows from 0 to the sheet's (0fr → 1fr), so the map above shrinks
       with it and its bottom edge slides up and down with the sheet */
    :host { position: relative; display: grid; grid-template-rows: 0fr; flex: none;
      transition: grid-template-rows .42s cubic-bezier(.22, .9, .25, 1); }
    :host(.open) { grid-template-rows: 1fr; }
    .fh-lyr-clip { min-height: 0; overflow: hidden; }
    .fh-lyr-panel { position: relative; margin-top: 8px; display: flex; flex-direction: column; gap: 6px; max-height: 38vh; overflow: auto;
      padding: 12px 44px 12px 14px; border-radius: 8px; background: var(--bs-body-bg);
      border: 1px solid color-mix(in srgb, var(--fh-violet) 55%, transparent);
      box-shadow: inset 0 3px 0 var(--fh-violet-soft); visibility: hidden; transition: visibility 0s linear .42s; }
    .fh-lyr-panel.open { visibility: visible; transition: visibility 0s; }
    .fh-lyr-fold { position: absolute; top: 8px; right: 10px; width: 26px; height: 26px; border-radius: 50%; padding: 0;
      border: 1.5px solid var(--fh-violet); background: transparent; color: var(--fh-violet); font-size: .8rem; line-height: 1;
      cursor: pointer; transition: box-shadow .2s, transform .12s; }
    .fh-lyr-fold:hover { box-shadow: 0 0 0 3px var(--fh-violet-soft); transform: translateY(1px); }
    .fh-lyr-sec { display: grid; grid-template-columns: 62px minmax(0, 1fr); align-items: start; gap: 8px; }
    .fh-lyr-h { font-size: .7rem; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--bs-secondary-color);
      padding-top: 5px; }
    .fh-lyr-chips { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
    .fh-lyr-chip { --c1: color-mix(in srgb, var(--lc) 62%, #fff); --c2: var(--lc); --c3: color-mix(in srgb, var(--lc) 72%, #000);
      --glow: color-mix(in srgb, var(--lc) 65%, transparent); }
    .fh-lyr-chip img { filter: drop-shadow(0 0 1px rgba(0, 0, 0, .5)); }
    .fh-lyr-chip.sel img { filter: drop-shadow(0 0 2px #fff); }
    .fh-lyr-line { display: inline-block; width: 16px; height: 4px; border-radius: 2px; box-shadow: 0 0 0 1px #0006; }
    .fh-lyr-chip.sel .fh-lyr-line { box-shadow: 0 0 0 1px #fff; }
    .fh-lyr-note { font-size: .72rem; color: var(--bs-secondary-color); }
    /* the pill floats over the map's bottom edge: fades out (and sinks a little) while the sheet is open, back in after */
    .fh-lyr-tab { position: absolute; left: 50%; bottom: calc(100% + 28px); transform: translateX(-50%); z-index: 3;
      display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px 4px 13px; border-radius: 999px; font-size: .8rem;
      font-weight: 700; color: #fff; cursor: pointer; border: 1.5px solid #c43dff;
      background: linear-gradient(135deg, #ff6ad5 0%, #c43dff 50%, #6a5cff 100%); text-shadow: 0 1px 1px rgba(0, 0, 0, .25);
      box-shadow: 0 0 0 3px rgba(196, 61, 255, .18), 0 4px 14px -4px rgba(196, 61, 255, .7);
      transition: opacity .35s ease .2s, transform .35s ease .2s, box-shadow .2s, visibility 0s; }
    .fh-lyr-tab:hover { transform: translate(-50%, -1px); box-shadow: 0 0 0 4px rgba(196, 61, 255, .25), 0 6px 18px -4px rgba(196, 61, 255, .85); }
    .fh-lyr-tab.gone { opacity: 0; transform: translate(-50%, 10px); pointer-events: none; visibility: hidden;
      transition: opacity .25s ease, transform .25s ease, visibility 0s linear .25s; }
    .fh-lyr-caret { font-style: normal; font-size: .7rem; }
    .fh-lyr-count { min-width: 20px; padding: 0 6px; border-radius: 999px; background: rgba(255, 255, 255, .25); text-align: center;
      font-variant-numeric: tabular-nums; }
    @media (prefers-reduced-motion: reduce) { :host, .fh-lyr-panel, .fh-lyr-tab, .fh-lyr-tab.gone { transition: none; } }
  `],
})
export class LayersDrawer {
  protected state = inject(MapStateService);
  protected poi = inject(PoiLayersService);
  protected transit = inject(TransitLayersService);
  protected open = signal(this.readOpen());

  constructor() {
    // a click on the map folds the sheet away
    let off: (() => void) | null = null;
    effect(() => {
      const map = this.state.map();
      untracked(() => {
        off?.();
        off = null;
        if (!map) return;
        const fold = () => this.close();
        map.on('click', fold);
        off = () => map.off('click', fold);
      });
    });
    inject(DestroyRef).onDestroy(() => off?.());
  }

  protected sections = computed<Section[]>(() => {
    const map: Section = { title: 'Map', chips: [
      { id: 'listings', label: 'Listings', colour: '#1f9d55', icon: houseUrl('#1f9d55') },
      { id: 'listings-rejected', label: 'Rejected', colour: '#e53e3e', icon: blipUrl('dot', '#e53e3e') },
      { id: 'points', label: 'Your points', colour: '#990ae3', icon: blipUrl('pin', '#990ae3') },
      { id: 'connectivity-tint', label: 'Commute tint', colour: '#d69e2e', swatch: TINT,
        title: 'Zones tinted by weighted commute minutes (Connectivity); hover a zone for its numbers' },
    ] };
    const places: Section = { title: 'Places', chips: this.poi.categories().map((c) => ({
      id: `poi-${c.key}`, label: c.label, colour: c.color || '#8a8aa0', icon: blipUrl(c.icon, c.color), disabled: !c.fetched,
      title: c.fetched ? undefined : 'Not fetched yet: findhome geo fetch poi',
    })) };
    const m = this.transit.meta();
    const transit: Section = { title: 'Transit', hint: m?.built ? `Source: ${m.source === 'gtfs' ? 'SL GTFS (Trafiklab)' : 'OpenStreetMap routes'}` : '',
      chips: m?.built ? [
        ...m.modes.map((t) => ({ id: `transit-${t.mode}`, label: t.label, colour: t.color, swatch: t.color, n: t.count })),
        { id: 'transit-stations', label: 'Stations', colour: '#0089ca', icon: blipUrl('metro', '#0089ca'), n: m.stations },
      ] : [],
      note: m && !m.built ? 'Not built yet: findhome geo fetch transit' : undefined };
    return [map, places, transit].filter((s) => s.chips.length || s.note);
  });
  /** How many layers are shown. */
  protected count = computed(() => this.sections().flatMap((s) => s.chips).filter((c) => !c.disabled && this.on(c)).length);

  protected on(c: Chip): boolean {
    if (c.id.startsWith('poi-')) return this.poi.isOn(c.id.slice(4));
    if (c.id.startsWith('transit-')) return this.transit.isOn(c.id);
    return this.state.isVisible(c.id, c.id !== 'connectivity-tint' && c.id !== 'listings-rejected');
  }
  protected flip(c: Chip): void {
    if (c.id.startsWith('poi-')) this.poi.toggle(c.id.slice(4));
    else if (c.id.startsWith('transit-')) this.transit.toggle(c.id);
    else this.state.setVisible(c.id, !this.on(c));
  }
  protected toggle(): void { this.setOpen(!this.open()); }
  close(): void { if (this.open()) this.setOpen(false); }
  private setOpen(on: boolean): void {
    this.state.anchorBottomUntil = performance.now() + 700;   // the sheet's slide (0.42 s) and a margin
    this.open.set(on);
    try { localStorage.setItem(OPEN_KEY, on ? '1' : '0'); } catch { /* storage unavailable */ }
  }
  private readOpen(): boolean {
    try { return localStorage.getItem(OPEN_KEY) === '1'; } catch { return false; }
  }
}
