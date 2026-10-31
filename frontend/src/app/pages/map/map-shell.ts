import { Component, DestroyRef, ElementRef, afterNextRender, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { forkJoin } from 'rxjs';
import type { Map as MlMap, StyleSpecification } from 'maplibre-gl';
import { ApiService, apiError } from '../../services/api.service';
import { ThemeService } from '../../services/theme.service';
import { MapLib, MapStateService } from './map-state.service';

const BLANK: StyleSpecification = { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#2a2a30' } }] };

/**
 * Map page: one MapLibre instance (MapStateService) shared by the modes under /map (child routes).
 * The shell owns the base layers (listings, your points, 3D buildings) and swaps the base style with the colour mode.
 * The map provider sits behind this page only, so a Google adapter can replace it later (docs/google-apis.md).
 */
@Component({
  selector: 'fh-map-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
  <div class="fh-map-shell">
    <div class="fh-map-bar">
      <div class="fh-modes">
        <a routerLink="explore" routerLinkActive="on">Explore</a>
        <a routerLink="area" routerLinkActive="on">Area</a>
        <a routerLink="connectivity" routerLinkActive="on">Connectivity</a>
      </div>
      <button class="btn btn-sm btn-outline-secondary" (click)="toggle3d()">{{ tilted() ? '2D' : '3D tilt' }}</button>
      @if (missing().length) { <span class="small text-warning" title="Set an address or coords in Locations">no coords: {{ missing().join(', ') }}</span> }
      @if (error()) { <span class="small text-danger">{{ error() }}</span> }
    </div>
    <div #mapEl class="fh-map"></div>
    <router-outlet />
  </div>`,
  styles: [`
    .fh-map-shell { display: flex; flex-direction: column; height: calc(100vh - 32px); gap: 8px; }
    .fh-map-bar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .fh-modes { display: inline-flex; border: 1px solid var(--bs-border-color); border-radius: 999px; padding: 2px; background: var(--fh-sub);
      a { padding: 3px 14px; border-radius: 999px; text-decoration: none; color: var(--bs-secondary-color); font-size: .85rem; font-weight: 500;
        &.on { background: var(--fh-accent-fill); color: var(--fh-on-accent); box-shadow: 0 0 0 1px var(--fh-violet); } } }
    .fh-map { flex: 1; min-height: 320px; border-radius: 8px; border: 1px solid var(--bs-border-color); overflow: hidden; }
  `],
})
export class MapShell {
  private api = inject(ApiService);
  private theme = inject(ThemeService);
  protected state = inject(MapStateService);
  private el = viewChild.required<ElementRef<HTMLDivElement>>('mapEl');
  protected tilted = signal(false);
  protected error = signal('');
  protected missing = signal<string[]>([]);
  private styleFailed = false;

  constructor() {
    const destroy = inject(DestroyRef);
    afterNextRender(() => void this.init(destroy));
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
        map.on('style.load', () => this.state.reapply());
        this.addBaseLayers(map, pts, lst);
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
        id: 'listings', type: 'circle', source: 'listings', filter: scored as any,
        paint: { 'circle-radius': 7, 'circle-stroke-width': 1.5, 'circle-stroke-color': '#fff',
          'circle-color': ['case', ['==', ['get', 'score'], null], '#888', ['step', ['to-number', ['get', 'score'], 0], '#e53e3e', 0.5, '#d69e2e', 0.75, '#1f9d55']] },
      }],
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
        { id: 'points-mark', type: 'circle', source: 'points',
          paint: { 'circle-radius': 8, 'circle-color': ['coalesce', ['get', 'color'], '#607d8b'], 'circle-stroke-width': 3, 'circle-stroke-color': '#000' } },
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
