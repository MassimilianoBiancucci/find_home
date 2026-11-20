import { Component, DestroyRef, ElementRef, afterNextRender, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import { Category, Point } from '../models';
import { applyDarkWater } from '../pages/map/dark-style';
import { ThemeService } from '../services/theme.service';
import { ZoneGeoStore } from '../services/zone-geo.store';
import { blipId, installBlip, installPin, pinId } from './map-icons';

type FC = { type: 'FeatureCollection'; features: any[] };
const fc = (features: any[]): FC => ({ type: 'FeatureCollection', features });
const GREY = '#8a8aa0';

/**
 * Your points on the main map's style (light or dark, the search area outlined, outside it greyed), movable and
 * zoomable. With a `focus` (an index of `points`) that point is a large standing pin in its category colour, inside a
 * soft light, and every other point a small blip with its name; without one (the overview) every point is a blip of
 * the same size. A click on a point emits `selected`; while `picking`, a click anywhere emits `picked` (lat, lon)
 * instead. The map is created when it first scrolls into view (a page of points makes one WebGL context each).
 * `stamp` changes whenever a point moves or is renamed (the points are edited in place, so their array does not).
 */
@Component({
  selector: 'fh-point-map',
  template: `
    <div class="fh-pm" [class.picking]="picking()" [style.height.px]="height()">
      <div #el class="fh-pm-map"></div>
      @if (focus() != null && !focusHas()) {
        <div class="fh-pm-empty">No position yet: pick an address suggestion, type the coordinates or place it on the map.</div>
      }
      @if (picking()) { <div class="fh-pm-hint">Click the map to place the point</div> }
      <button type="button" class="fh-pm-reset" title="Back to the first view" aria-label="Back to the first view" (click)="frame()">⟲</button>
    </div>`,
  styles: [`
    :host { display: block; }
    .fh-pm { position: relative; border-radius: 10px; overflow: hidden; background: #2a2a30;
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--bs-secondary-color) 35%, transparent), 0 6px 18px -8px rgba(0, 0, 0, .45);
      transition: box-shadow .2s; }
    .fh-pm.picking { box-shadow: 0 0 0 2px #c43dff, 0 0 0 6px rgba(196, 61, 255, .25), 0 6px 18px -8px rgba(196, 61, 255, .6); }
    .fh-pm.picking .fh-pm-map ::ng-deep canvas { cursor: crosshair; }
    .fh-pm-map { position: absolute; inset: 0; }
    .fh-pm-empty { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 78%; text-align: center;
      padding: 8px 12px; border-radius: 10px; font-size: .8rem; color: #fff; background: rgba(16, 16, 22, .8); pointer-events: none; }
    .fh-pm-hint { position: absolute; left: 50%; top: 10px; transform: translateX(-50%); padding: 3px 12px; border-radius: 999px;
      font-size: .78rem; font-weight: 700; color: #fff; pointer-events: none;
      background: linear-gradient(135deg, #ff6ad5 0%, #c43dff 50%, #6a5cff 100%); box-shadow: 0 4px 14px -4px rgba(196, 61, 255, .8); }
    .fh-pm-reset { position: absolute; left: 10px; bottom: 10px; width: 29px; height: 29px; border-radius: 4px; border: 0; background: #fff;
      color: #333; font-size: 1rem; line-height: 1; box-shadow: 0 0 0 2px rgba(0, 0, 0, .1); }
    .fh-pm-reset:hover { background: #f2f2f2; }
    :host ::ng-deep .maplibregl-ctrl-attrib { font-size: 9px; }
  `],
})
export class PointMap {
  readonly points = input<Point[]>([]);
  readonly cats = input<Record<string, Category>>({});
  /** The point this map is about (an index of `points`); null for the overview of every point. */
  readonly focus = input<number | null>(null);
  readonly stamp = input('');
  readonly height = input(320);
  readonly picking = input(false);
  readonly picked = output<[number, number]>();
  readonly selected = output<number>();

  private geo = inject(ZoneGeoStore);
  private theme = inject(ThemeService);
  private el = viewChild.required<ElementRef<HTMLDivElement>>('el');
  private map: MlMap | null = null;
  private styled = false;
  private dark = false;
  private settings: { style_url: string; style_url_dark?: string } | null = null;
  private region: { outline: any; mask: any } | null = null;
  private ready = signal(0);
  /** The focus point's position at the last frame: when it moves, the map follows it. */
  private framedAt: string | null = null;

  constructor() {
    const destroy = inject(DestroyRef);
    afterNextRender(() => {
      const io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) { io.disconnect(); void this.init(destroy); }
      }, { rootMargin: '300px' });
      io.observe(this.el().nativeElement);
      destroy.onDestroy(() => io.disconnect());
    });
    effect(() => {
      this.stamp(); this.focus(); this.cats(); this.points();
      if (!this.ready()) return;
      untracked(() => this.draw());
    });
    effect(() => {
      const dark = this.theme.theme() === 'dark';
      untracked(() => {
        if (!this.map || !this.settings || dark === this.dark) return;
        this.dark = dark;
        this.styled = false;
        this.map.setStyle((dark && this.settings.style_url_dark) || this.settings.style_url, { diff: false });
      });
    });
  }

  protected focusHas(): boolean { const f = this.focus(); return f != null && !!this.points()[f]?.coords; }

  private async init(destroy: DestroyRef): Promise<void> {
    const mod: any = await import('maplibre-gl');
    const ml = mod.default ?? mod;
    this.geo.region$.pipe(takeUntilDestroyed(destroy)).subscribe({ next: (r) => { this.region = r; this.ready.update((n) => n + 1); }, error: () => undefined });
    this.geo.settings$.subscribe({
      next: (s: any) => {
        this.settings = s;
        this.dark = this.theme.theme() === 'dark';
        const map: MlMap = new ml.Map({ container: this.el().nativeElement, style: (this.dark && s.style_url_dark) || s.style_url,
          center: [18.07, 59.33], zoom: 10, dragRotate: false, pitchWithRotate: false,
          attributionControl: { customAttribution: s.attribution, compact: true } });
        this.map = map;
        map.touchZoomRotate.disableRotation();
        map.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
        map.scrollZoom.setWheelZoomRate(1 / 300);
        destroy.onDestroy(() => { map.remove(); this.map = null; });
        new ResizeObserver(() => map.resize()).observe(this.el().nativeElement);
        map.on('styleimagemissing', (e) => { installPin(map, e.id); installBlip(map, e.id); });
        map.on('style.load', () => { this.styled = true; if (this.dark) applyDarkWater(map); this.ready.update((n) => n + 1); });
        map.once('load', () => this.el().nativeElement.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show'));
        map.on('click', (e) => {
          if (this.picking()) { this.picked.emit([round(e.lngLat.lat), round(e.lngLat.lng)]); return; }
          const hit = map.queryRenderedFeatures(e.point, { layers: ['pm-others', 'pm-focus'].filter((l) => map.getLayer(l)) })[0];
          const i = hit?.properties?.['i'];
          if (i != null && +i !== this.focus()) this.selected.emit(+i);
        });
        for (const l of ['pm-others', 'pm-focus']) {
          map.on('mouseenter', l, () => { if (!this.picking()) map.getCanvas().style.cursor = 'pointer'; });
          map.on('mouseleave', l, () => { map.getCanvas().style.cursor = ''; });
        }
      },
      error: () => undefined,
    });
  }

  private feature(p: Point, i: number): any {
    const c = this.cats()[p.category];
    return { type: 'Feature', geometry: { type: 'Point', coordinates: [p.coords![1], p.coords![0]] },
      properties: { i, label: p.label || p.id, icon: c?.icon ?? 'pin', color: c?.color ?? GREY } };
  }

  private draw(): void {
    const map = this.map;
    if (!map || !this.styled) return;
    const f = this.focus(), pts = this.points();
    const all = pts.map((p, i) => (p.coords ? this.feature(p, i) : null)).filter(Boolean);
    const focus = f != null ? all.filter((x: any) => x.properties.i === f) : [];
    const others = all.filter((x: any) => x.properties.i !== f);
    const data: Record<string, any> = {
      'pm-mask': this.region ? { type: 'Feature', geometry: this.region.mask, properties: {} } : fc([]),
      'pm-outline': this.region ? { type: 'Feature', geometry: this.region.outline, properties: {} } : fc([]),
      'pm-others': fc(others.map((x: any) => ({ ...x, properties: { ...x.properties, img: blipId(x.properties.icon, x.properties.color) } }))),
      'pm-focus': fc(focus.map((x: any) => ({ ...x, properties: { ...x.properties, img: pinId(x.properties.icon, x.properties.color) } }))),
    };
    for (const [id, d] of Object.entries(data)) {
      const src = map.getSource(id) as GeoJSONSource | undefined;
      if (src) src.setData(d); else map.addSource(id, { type: 'geojson', data: d });
    }
    const overview = f == null;
    // labels: white with a dark rim on the dark style, dark with a white rim on the light one
    const ink = this.dark ? '#ffffff' : '#1b1b22', rim = this.dark ? '#101014' : '#ffffff';
    const add = (layer: any) => { if (!map.getLayer(layer.id)) map.addLayer(layer); };
    add({ id: 'pm-mask', type: 'fill', source: 'pm-mask', paint: { 'fill-color': '#9a9aa6', 'fill-opacity': 0.22 } });
    add({ id: 'pm-outline', type: 'line', source: 'pm-outline', paint: { 'line-color': '#c084fc', 'line-width': 1.2, 'line-opacity': 0.45 } });
    add({ id: 'pm-others', type: 'symbol', source: 'pm-others',
      layout: { 'icon-image': ['get', 'img'], 'icon-size': overview ? 1.05 : 0.72, 'icon-allow-overlap': true, 'icon-ignore-placement': true,
        'text-field': ['get', 'label'], 'text-font': ['Noto Sans Regular'], 'text-size': overview ? 12 : 10.5, 'text-offset': [0, 1.15],
        'text-anchor': 'top', 'text-optional': true },
      paint: { 'icon-opacity': overview ? 1 : 0.85, 'text-color': ink, 'text-halo-color': rim, 'text-halo-width': 1.4,
        'text-opacity': overview ? 1 : 0.85 } });
    add({ id: 'pm-focus-halo', type: 'circle', source: 'pm-focus',
      paint: { 'circle-color': ['get', 'color'], 'circle-radius': 40, 'circle-blur': 0.8, 'circle-opacity': 0.7 } });
    add({ id: 'pm-focus', type: 'symbol', source: 'pm-focus',
      layout: { 'icon-image': ['get', 'img'], 'icon-anchor': 'bottom', 'icon-size': 1.6, 'icon-allow-overlap': true, 'icon-ignore-placement': true,
        'text-field': ['get', 'label'], 'text-font': ['Noto Sans Regular'], 'text-size': 13.5, 'text-offset': [0, 0.6], 'text-anchor': 'top',
        'text-allow-overlap': true },
      paint: { 'text-color': ink, 'text-halo-color': rim, 'text-halo-width': 1.6 } });
    const at = f != null ? pts[f]?.coords?.join(',') ?? null : JSON.stringify(all.map((x: any) => x.geometry.coordinates));
    if (at !== this.framedAt) this.frame();
  }

  /**
   * The first view. A point's map: centred on it, zoomed out just enough to show every other point too (between
   * zoom 10 and 15). The overview: every point and the search area.
   */
  frame(): void {
    const map = this.map;
    if (!map) return;
    const f = this.focus(), pts = this.points().filter((p) => p.coords);
    const me = f != null ? this.points()[f]?.coords : null;
    this.framedAt = f != null ? me?.join(',') ?? null : JSON.stringify(pts.map((p) => [p.coords![1], p.coords![0]]));
    if (f != null) {
      if (!me) { map.jumpTo({ center: [18.07, 59.33], zoom: 10 }); return; }
      let dLat = 0.01, dLon = 0.02;
      for (const p of pts) { dLat = Math.max(dLat, Math.abs(p.coords![0] - me[0])); dLon = Math.max(dLon, Math.abs(p.coords![1] - me[1])); }
      const cam = map.cameraForBounds([[me[1] - dLon, me[0] - dLat], [me[1] + dLon, me[0] + dLat]], { padding: 46 });
      map.jumpTo({ center: [me[1], me[0]], zoom: Math.min(15, Math.max(10, cam?.zoom ?? 13)) });
      return;
    }
    const lons = pts.map((p) => p.coords![1]), lats = pts.map((p) => p.coords![0]);
    if (!pts.length) { map.jumpTo({ center: [18.07, 59.33], zoom: 10 }); return; }
    const cam = map.cameraForBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 60 });
    if (cam) map.jumpTo({ center: cam.center, zoom: Math.min(14, cam.zoom ?? 12) });
  }
}

const round = (v: number) => Math.round(v * 1e5) / 1e5;
