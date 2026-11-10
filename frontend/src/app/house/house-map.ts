import { Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import type { GeoJSONSource, Map as MlMap, Popup, StyleSpecification } from 'maplibre-gl';
import { InfoButton } from '../components/info';
import { blipExpr, blipId, installBlip, installObject, installPin } from '../components/map-icons';
import { toneColor, walkTone } from '../format';
import { HouseLocation, TransitMeta } from '../models';
import { applyDarkWater } from '../pages/map/dark-style';
import { ApiService } from '../services/api.service';
import { ThemeService } from '../services/theme.service';
import { setColour } from '../set-colours';
import { TARGET_ICONS, targetIconId } from '../pages/map/zone.service';
import { routeHighlightLayers, setRouteHighlight, transitFeatures } from '../pages/map/house-layer.service';
import { HouseTravelStore } from './house-travel.store';

const ACCENT = '#b45cf0';
const BLANK: StyleSpecification = { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#2a2a30' } }] };
type FC = { type: 'FeatureCollection'; features: any[] };
const fc = (features: any[]): FC => ({ type: 'FeatureCollection', features });
/** Modes with a line toggle on the house map, in this order, and their line widths. */
const LINE_MODES = ['metro', 'commuter_rail', 'local_rail', 'train', 'tram', 'bus', 'ferry'];
const LINE_WIDTH: Record<string, number> = { metro: 4, commuter_rail: 3.5, local_rail: 3, train: 2.5, tram: 3, bus: 1.8, ferry: 2 };
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
    }
    @if (lineModes().length) {
      <div class="fh-hmap-legend align-items-center">
        <span class="small text-body-secondary me-1">Lines</span>
        @for (m of lineModes(); track m.mode) {
          <button type="button" class="fh-hchip" [class.off]="!linesOn().has(m.mode)" (click)="toggleLines(m.mode)"
            [title]="(linesOn().has(m.mode) ? 'Hide' : 'Show') + ' every ' + m.label.toLowerCase() + ' line (' + m.count + ')'">
            <i class="fh-hline" [style.background]="m.color"></i>{{ m.label }}</button>
        }
        @if (routes()) {
          <span class="ms-auto form-check form-switch small mb-0">
            <input class="form-check-input" type="checkbox" role="switch" id="fh-hm-svc" [checked]="travel.showServices()"
              (change)="travel.showServices.set($any($event.target).checked)" />
            <label class="form-check-label" for="fh-hm-svc">services' transit</label>
          </span>
        }
      </div>
    }
    @if (!loc() && outside()) {
      <div class="fh-hnote">Grey on the map: outside the area the app analyses.
      This home is outside the zones the app has mapped: its position only, without services or walking paths (the walking network covers the mapped zones).</div>
    }
    <div class="d-flex gap-2 align-items-center mt-2">
      <button type="button" class="fh-btn-glow" [disabled]="!loc()" (click)="openFullscreen()"
        [title]="loc() ? 'Open the zone view focused on this home, full screen, in 3D' : 'Available for homes inside the mapped zones'">
        ⛶ Full-screen zone view</button>
      <button type="button" class="fh-btn-ghost" (click)="recentre()">Re-centre</button>
      <button type="button" class="fh-btn-ghost" [disabled]="!points().length" (click)="fitAll()"
        [title]="routes() ? 'Zoom out to the home, your points and the transit routes' : 'Zoom out to the home and your points (compute the transit routes to draw them)'">
        ⤢ Home, your points{{ routes() ? ' and routes' : '' }}</button>
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
    .fh-hline { display: inline-block; width: 14px; height: 4px; border-radius: 2px; }
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
  protected travel = inject(HouseTravelStore);
  /** Your points (locations.yaml) with coordinates, and the analysed area (outline + mask), loaded once. */
  protected points = signal<any[]>([]);
  private region = signal<{ outline: any; mask: any } | null>(null);
  private zoneLines = signal<any | null>(null);
  /** The computed itineraries of this home (Compute transit routes), drawn on the map. */
  protected routes = computed(() => this.travel.results()[this.shortId()] ?? null);
  private settings: { style_url: string; style_url_dark?: string } | null = null;
  private dark = false;
  protected error = signal('');
  protected hidden = signal<Set<string>>(new Set());
  /** The saved transit network (data/geo/transit): which modes exist, which are shown, their lines once loaded. */
  private transitMeta = signal<TransitMeta | null>(null);
  protected lineModes = computed(() => (this.transitMeta()?.modes ?? []).filter((m) => LINE_MODES.includes(m.mode))
    .sort((a, b) => LINE_MODES.indexOf(a.mode) - LINE_MODES.indexOf(b.mode)));
  protected linesOn = signal<Set<string>>(new Set());
  private lineData = signal<Record<string, any>>({});

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
    // the hovered route (here or in the Transit routes bubble) on top, glowing; the others dimmed
    effect(() => {
      const trip = this.travel.hover();
      this.styleReady();
      untracked(() => { if (this.map) setRouteHighlight(this.map, 'hm-route', 'hm-transit', trip); });
    });
    // draw (or redraw) when the analysis, the style, the hidden sets, the routes or the shown lines change
    effect(() => {
      const l = this.loc(), lat = this.lat(), lon = this.lon(), hidden = this.hidden();
      this.routes(); this.region(); this.points(); this.zoneLines(); this.travel.showServices(); this.linesOn(); this.lineData();
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
        this.api.zoneRegion().subscribe({ next: (r) => this.region.set(r), error: () => undefined });
        this.api.geoZones().subscribe({ next: (z) => this.zoneLines.set(z), error: () => undefined });
        this.api.mapPoints().subscribe({ next: (p) => this.points.set(p.features.filter((f: any) => f.geometry)), error: () => undefined });
        this.api.transitMeta().subscribe({ next: (m) => this.transitMeta.set(m.built ? m : null), error: () => undefined });
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
        map.on('styleimagemissing', (e) => { installBlip(map, e.id); installPin(map, e.id); installObject(map, e.id); });
        const show = (e: any) => {
          const p = e.features?.[0]?.properties;
          if (!p) return;
          map.getCanvas().style.cursor = 'pointer';
          const text = `${p['label']}${p['name'] ? ' · ' + p['name'] : ''}${p['minutes'] != null ? ' · ' + p['minutes'] + ' min walk' : ''}${p['metres'] ? ' · ' + p['metres'] + ' m' : ''}`;
          this.popup?.remove();
          this.popup = new ml.Popup({ closeButton: false, closeOnClick: false, className: 'fh-house-pop' }).setLngLat(e.lngLat).setText(text).addTo(map);
        };
        const hide = () => { map.getCanvas().style.cursor = ''; this.popup?.remove(); this.popup = null; };
        for (const id of ['hm-poi', 'hm-walk', 'hm-transit', 'hm-points', 'hm-route-hi']) { map.on('mousemove', id, show); map.on('mouseleave', id, hide); }
        // hovering a route brings it to the front
        map.on('mousemove', 'hm-transit', (e: any) => {
          const trip = e.features?.[0]?.properties?.['trip'] ?? null;
          if (trip !== this.travel.hover()) this.travel.hover.set(trip);
        });
        map.on('mouseleave', 'hm-transit', () => this.travel.hover.set(null));
      },
      error: () => this.error.set('Map settings not available.'),
    });
  }

  private draw(l: HouseLocation | null, lat: number, lon: number, hidden: Set<string>): void {
    const map = this.map;
    if (!map) return;
    const f = l ? houseMapFeatures(l) : { pois: fc([]), walks: fc([]), labels: fc([]) };
    const keep = (c: FC) => fc(c.features.filter((x) => !hidden.has(x.properties.set)));
    const reg = this.region();
    const data: Record<string, any> = {
      'hm-mask': reg ? { type: 'Feature', geometry: reg.mask, properties: {} } : fc([]),
      'hm-region': reg ? { type: 'Feature', geometry: reg.outline, properties: {} } : fc([]),
      'hm-zones': this.zoneLines() ?? fc([]),
      'hm-here': fc([{ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: {} }]),
      'hm-pois': keep(f.pois), 'hm-walks': keep(f.walks),
      'hm-labels': fc(f.labels.features.filter((x, i) => !hidden.has(f.walks.features[i]?.properties.set))),
      'hm-transit': transitFeatures(this.routes(), { services: this.travel.showServices() }),
      'hm-points': fc(this.points().map((p) => ({ ...p, properties: { ...p.properties, name: p.properties.label, label: 'Your point' } }))),
    };
    for (const [id, d] of Object.entries(data)) {
      const src = map.getSource(id) as GeoJSONSource | undefined;
      if (src) src.setData(d); else map.addSource(id, { type: 'geojson', data: d });
    }
    const add = (layer: any, before?: string) => { if (!map.getLayer(layer.id)) map.addLayer(layer, before && map.getLayer(before) ? before : undefined); };
    // the analysed area: grey outside it, every zone outlined, the area's border glowing
    add({ id: 'hm-mask', type: 'fill', source: 'hm-mask', paint: { 'fill-color': '#9a9aa6', 'fill-opacity': 0.5 } });
    add({ id: 'hm-zones', type: 'line', source: 'hm-zones', paint: { 'line-color': '#c9b8ff', 'line-opacity': 0.35, 'line-width': 0.8 } });
    add({ id: 'hm-region', type: 'line', source: 'hm-region', paint: { 'line-color': ACCENT, 'line-width': 3.5, 'line-blur': 1, 'line-opacity': 0.95 } });
    // the saved lines (toggled in the legend), under the routes
    for (const m of LINE_MODES) {
      const d = this.lineData()[m];
      if (!d) continue;
      const src = map.getSource(`hm-lines-${m}`) as GeoJSONSource | undefined;
      if (!src) map.addSource(`hm-lines-${m}`, { type: 'geojson', data: d });
      add({ id: `hm-lines-${m}`, type: 'line', source: `hm-lines-${m}`, layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['coalesce', ['get', 'colour'], '#8a8aa0'], 'line-width': ['interpolate', ['linear'], ['zoom'], 10, LINE_WIDTH[m] * 0.6, 15, LINE_WIDTH[m] * 1.5],
          'line-opacity': m === 'bus' ? 0.55 : 0.8 } }, 'hm-transit-casing');
      map.setLayoutProperty(`hm-lines-${m}`, 'visibility', this.linesOn().has(m) ? 'visible' : 'none');
    }
    add({ id: 'hm-transit-casing', type: 'line', source: 'hm-transit', filter: ['!', ['get', 'walk']], layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#0b0b10', 'line-width': 8, 'line-opacity': 0.45 } });
    add({ id: 'hm-transit', type: 'line', source: 'hm-transit', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'colour'], 'line-width': ['case', ['get', 'walk'], 3, 5], 'line-opacity': 0.9,
        'line-dasharray': ['case', ['get', 'walk'], ['literal', [1, 1.5]], ['literal', [1, 0]]] } });
    add({ id: 'hm-glow', type: 'circle', source: 'hm-here', paint: { 'circle-color': ACCENT, 'circle-radius': 34, 'circle-blur': 0.9, 'circle-opacity': 0.5 } });
    add({ id: 'hm-walk-casing', type: 'line', source: 'hm-walks', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#0b0b10', 'line-width': 7, 'line-opacity': 0.6 } });
    add({ id: 'hm-walk', type: 'line', source: 'hm-walks', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'colour'], 'line-width': 4 } });
    // targets as the zone view's standing 3D pins and objects; the nearest of each set larger, with its glow
    const icon: any = ['match', ['get', 'set'], ...Object.keys(TARGET_ICONS).flatMap((k) => [k, targetIconId(k)]), targetIconId('')];
    const halos = Object.entries(TARGET_ICONS).filter(([, t]) => t.halo);
    add({ id: 'hm-poi-halo', type: 'circle', source: 'hm-pois', minzoom: 13, filter: ['all', ['get', 'nearest'], ['in', ['get', 'set'], ['literal', halos.map(([k]) => k)]]],
      paint: { 'circle-color': ['match', ['get', 'set'], ...halos.flatMap(([k, t]) => [k, t.halo!]), '#ffffff'], 'circle-blur': 0.9,
        'circle-opacity': 0.6, 'circle-radius': 18, 'circle-pitch-alignment': 'map' } });
    add({ id: 'hm-poi', type: 'symbol', source: 'hm-pois', minzoom: 13,
      layout: { 'icon-image': icon, 'icon-anchor': 'bottom', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
        'icon-pitch-alignment': 'viewport', 'icon-rotation-alignment': 'viewport', 'symbol-z-order': 'viewport-y',
        'icon-size': ['case', ['get', 'nearest'], 0.62, 0.38], 'symbol-sort-key': ['case', ['get', 'nearest'], 1, 0] } });
    add({ id: 'hm-label', type: 'symbol', source: 'hm-labels', minzoom: 13,
      layout: { 'text-field': ['get', 'text'], 'text-font': ['Noto Sans Regular'], 'text-size': 13, 'text-offset': [0, 0.9], 'text-anchor': 'top', 'text-allow-overlap': true },
      paint: { 'text-color': TONE_PAINT, 'text-halo-color': '#0b0b10', 'text-halo-width': 1.6 } });
    // the hovered route on top of the other routes and walks, under your points and the home
    for (const layer of routeHighlightLayers('hm-route', 'hm-transit')) add(layer);
    setRouteHighlight(map, 'hm-route', 'hm-transit', this.travel.hover());
    add({ id: 'hm-points', type: 'symbol', source: 'hm-points',
      layout: { 'icon-image': blipExpr('pin', '#607d8b'), 'icon-size': 1.35, 'icon-allow-overlap': true, 'icon-ignore-placement': true,
        'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 12, 'text-offset': [0, 1.3], 'text-anchor': 'top', 'text-optional': true },
      paint: { 'text-color': '#ffffff', 'text-halo-color': '#101014', 'text-halo-width': 1.4 } });
    add({ id: 'hm-pin', type: 'symbol', source: 'hm-here',
      layout: { 'icon-image': blipId('home', ACCENT), 'icon-size': 1.7, 'icon-allow-overlap': true, 'icon-ignore-placement': true } });
    this.fit(l, lat, lon);
  }

  /** Zoom out to the home, your points and the transit legs, to see how far they are and where the lines run. */
  protected fitAll(): void {
    const map = this.map;
    if (!map) return;
    const pts: number[][] = [[this.lon(), this.lat()], ...this.points().map((p) => p.geometry.coordinates)];
    for (const f of transitFeatures(this.routes(), { services: this.travel.showServices() }).features) pts.push(...(f.geometry as any).coordinates);
    const lons = pts.map((p) => p[0]), lats = pts.map((p) => p[1]);
    map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 60, maxZoom: 15, duration: 900 });
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

  /** Show or hide every line of a mode; the lines are loaded the first time. */
  protected toggleLines(mode: string): void {
    this.linesOn.update((s) => { const n = new Set(s); if (n.has(mode)) n.delete(mode); else n.add(mode); return n; });
    if (this.lineData()[mode] || !this.linesOn().has(mode)) return;
    this.api.transitLayer(`lines_${mode}`).subscribe({
      next: (d) => this.lineData.update((m) => ({ ...m, [mode]: d })),
      error: () => this.error.set('Transit lines not available: run `findhome geo fetch transit`.'),
    });
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
