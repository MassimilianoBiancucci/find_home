import { Component, DestroyRef, ElementRef, afterNextRender, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { forkJoin } from 'rxjs';
import type { Map as MlMap, StyleSpecification } from 'maplibre-gl';
import { ApiService, apiError } from '../../services/api.service';
import { ThemeService } from '../../services/theme.service';
import { blipExpr, installBlip, installPin } from '../../components/map-icons';
import { applyDarkWater } from './dark-style';
import { MapLib, MapStateService } from './map-state.service';
import { ProbeService } from './probe.service';
import { PoiLayersService } from './poi-layers.service';
import { TransitLayersService } from './transit-layers.service';
import { ConnectivityService } from './connectivity.service';
import { ContextMenuService } from './context-menu.service';
import { MapContextMenu } from './map-context-menu';

const BLANK: StyleSpecification = { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#2a2a30' } }] };

/**
 * Map page: one MapLibre instance (MapStateService) shared by the modes under /map (child routes).
 * The shell owns the base layers (listings, your points, 3D buildings) and swaps the base style with the colour mode.
 * The map provider sits behind this page only, so a Google adapter can replace it later (guide/documentation/google-apis.md).
 */
@Component({
  selector: 'fh-map-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MapContextMenu],
  template: `
  <div class="fh-map-shell">
    <div class="fh-map-bar">
      <div class="fh-modes">
        <a routerLink="explore" routerLinkActive="on">Explore</a>
        <a routerLink="area" routerLinkActive="on">Area</a>
        <a routerLink="connectivity" routerLinkActive="on">Connectivity</a>
        <a routerLink="zone" routerLinkActive="on">Zone</a>
      </div>
      <button class="btn btn-sm btn-outline-secondary" (click)="toggle3d()">{{ tilted() ? '2D' : '3D tilt' }}</button>
      <button class="btn btn-sm" [class.btn-primary]="probe.picking()" [class.btn-outline-primary]="!probe.picking()"
        title="Click the map to drop a test point (or right-click → Set test point here)" (click)="probe.picking.set(!probe.picking())">
        {{ probe.picking() ? 'Click the map…' : 'Test point' }}</button>
      @if (state.testPoint()) { <button class="btn btn-sm btn-link p-0" (click)="probe.clear()">clear test point</button> }
      @if (missing().length) { <span class="small text-warning" title="Set an address or coords in Locations">no coords: {{ missing().join(', ') }}</span> }
      @if (error()) { <span class="small text-danger">{{ error() }}</span> }
    </div>
    <div class="fh-map-wrap">
      <div #mapEl class="fh-map" [class.picking]="probe.picking()"></div>
      <fh-map-context-menu />
      @if (conn.hover(); as h) {
        <div class="fh-hover">
          <b>{{ h.name }}</b>@if (h.estimate) {<sup title="straight-line estimate">~</sup>}
          @for (v of h.values; track v.label) { <span>{{ v.label }} {{ v.minutes == null ? '–' : v.minutes + '′' }}</span> }
          @if (h.weighted != null) { <span class="w">mix {{ h.weighted }}′</span> }
        </div>
      }
    </div>
    <router-outlet />
  </div>`,
  styles: [`
    .fh-map-shell { display: flex; flex-direction: column; height: calc(100vh - 32px); gap: 8px; }
    .fh-map-bar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .fh-modes { display: inline-flex; border: 1px solid var(--bs-border-color); border-radius: 999px; padding: 2px; background: var(--fh-sub);
      a { padding: 3px 14px; border-radius: 999px; text-decoration: none; color: var(--bs-secondary-color); font-size: .85rem; font-weight: 500;
        &.on { background: var(--fh-accent-fill); color: var(--fh-on-accent); box-shadow: 0 0 0 1px var(--fh-violet); } } }
    .fh-map-wrap { flex: 1; min-height: 320px; position: relative; display: flex; }
    .fh-map { flex: 1; min-height: 320px; border-radius: 8px; border: 1px solid var(--bs-border-color); overflow: hidden; }
    .fh-hover { position: absolute; left: 10px; top: 10px; z-index: 2; display: flex; flex-wrap: wrap; gap: 4px 10px; max-width: 70%;
      padding: 5px 10px; border-radius: 8px; font-size: .8rem; background: rgba(20, 20, 24, .86); color: #f2f2f7;
      border: 1px solid rgba(192, 132, 252, .5); box-shadow: 0 4px 14px rgba(0, 0, 0, .4); pointer-events: none;
      .w { color: #d8b4fe; font-weight: 600; } }
    .fh-map.picking { cursor: crosshair; }
  `],
})
export class MapShell {
  private api = inject(ApiService);
  private theme = inject(ThemeService);
  protected state = inject(MapStateService);
  protected probe = inject(ProbeService);
  private poiLayers = inject(PoiLayersService);
  private transit = inject(TransitLayersService);
  protected conn = inject(ConnectivityService);
  private menu = inject(ContextMenuService);
  private router = inject(Router);
  private el = viewChild.required<ElementRef<HTMLDivElement>>('mapEl');
  protected tilted = signal(false);
  protected error = signal('');
  protected missing = signal<string[]>([]);
  private styleFailed = false;

  constructor() {
    const destroy = inject(DestroyRef);
    afterNextRender(() => void this.init(destroy));
    this.menu.register(destroy, [
      { id: 'test-point', order: 10, label: () => 'Set test point here', run: (c) => this.probe.set(c.lat, c.lon) },
      { id: 'zone-view', order: 20, label: (c) => (c.zone ? `Open zone view: ${c.zone.name}` : 'Open zone view'),
        enabled: (c) => !!c.zone, run: (c) => void this.router.navigate(['/map/zone', c.zone!.id]) },
    ]);
    effect(() => {
      const mode = this.theme.theme();
      untracked(() => this.applyStyle(mode));
    });
  }

  private styleUrl(mode: string): string | undefined {
    const s = this.state.settings();
    return s ? (mode === 'dark' && s.style_url_dark ? s.style_url_dark : s.style_url) : undefined;
  }

  private applyStyle(mode: string): void {
    const map = this.state.map();
    const url = this.styleUrl(mode);
    if (map && url && !this.styleFailed) {
      this.state.styleChanging();
      map.setStyle(url, { diff: false });
    }
  }

  private async init(destroy: DestroyRef): Promise<void> {
    const mod: any = await import('maplibre-gl');
    const ml: MapLib = mod.default ?? mod;   // CommonJS module: default export in ESM builds
    forkJoin({ s: this.api.mapSettings(), pts: this.api.mapPoints(), lst: this.api.mapListings() }).subscribe({
      next: ({ s, pts, lst }) => {
        this.state.settings.set(s);
        this.missing.set(pts.features.filter((f) => !f.geometry).map((f) => String(f.properties?.['id'])));
        const map = new ml.Map({
          container: this.el().nativeElement, style: this.styleUrl(this.theme.theme())!,
          center: [s.center[1], s.center[0]], zoom: s.zoom, attributionControl: { customAttribution: s.attribution },
        });
        this.state.attach(ml, map);
        destroy.onDestroy(() => { this.state.detach(); map.remove(); });
        map.addControl(new ml.NavigationControl({ visualizePitch: true }), 'top-right');
        map.addControl(new ml.ScaleControl({ unit: 'metric' }), 'bottom-left');
        new ResizeObserver(() => map.resize()).observe(this.el().nativeElement);
        map.on('error', () => {
          if (this.state.ready() || this.styleFailed) return;
          this.styleFailed = true;
          this.error.set('Map style could not be loaded (offline or blocked): blank background. Check map.style_url in config/providers.yaml.');
          map.setStyle(BLANK);
        });
        map.on('style.load', () => {
          if (this.theme.theme() === 'dark') applyDarkWater(map);
          this.state.reapply();
        });
        map.on('styleimagemissing', (e) => { installBlip(map, e.id); installPin(map, e.id); });
        map.on('click', (e) => {
          if (!this.probe.picking()) return;
          this.probe.picking.set(false);
          this.probe.set(e.lngLat.lat, e.lngLat.lng);
        });
        map.on('contextmenu', (e) => {
          e.preventDefault();
          const { lat, lng } = e.lngLat;
          this.menu.open({ lat, lon: lng, x: e.point.x, y: e.point.y, zone: null });
          this.api.zoneAt(lat, lng).subscribe({ next: (r) => this.menu.setZone(r.zone), error: () => undefined });
        });
        map.on('movestart', () => this.menu.close());
        this.addBaseLayers(map, pts, lst);
        this.probe.install();
        this.poiLayers.install();
        this.transit.install();
        this.conn.installTint();
      },
      error: (e) => this.error.set(apiError(e)),
    });
  }

  private addBaseLayers(map: MlMap, pts: any, lst: any): void {
    const scored = ['==', ['coalesce', ['length', ['coalesce', ['get', 'rejected_by'], ['literal', []]]], 0], 0];
    this.state.addGroup({
      id: 'buildings-3d',
      layers: (style) => {
        const src = Object.entries(style.sources ?? {}).find(([, s]) => (s as any).type === 'vector')?.[0];
        return src ? [{
          id: 'fh-3d-buildings', source: src, 'source-layer': 'building', type: 'fill-extrusion', minzoom: 14,
          layout: { visibility: this.tilted() ? 'visible' : 'none' },
          paint: { 'fill-extrusion-color': '#8a8a9a', 'fill-extrusion-opacity': 0.55,
            'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 10], 'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0] },
        } as any] : [];
      },
    });
    this.state.addGroup({
      id: 'listings',
      sources: { listings: { type: 'geojson', data: lst } },
      layers: [{
        id: 'listings', type: 'symbol', source: 'listings', filter: scored as any,
        layout: { 'icon-allow-overlap': true, 'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.7, 15, 1.05],
          'icon-image': ['case', ['==', ['get', 'score'], null], 'blip:home:888888',
            ['step', ['to-number', ['get', 'score'], 0], 'blip:home:e53e3e', 0.5, 'blip:home:d69e2e', 0.75, 'blip:home:1f9d55']] },
      } as any],
    });
    this.state.addGroup({
      id: 'listings-rejected',
      layers: [{ id: 'listings-rejected', type: 'circle', source: 'listings', filter: ['!', scored] as any,
        paint: { 'circle-radius': 5, 'circle-color': '#e53e3e', 'circle-opacity': 0.4 } }],
    });
    if (this.state.visible()['listings-rejected'] === undefined) this.state.setVisible('listings-rejected', false);
    this.state.addGroup({
      id: 'points',
      sources: { points: { type: 'geojson', data: { ...pts, features: pts.features.filter((f: any) => f.geometry) } } },
      layers: (style) => [
        { id: 'points-mark', type: 'symbol', source: 'points',
          layout: { 'icon-image': blipExpr('pin', '#607d8b'), 'icon-size': 1.35, 'icon-allow-overlap': true, 'icon-ignore-placement': true } } as any,
        ...(style.glyphs ? [{ id: 'points-label', type: 'symbol', source: 'points',
          layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Regular'], 'text-offset': [0, 1.4], 'text-size': 12, 'text-anchor': 'top' },
          paint: { 'text-color': '#fff', 'text-halo-color': '#101014', 'text-halo-width': 1.4 } } as any] : []),
      ],
    });
    const select = (kind: 'listing' | 'point') => (e: any) => {
      const f = e.features?.[0];
      if (!f) return;
      const [lon, lat] = f.geometry?.coordinates ?? [e.lngLat.lng, e.lngLat.lat];
      this.state.selection.set({ kind, props: { ...f.properties, lat, lon } });
    };
    map.on('click', 'listings', select('listing'));
    map.on('click', 'points-mark', select('point'));
    for (const id of ['listings', 'points-mark']) {
      map.on('mouseenter', id, () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', id, () => (map.getCanvas().style.cursor = ''));
    }
  }

  protected toggle3d(): void {
    const on = !this.tilted();
    this.tilted.set(on);
    const map = this.state.map();
    map?.easeTo({ pitch: on ? 60 : 0, bearing: on ? -17 : 0 });
    if (map?.getLayer('fh-3d-buildings')) map.setLayoutProperty('fh-3d-buildings', 'visibility', on ? 'visible' : 'none');
  }
}
