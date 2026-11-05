import { Component, DestroyRef, ElementRef, afterNextRender, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import { applyDarkWater } from '../pages/map/dark-style';
import { ThemeService } from '../services/theme.service';
import { ZoneGeoStore } from '../services/zone-geo.store';
import { installBlip, installPin, pinId } from './map-icons';

const ZONE = '#ff8c1a';
const PIN = pinId('home', '#b45cf0');
type FC = { type: 'FeatureCollection'; features: any[] };
const fc = (features: any[]): FC => ({ type: 'FeatureCollection', features });

/** [[minLon, minLat], [maxLon, maxLat]] of a geometry's coordinates and extra points. */
export function bounds(geom: any, extra: number[][] = []): [[number, number], [number, number]] | null {
  const pts: number[][] = [...extra];
  const walk = (c: any) => { if (typeof c?.[0] === 'number') pts.push(c); else for (const x of c ?? []) walk(x); };
  if (geom) walk(geom.coordinates);
  if (!pts.length) return null;
  const lons = pts.map((p) => p[0]), lats = pts.map((p) => p[1]);
  return [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]];
}

/**
 * A small locator map: the home's zone filled orange in its surroundings, the area outside the analysed zones grey,
 * a standing pin on the home, and the zone's name. Outside every zone: the pin only, in the grey. Not interactive;
 * one map per instance, redrawn in place when the inputs change (the list tooltip reuses one).
 */
@Component({
  selector: 'fh-zone-minimap',
  template: `
    <div class="fh-mm" [style.height.px]="height()">
      <div #el class="fh-mm-map"></div>
      <div class="fh-mm-label">
        @if (zoneName()) { <i class="fh-mm-sw"></i>{{ zoneName() }} } @else if (lat() != null) { outside the analysed zones } @else { no position }
      </div>
    </div>`,
  styles: [`
    :host { display: block; }
    .fh-mm { position: relative; border-radius: 8px; overflow: hidden; box-shadow: inset 0 0 0 1px rgba(255,255,255,.08); background: #2a2a30; }
    .fh-mm-map { position: absolute; inset: 0; }
    .fh-mm-label { position: absolute; left: 8px; top: 8px; padding: 2px 9px; border-radius: 999px; font-size: .78rem; font-weight: 600;
      background: rgba(16,16,22,.78); color: #fff; display: inline-flex; align-items: center; gap: 6px; pointer-events: none;
      box-shadow: 0 1px 4px rgba(0,0,0,.4); }
    .fh-mm-sw { width: 10px; height: 10px; border-radius: 3px; background: ${ZONE}; box-shadow: 0 0 6px ${ZONE}; }
    :host ::ng-deep .maplibregl-ctrl-attrib { font-size: 9px; }
  `],
})
export class ZoneMinimap {
  readonly lat = input<number | null | undefined>(null);
  readonly lon = input<number | null | undefined>(null);
  readonly zoneId = input<string | null | undefined>(null);
  readonly zoneName = input<string | null | undefined>(null);
  readonly height = input(200);

  private geo = inject(ZoneGeoStore);
  private theme = inject(ThemeService);
  private el = viewChild.required<ElementRef<HTMLDivElement>>('el');
  private map: MlMap | null = null;
  private ready = signal(0);
  private zones: FC | null = null;
  private region: { outline: any; mask: any } | null = null;
  private settings: { style_url: string; style_url_dark?: string } | null = null;
  private dark = false;
  /** The style has loaded (sources and layers can be added); isStyleLoaded() stays false while tiles load. */
  private styled = false;

  constructor() {
    const destroy = inject(DestroyRef);
    afterNextRender(() => void this.init(destroy));
    effect(() => {
      const lat = this.lat(), lon = this.lon(), zone = this.zoneId();
      if (!this.ready()) return;
      untracked(() => this.draw(lat ?? null, lon ?? null, zone ?? null));
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

  private async init(destroy: DestroyRef): Promise<void> {
    const mod: any = await import('maplibre-gl');
    const ml = mod.default ?? mod;
    this.geo.zones$.subscribe({ next: (z) => { this.zones = z as FC; this.ready.update((n) => n + 1); }, error: () => undefined });
    this.geo.region$.subscribe({ next: (r) => { this.region = r; this.ready.update((n) => n + 1); }, error: () => undefined });
    this.geo.settings$.subscribe({
      next: (s: any) => {
        this.settings = s;
        this.dark = this.theme.theme() === 'dark';
        const map: MlMap = new ml.Map({ container: this.el().nativeElement, style: (this.dark && s.style_url_dark) || s.style_url,
          center: [this.lon() ?? 18.07, this.lat() ?? 59.33], zoom: 11, interactive: false,
          attributionControl: { customAttribution: s.attribution, compact: true } });
        this.map = map;
        destroy.onDestroy(() => { map.remove(); this.map = null; });
        new ResizeObserver(() => map.resize()).observe(this.el().nativeElement);
        map.on('styleimagemissing', (e) => { installPin(map, e.id); installBlip(map, e.id); });
        map.on('style.load', () => { this.styled = true; if (this.dark) applyDarkWater(map); this.ready.update((n) => n + 1); });
        // the attribution starts expanded and only folds on interaction, which this map has none of: fold it to its ⓘ
        map.once('load', () => this.el().nativeElement.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show'));
      },
      error: () => undefined,
    });
  }

  private draw(lat: number | null, lon: number | null, zoneId: string | null): void {
    const map = this.map;
    if (!map || !this.styled) return;
    const zone = zoneId ? this.zones?.features.find((f) => f.properties?.zone_id === zoneId) ?? null : null;
    const here = lat != null && lon != null ? [lon, lat] : null;
    const data: Record<string, any> = {
      'mm-mask': this.region ? { type: 'Feature', geometry: this.region.mask, properties: {} } : fc([]),
      'mm-zones': this.zones ?? fc([]),
      'mm-zone': zone ? fc([zone]) : fc([]),
      'mm-here': here ? fc([{ type: 'Feature', geometry: { type: 'Point', coordinates: here }, properties: {} }]) : fc([]),
    };
    for (const [id, d] of Object.entries(data)) {
      const src = map.getSource(id) as GeoJSONSource | undefined;
      if (src) src.setData(d); else map.addSource(id, { type: 'geojson', data: d });
    }
    const add = (layer: any) => { if (!map.getLayer(layer.id)) map.addLayer(layer); };
    add({ id: 'mm-mask', type: 'fill', source: 'mm-mask', paint: { 'fill-color': '#9a9aa6', 'fill-opacity': 0.55 } });
    add({ id: 'mm-zones', type: 'line', source: 'mm-zones', paint: { 'line-color': '#c9b8ff', 'line-opacity': 0.25, 'line-width': 0.6 } });
    add({ id: 'mm-zone-fill', type: 'fill', source: 'mm-zone', paint: { 'fill-color': ZONE, 'fill-opacity': 0.42 } });
    add({ id: 'mm-zone-glow', type: 'line', source: 'mm-zone', paint: { 'line-color': ZONE, 'line-width': 7, 'line-blur': 5, 'line-opacity': 0.55 } });
    add({ id: 'mm-zone-line', type: 'line', source: 'mm-zone', paint: { 'line-color': '#ffb066', 'line-width': 2 } });
    add({ id: 'mm-pin', type: 'symbol', source: 'mm-here',
      layout: { 'icon-image': PIN, 'icon-anchor': 'bottom', 'icon-size': 0.78, 'icon-allow-overlap': true, 'icon-ignore-placement': true } });
    // the zone in its surroundings (zoomed out a little), the home alone at city scale, or the whole area
    const b = zone ? bounds(zone.geometry, here ? [here] : []) : null;
    if (b) {
      const cam = map.cameraForBounds(b, { padding: 30, maxZoom: 14 });
      if (cam) map.jumpTo({ center: cam.center, zoom: Math.max(9, (cam.zoom ?? 12) - 1.1) });
    } else if (here) map.jumpTo({ center: here as [number, number], zoom: 11.5 });
    else {
      const rb = this.region ? bounds(this.region.outline) : null;
      if (rb) map.fitBounds(rb, { padding: 10, duration: 0 });
    }
  }
}
