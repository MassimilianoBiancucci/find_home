import { Injectable, inject, signal } from '@angular/core';
import type { Map as MlMap } from 'maplibre-gl';
import { TransitMeta } from '../../models';
import { ApiService, apiError } from '../../services/api.service';
import { blipExpr } from '../../components/map-icons';
import { MapStateService } from './map-state.service';

const ON_BY_DEFAULT = new Set(['metro', 'commuter_rail', 'local_rail', 'tram']);
const MIN_ZOOM: Record<string, number> = { bus: 12 };
const WIDTH: Record<string, number> = { metro: 4, commuter_rail: 3.5, local_rail: 3, train: 2.5, tram: 3, bus: 1.6, ferry: 2 };

/** SL network from data/geo/transit: one line layer per mode (loaded when first shown) and the stations. */
@Injectable({ providedIn: 'root' })
export class TransitLayersService {
  private api = inject(ApiService);
  private state = inject(MapStateService);
  readonly meta = signal<TransitMeta | null>(null);
  readonly error = signal('');
  private loaded = new Set<string>();
  private installedOn?: MlMap;

  install(): void {
    const map = this.state.map();
    if (!map || map === this.installedOn) return;
    this.installedOn = map;
    this.loaded.clear();
    this.api.transitMeta().subscribe({
      next: (m) => {
        this.meta.set(m);
        if (!m.built) return;
        for (const mode of [...m.modes].reverse()) this.addMode(map, mode.mode);   // metro drawn last = on top
        this.addStations(map);
      },
      error: (e) => this.error.set(apiError(e)),
    });
  }

  isOn(id: string): boolean { return this.state.isVisible(id, ON_BY_DEFAULT.has(id.replace('transit-', '')) || id === 'transit-stations'); }

  toggle(id: string): void {
    const on = !this.isOn(id);
    this.state.setVisible(id, on);
    if (on) this.ensureData(id);
  }

  private addMode(map: MlMap, mode: string): void {
    const id = `transit-${mode}`;
    if (this.state.visible()[id] === undefined) this.state.setVisible(id, ON_BY_DEFAULT.has(mode));
    const w = WIDTH[mode] ?? 2;
    this.state.addGroup({
      id, below: 'listings',
      sources: { [id]: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } },
      layers: [
        { id: `${id}-casing`, type: 'line', source: id, minzoom: MIN_ZOOM[mode] ?? 0, layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': '#101014', 'line-opacity': 0.55, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, w * 0.6 + 2, 15, w * 1.6 + 3] } } as any,
        { id, type: 'line', source: id, minzoom: MIN_ZOOM[mode] ?? 0, layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': ['coalesce', ['get', 'colour'], '#8a8aa0'], 'line-width': ['interpolate', ['linear'], ['zoom'], 10, w * 0.6, 15, w * 1.6],
            ...(mode === 'bus' ? { 'line-opacity': 0.7 } : {}), ...(mode === 'ferry' ? { 'line-dasharray': [2, 1.5] } : {}) } } as any,
      ],
    });
    this.onClick(map, id, (f) => ({ ...f.properties, kind: 'line' }));
    if (this.isOn(id)) this.ensureData(id);
  }

  private addStations(map: MlMap): void {
    const id = 'transit-stations';
    this.state.addGroup({
      id, below: 'listings',
      sources: { [id]: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } },
      layers: (style) => [
        { id, type: 'symbol', source: id, minzoom: 11,
          layout: { 'icon-image': blipExpr('metro'), 'icon-size': ['interpolate', ['linear'], ['zoom'], 11, 0.55, 15, 0.9],
            'icon-allow-overlap': true, 'symbol-sort-key': ['match', ['get', 'mode'], 'metro', 0, 'commuter_rail', 1, 2] } } as any,
        ...(style.glyphs ? [{ id: `${id}-label`, type: 'symbol', source: id, minzoom: 13.5,
          layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-offset': [0, 1.2],
            'text-anchor': 'top', 'text-optional': true },
          paint: { 'text-color': '#fff', 'text-halo-color': '#101014', 'text-halo-width': 1.3 } } as any] : []),
      ],
    });
    this.onClick(map, id, (f) => ({ ...f.properties, kind: 'station',
      lines: typeof f.properties.lines === 'string' ? JSON.parse(f.properties.lines) : f.properties.lines }));
    this.ensureData(id);
  }

  private onClick(map: MlMap, layer: string, props: (f: any) => Record<string, any>): void {
    map.on('click', layer, (e: any) => {
      const f = e.features?.[0];
      if (!f) return;
      this.state.selection.set({ kind: 'feature', layer, lngLat: [e.lngLat.lng, e.lngLat.lat], props: props(f) });
    });
    map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
  }

  private ensureData(id: string): void {
    if (this.loaded.has(id)) return;
    this.loaded.add(id);
    const name = id === 'transit-stations' ? 'stations' : `lines_${id.replace('transit-', '')}`;
    this.api.transitLayer(name).subscribe({
      next: (fc) => this.state.setData(id, fc),
      error: (e) => { this.loaded.delete(id); this.error.set(apiError(e)); },
    });
  }
}
