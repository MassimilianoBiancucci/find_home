import { Component, ElementRef, OnDestroy, afterNextRender, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import type { Map as MlMap } from 'maplibre-gl';
import { ApiService, apiError } from '../services/api.service';

/**
 * MapLibre map: candidates coloured by score, your points coloured by category.
 * 2D/tilt toggle and 3D building extrusion when the style has building heights.
 * The map provider sits behind this component only, so a Google adapter can replace it later (docs/google-apis.md).
 */
@Component({
  selector: 'fh-map',
  template: `
  <div class="fh-page-head">
    <h1>Map</h1>
    <button class="btn btn-sm btn-outline-secondary" (click)="toggle3d()">{{ tilted() ? '2D' : '3D tilt' }}</button>
    <label class="small"><input type="checkbox" class="form-check-input me-1" [checked]="showRejected()" (change)="toggleRejected()" />show rejected</label>
    <span class="small text-body-secondary ms-auto">
      <span class="fh-legend" style="background:var(--fh-good)"></span> ≥ .75
      <span class="fh-legend" style="background:var(--fh-mid)"></span> ≥ .5
      <span class="fh-legend" style="background:var(--fh-bad)"></span> lower
      <span class="fh-legend" style="background:#888"></span> unscored · black ring = your points
    </span>
  </div>
  @if (error()) { <div class="alert alert-danger py-1 small">{{ error() }}</div> }
  @if (missing().length) { <div class="alert alert-warning py-1 small">Points without coordinates (set an address or coords in Locations): {{ missing().join(', ') }}</div> }
  <div #mapEl class="fh-map"></div>
  `,
  styles: [`
    .fh-map { height: calc(100vh - 110px); min-height: 380px; border-radius: 8px; border: 1px solid var(--bs-border-color); }
    .fh-legend { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin: 0 3px 0 8px; }
  `],
})
export class MapPage implements OnDestroy {
  private api = inject(ApiService);
  private router = inject(Router);
  private el = viewChild.required<ElementRef<HTMLDivElement>>('mapEl');
  private map?: MlMap;
  protected tilted = signal(false);
  protected showRejected = signal(false);
  protected error = signal('');
  protected missing = signal<string[]>([]);

  constructor() { afterNextRender(() => this.init()); }

  private async init(): Promise<void> {
    const mod: any = await import('maplibre-gl');
    const ml: typeof import('maplibre-gl') = mod.default ?? mod;   // CommonJS module: default export in ESM builds
    forkJoin({ s: this.api.mapSettings(), pts: this.api.mapPoints(), lst: this.api.mapListings() }).subscribe({
      next: ({ s, pts, lst }) => {
        this.missing.set(pts.features.filter((f) => !f.geometry).map((f) => String(f.properties?.['id'])));
        const map = new ml.Map({
          container: this.el().nativeElement, style: s.style_url,
          center: [s.center[1], s.center[0]], zoom: s.zoom, attributionControl: { customAttribution: s.attribution },
        });
        this.map = map;
        map.addControl(new ml.NavigationControl({ visualizePitch: true }), 'top-right');
        let ready = false;
        // Offline or blocked style: fall back to a plain background so markers still show.
        map.on('error', () => {
          if (ready || map.isStyleLoaded()) return;
          this.error.set('Map style could not be loaded (offline or blocked): markers on a blank background. Check map.style_url in config/providers.yaml.');
          map.setStyle({ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#dfe3e8' } }] });
          map.once('style.load', onReady);
        });
        const onReady = () => {
          if (ready) return;
          ready = true;
          map.addSource('points', { type: 'geojson', data: { ...pts, features: pts.features.filter((f) => f.geometry) } as any });
          map.addSource('listings', { type: 'geojson', data: lst as any });
          this.addBuildings(map);
          map.addLayer({
            id: 'listings', type: 'circle', source: 'listings',
            filter: ['==', ['coalesce', ['length', ['coalesce', ['get', 'rejected_by'], ['literal', []]]], 0], 0],
            paint: {
              'circle-radius': 7, 'circle-stroke-width': 1.5, 'circle-stroke-color': '#fff',
              'circle-color': ['case', ['==', ['get', 'score'], null], '#888',
                ['step', ['get', 'score'], '#e53e3e', 0.5, '#d69e2e', 0.75, '#1f9d55']],
            },
          });
          map.addLayer({
            id: 'listings-rejected', type: 'circle', source: 'listings', layout: { visibility: 'none' },
            filter: ['>', ['length', ['coalesce', ['get', 'rejected_by'], ['literal', []]]], 0],
            paint: { 'circle-radius': 5, 'circle-color': '#e53e3e', 'circle-opacity': 0.4 },
          });
          if (map.getStyle().glyphs) map.addLayer({
            id: 'points', type: 'symbol', source: 'points',
            layout: { 'text-field': ['get', 'label'], 'text-offset': [0, 1.3], 'text-size': 12, 'icon-allow-overlap': true },
            paint: { 'text-halo-color': '#fff', 'text-halo-width': 1.2 },
          });
          map.addLayer({
            id: 'points-mark', type: 'circle', source: 'points',
            paint: { 'circle-radius': 8, 'circle-color': ['coalesce', ['get', 'color'], '#607d8b'], 'circle-stroke-width': 3, 'circle-stroke-color': '#000' },
          });
          map.on('click', 'listings', (e) => {
            const p = e.features?.[0]?.properties as Record<string, any> | undefined;
            if (!p) return;
            new ml.Popup().setLngLat(e.lngLat).setHTML(
              `<b>${p['short_id']}</b> · ${p['area'] ?? ''}<br>${p['rooms_rok'] ?? '?'} rok · ${p['size_m2'] ?? '?'} m² · ${p['rent_sek'] ?? '?'} kr<br>`
              + `score ${p['score'] ?? '–'} · pets ${p['pet_status']}<br><a href="/candidates/${p['short_id']}" data-id="${p['short_id']}">open</a>`,
            ).addTo(map).getElement().querySelector('a')?.addEventListener('click', (ev) => {
              ev.preventDefault(); this.router.navigate(['/candidates', p['short_id']]);
            });
          });
          map.on('mouseenter', 'listings', () => (map.getCanvas().style.cursor = 'pointer'));
          map.on('mouseleave', 'listings', () => (map.getCanvas().style.cursor = ''));
        };
        map.on('load', onReady);
      },
      error: (e) => this.error.set(apiError(e)),
    });
  }

  /** 3D extrusion from the style's building layer (OpenMapTiles schema), if present. */
  private addBuildings(map: MlMap): void {
    const src = Object.entries(map.getStyle().sources ?? {}).find(([, s]) => (s as any).type === 'vector')?.[0];
    if (!src) return;
    try {
      map.addLayer({
        id: 'fh-3d-buildings', source: src, 'source-layer': 'building', type: 'fill-extrusion', minzoom: 14,
        layout: { visibility: 'none' },
        paint: {
          'fill-extrusion-color': '#aab', 'fill-extrusion-opacity': 0.6,
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 10],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        },
      });
    } catch { /* style without building heights */ }
  }

  toggle3d(): void {
    const on = !this.tilted();
    this.tilted.set(on);
    this.map?.easeTo({ pitch: on ? 60 : 0, bearing: on ? -17 : 0 });
    if (this.map?.getLayer('fh-3d-buildings')) this.map.setLayoutProperty('fh-3d-buildings', 'visibility', on ? 'visible' : 'none');
  }

  toggleRejected(): void {
    this.showRejected.update((v) => !v);
    this.map?.setLayoutProperty('listings-rejected', 'visibility', this.showRejected() ? 'visible' : 'none');
  }

  ngOnDestroy(): void { this.map?.remove(); }
}
