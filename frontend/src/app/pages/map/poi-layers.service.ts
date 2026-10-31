import { Injectable, inject, signal } from '@angular/core';
import type { Map as MlMap } from 'maplibre-gl';
import { PoiCategory } from '../../models';
import { ApiService, apiError } from '../../services/api.service';
import { blipId } from '../../components/map-icons';
import { MapStateService } from './map-state.service';

const MIN_ZOOM: Record<string, number> = { bus_stop: 14, grocery: 12, park: 12 };
const ON_BY_DEFAULT = new Set(['sats']);

/** One symbol layer per poi.yaml category, data loaded the first time a category is switched on. */
@Injectable({ providedIn: 'root' })
export class PoiLayersService {
  private api = inject(ApiService);
  private state = inject(MapStateService);
  readonly categories = signal<PoiCategory[]>([]);
  readonly error = signal('');
  private loaded = new Set<string>();
  private installedOn?: MlMap;

  install(): void {
    const map = this.state.map();
    if (!map || map === this.installedOn) return;
    this.installedOn = map;
    this.loaded.clear();
    this.api.poiCategories().subscribe({
      next: (cats) => {
        this.categories.set(cats);
        for (const c of cats) this.addCategory(map, c);
      },
      error: (e) => this.error.set(apiError(e)),
    });
  }

  toggle(key: string): void {
    const id = `poi-${key}`;
    const on = !this.state.isVisible(id, ON_BY_DEFAULT.has(key));
    this.state.setVisible(id, on);
    if (on) this.ensureData(key);
  }

  isOn(key: string): boolean { return this.state.isVisible(`poi-${key}`, ON_BY_DEFAULT.has(key)); }

  private addCategory(map: MlMap, c: PoiCategory): void {
    const id = `poi-${c.key}`;
    if (this.state.visible()[id] === undefined) this.state.setVisible(id, ON_BY_DEFAULT.has(c.key));
    this.state.addGroup({
      id, below: 'test-point',
      sources: { [id]: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } },
      layers: (style) => [
        { id, type: 'symbol', source: id, minzoom: MIN_ZOOM[c.key] ?? 10,
          layout: { 'icon-image': blipId(c.icon, c.color), 'icon-allow-overlap': c.key === 'sats',
            'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.65, 15, 1] } } as any,
        ...(style.glyphs ? [{ id: `${id}-label`, type: 'symbol', source: id, minzoom: 15,
          layout: { 'text-field': ['coalesce', ['get', 'name'], ''], 'text-font': ['Noto Sans Regular'], 'text-size': 11,
            'text-offset': [0, 1.3], 'text-anchor': 'top', 'text-optional': true },
          paint: { 'text-color': '#fff', 'text-halo-color': '#101014', 'text-halo-width': 1.3 } } as any] : []),
      ],
    });
    map.on('click', id, (e: any) => {
      const f = e.features?.[0];
      if (!f) return;
      const [lon, lat] = f.geometry.coordinates;
      this.state.selection.set({ kind: 'feature', layer: id, lngLat: [lon, lat], props: { ...f.properties, category_label: c.label, icon: c.icon, color: c.color } });
    });
    map.on('mouseenter', id, () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', id, () => (map.getCanvas().style.cursor = ''));
    if (this.isOn(c.key)) this.ensureData(c.key);
  }

  private ensureData(key: string): void {
    if (this.loaded.has(key)) return;
    this.loaded.add(key);
    this.api.poi([key]).subscribe({
      next: (fc) => this.state.setData(`poi-${key}`, fc),
      error: (e) => { this.loaded.delete(key); this.error.set(apiError(e)); },
    });
  }
}
