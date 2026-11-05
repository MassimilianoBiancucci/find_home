import { Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import type { GeoJSONSource, Map as MlMap, Popup, StyleSpecification } from 'maplibre-gl';
import { InfoButton } from '../components/info';
import { blipId, installBlip } from '../components/map-icons';
import { toneColor, walkTone } from '../format';
import { HouseLocation } from '../models';
import { applyDarkWater } from '../pages/map/dark-style';
import { ApiService } from '../services/api.service';
import { ThemeService } from '../services/theme.service';
import { setColour } from '../set-colours';

const ACCENT = '#b45cf0';
const BLANK: StyleSpecification = { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#2a2a30' } }] };
type FC = { type: 'FeatureCollection'; features: any[] };
const fc = (features: any[]): FC => ({ type: 'FeatureCollection', features });
const TONE_PAINT = ['match', ['get', 'tone'], 'good', '#2fbf71', 'neutral', '#e0b23a', 'bad', '#ef5350', '#cccccc'];

/** The map features of a house analysis: every nearby target as a dot in its set's colour (the nearest one larger),
 *  the walking path to the nearest target of each set, and its minutes at the target end. */
export function houseMapFeatures(loc: HouseLocation): { pois: FC; walks: FC; labels: FC } {
  const pois: any[] = [], walks: any[] = [], labels: any[] = [];
  for (const set of loc.sets ?? Object.keys(loc.walks)) {
    const w = loc.walks[set];
    if (!w) continue;
    const colour = setColour(set), label = loc.set_labels[set] ?? set;
    (w.nearby ?? []).forEach(([lon, lat, name, minutes], i) => pois.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: { set, colour, label, name, minutes, nearest: i === 0 && w.minutes != null } }));
    if (w.minutes == null || (w.path?.length ?? 0) < 2) continue;
    const tone = walkTone(w.minutes, loc.walk_colours);
    walks.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: w.path },
      properties: { set, colour, label, name: w.target, minutes: w.minutes, metres: w.metres } });
    labels.push({ type: 'Feature', geometry: { type: 'Point', coordinates: w.path[w.path.length - 1] },
      properties: { text: `${w.minutes} min`, tone } });
  }
  return { pois: fc(pois), walks: fc(walks), labels: fc(labels) };
}

/**
 * "On the map": a map centred on the home, big enough to see where it is. Inside the mapped zones it shows every
 * nearby service and stop (dots in the set colours), the walking path to the nearest of each set with its minutes,
 * and a button for the full-screen 3D zone view. Outside the mapped zones it shows the home's position only.
 */
@Component({
  selector: 'fh-house-map',
  imports: [InfoButton],
  template: `
  <section class="fh-hcard">
    <header><h2>On the map</h2>
      <span class="fh-hsub">{{ loc() ? loc()!.zone.name : outside() ? 'outside the mapped zones' : 'locating…' }}</span>
      <fh-info id="house.map" /></header>
    <div class="fh-hmap-wrap">
      <div #mapEl class="fh-hmap"></div>
      @if (error()) { <div class="fh-hmap-note">{{ error() }}</div> }
    </div>
    @if (loc(); as l) {
      <div class="fh-hmap-legend">
        @for (s of sets(); track s.set) {
          <button type="button" class="fh-hchip" [class.off]="hidden().has(s.set)" (click)="toggle(s.set)" [title]="s.title">
            <i class="fh-hdot" [style.background]="s.colour"></i>{{ s.label }}
            <b [style.color]="s.toneCss">{{ s.minutes == null ? '–' : s.minutes + '′' }}</b></button>
        }
      </div>
    } @else if (outside()) {
      <div class="fh-hnote">This home is outside the zones the app has mapped: its position only, without services or walking paths (the walking network covers the mapped zones).</div>
    }
    <div class="d-flex gap-2 align-items-center mt-2">
      <button type="button" class="btn btn-sm btn-primary" [disabled]="!loc()" (click)="openFullscreen()"
        [title]="loc() ? 'Open the zone view focused on this home, full screen, in 3D' : 'Available for homes inside the mapped zones'">
        ⛶ Full-screen zone view</button>
      <button type="button" class="btn btn-sm btn-outline-secondary" (click)="recentre()">Re-centre</button>
    </div>
  </section>`,
  styles: [`
    .fh-hmap-wrap { position: relative; border-radius: 8px; overflow: hidden; box-shadow: inset 0 0 0 1px rgba(255,255,255,.08); }
    .fh-hmap { height: 440px; width: 100%; }
    .fh-hmap-note { position: absolute; left: 8px; bottom: 8px; padding: 2px 8px; border-radius: 6px; font-size: .75rem;
      background: rgba(20,20,26,.75); color: #ddd; }
    .fh-hmap-legend { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
    .fh-hchip { border: 1px solid var(--bs-border-color); background: var(--bs-body-bg); border-radius: 999px; padding: 1px 8px;
      font-size: .76rem; color: inherit; display: inline-flex; align-items: center; gap: 4px; }
    .fh-hchip.off { opacity: .4; }
    .fh-hchip .fh-hdot { margin-right: 0; }
  `],
})
export class HouseMap {
  /** The home's coordinates (always known when the bubble is shown). */
  readonly lat = input.required<number>();
  readonly lon = input.required<number>();
  readonly shortId = input.required<string>();
  /** The house analysis; null while loading or outside the mapped zones. */
  readonly loc = input<HouseLocation | null>(null);
  /** True when the house analysis said the home is outside every zone. */
  readonly outside = input(false);

  private api = inject(ApiService);
  private theme = inject(ThemeService);
  private router = inject(Router);
  private el = viewChild.required<ElementRef<HTMLDivElement>>('mapEl');
  private map: MlMap | null = null;
  private popup: Popup | null = null;
  private styleReady = signal(0);
  private settings: { style_url: string; style_url_dark?: string } | null = null;
  private dark = false;
  protected error = signal('');
  protected hidden = signal<Set<string>>(new Set());

  protected sets = computed(() => {
    const l = this.loc();
    if (!l) return [];
    return (l.sets ?? Object.keys(l.walks)).map((set) => {
      const w = l.walks[set];
      return { set, label: l.set_labels[set] ?? set, colour: setColour(set), minutes: w?.minutes ?? null,
        toneCss: toneColor(walkTone(w?.minutes ?? null, l.walk_colours)),
        title: w?.target ? `Nearest: ${w.target} · ${w.minutes} min · ${w.metres} m · ${w.nearby?.length ?? 0} shown` : 'Nothing within reach' };
    });
  });

  constructor() {
    const destroy = inject(DestroyRef);
    afterNextRender(() => void this.init(destroy));
    // theme switch: the dark or light style, then the layers again (style.load → draw)
    effect(() => {
      const dark = this.theme.theme() === 'dark';
      untracked(() => {
        const map = this.map, s = this.settings;
        if (!map || !s || dark === this.dark) return;
        this.dark = dark;
        map.setStyle((dark && s.style_url_dark) || s.style_url, { diff: false });
      });
    });
    // draw (or redraw) when the analysis, the style or the hidden sets change
    effect(() => {
      const l = this.loc(), lat = this.lat(), lon = this.lon(), hidden = this.hidden();
      if (!this.styleReady()) return;
      untracked(() => this.draw(l, lat, lon, hidden));
    });
  }

  private async init(destroy: DestroyRef): Promise<void> {
    const mod: any = await import('maplibre-gl');
    const ml = mod.default ?? mod;
    this.api.mapSettings().subscribe({
      next: (s) => {
        const dark = this.theme.theme() === 'dark';
        this.settings = s;
        this.dark = dark;
        const map: MlMap = new ml.Map({ container: this.el().nativeElement, style: (dark && s.style_url_dark) || s.style_url,
          center: [this.lon(), this.lat()], zoom: 15, attributionControl: { customAttribution: s.attribution, compact: true } });
        this.map = map;
        destroy.onDestroy(() => { this.popup?.remove(); map.remove(); this.map = null; });
        map.addControl(new ml.NavigationControl({ visualizePitch: true }), 'top-right');
        map.addControl(new ml.ScaleControl({ unit: 'metric' }), 'bottom-left');
        new ResizeObserver(() => map.resize()).observe(this.el().nativeElement);
        let failed = false;
        map.on('error', () => {
          if (failed || this.styleReady()) return;
          failed = true;
          this.error.set('Map style could not be loaded: position only.');
          map.setStyle(BLANK);
        });
        map.on('style.load', () => { if (this.dark) applyDarkWater(map); this.styleReady.update((n) => n + 1); });
        map.on('styleimagemissing', (e) => installBlip(map, e.id));
        const show = (e: any) => {
          const p = e.features?.[0]?.properties;
          if (!p) return;
          map.getCanvas().style.cursor = 'pointer';
          const text = `${p['label']}${p['name'] ? ' · ' + p['name'] : ''}${p['minutes'] != null ? ' · ' + p['minutes'] + ' min walk' : ''}${p['metres'] ? ' · ' + p['metres'] + ' m' : ''}`;
          this.popup?.remove();
          this.popup = new ml.Popup({ closeButton: false, closeOnClick: false, className: 'fh-house-pop' }).setLngLat(e.lngLat).setText(text).addTo(map);
        };
        const hide = () => { map.getCanvas().style.cursor = ''; this.popup?.remove(); this.popup = null; };
        for (const id of ['hm-poi', 'hm-walk']) { map.on('mousemove', id, show); map.on('mouseleave', id, hide); }
      },
      error: () => this.error.set('Map settings not available.'),
    });
  }

  private draw(l: HouseLocation | null, lat: number, lon: number, hidden: Set<string>): void {
    const map = this.map;
    if (!map) return;
    const f = l ? houseMapFeatures(l) : { pois: fc([]), walks: fc([]), labels: fc([]) };
    const keep = (c: FC) => fc(c.features.filter((x) => !hidden.has(x.properties.set)));
    const data: Record<string, FC> = {
      'hm-here': fc([{ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: {} }]),
      'hm-pois': keep(f.pois), 'hm-walks': keep(f.walks),
      'hm-labels': fc(f.labels.features.filter((x, i) => !hidden.has(f.walks.features[i]?.properties.set))),
    };
    for (const [id, d] of Object.entries(data)) {
      const src = map.getSource(id) as GeoJSONSource | undefined;
      if (src) src.setData(d as any); else map.addSource(id, { type: 'geojson', data: d as any });
    }
    const add = (layer: any) => { if (!map.getLayer(layer.id)) map.addLayer(layer); };
    add({ id: 'hm-glow', type: 'circle', source: 'hm-here', paint: { 'circle-color': ACCENT, 'circle-radius': 34, 'circle-blur': 0.9, 'circle-opacity': 0.5 } });
    add({ id: 'hm-walk-casing', type: 'line', source: 'hm-walks', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#0b0b10', 'line-width': 7, 'line-opacity': 0.6 } });
    add({ id: 'hm-walk', type: 'line', source: 'hm-walks', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'colour'], 'line-width': 4 } });
    add({ id: 'hm-poi', type: 'circle', source: 'hm-pois',
      paint: { 'circle-color': ['get', 'colour'], 'circle-radius': ['case', ['get', 'nearest'], 7, 4.5],
        'circle-stroke-color': ['case', ['get', 'nearest'], '#ffffff', '#101014'], 'circle-stroke-width': ['case', ['get', 'nearest'], 2, 1] } });
    add({ id: 'hm-label', type: 'symbol', source: 'hm-labels',
      layout: { 'text-field': ['get', 'text'], 'text-font': ['Noto Sans Regular'], 'text-size': 13, 'text-offset': [0, -1.2], 'text-allow-overlap': true },
      paint: { 'text-color': TONE_PAINT, 'text-halo-color': '#0b0b10', 'text-halo-width': 1.6 } });
    add({ id: 'hm-pin', type: 'symbol', source: 'hm-here',
      layout: { 'icon-image': blipId('home', ACCENT), 'icon-size': 1.7, 'icon-allow-overlap': true, 'icon-ignore-placement': true } });
    this.fit(l, lat, lon);
  }

  private fitted = '';
  /** Frame the home and its walks once per analysis (the user's pans are kept afterwards). */
  private fit(l: HouseLocation | null, lat: number, lon: number, force = false): void {
    const map = this.map;
    const key = `${lat},${lon},${!!l}`;
    if (!map || (!force && key === this.fitted)) return;
    this.fitted = key;
    const pts: [number, number][] = [[lon, lat]];
    for (const w of Object.values(l?.walks ?? {})) if (w.minutes != null && w.minutes <= (l?.walk_colours.yellow ?? 10)) pts.push(...w.path);
    if (pts.length < 2) { map.jumpTo({ center: [lon, lat], zoom: l ? 15 : 14 }); return; }
    const lons = pts.map((p) => p[0]), lats = pts.map((p) => p[1]);
    map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 50, maxZoom: 16.5, duration: 0 });
  }

  protected recentre(): void { this.fit(this.loc(), this.lat(), this.lon(), true); }
  protected toggle(set: string): void {
    this.hidden.update((h) => { const n = new Set(h); if (n.has(set)) n.delete(set); else n.add(set); return n; });
  }

  /** Full screen is requested inside the click (browsers refuse it later), then the zone view opens on the home. */
  protected openFullscreen(): void {
    const l = this.loc();
    if (!l) return;
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
    void this.router.navigate(['/map/zone', l.zone.id], { queryParams: { listing: this.shortId() } });
  }
}
