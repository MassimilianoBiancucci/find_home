import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { ProbeResult, ProbeTrip } from '../../models';
import { ApiService, apiError } from '../../services/api.service';
import { MapStateService } from './map-state.service';
import { blipExpr } from '../../components/map-icons';

const EMPTY = { type: 'FeatureCollection', features: [] as any[] };
export const PROBE_VIOLET = '#b45cf0';
/** Leg colour per mode until the transit layer provides real line colours. */
export const MODE_COLOURS: Record<string, string> = {
  walk: '#f2f2f7', metro: '#0089ca', commuter_rail: '#ec619f', train: '#ec619f', local_rail: '#a05fa5',
  tram: '#f39200', bus: '#d71d24', ferry: '#3ab4d8', transit: '#c084fc',
};

/** The test point shared by every map mode: probe request, its result, and the pin / walk / leg layers. */
@Injectable({ providedIn: 'root' })
export class ProbeService {
  private api = inject(ApiService);
  private state = inject(MapStateService);
  readonly result = signal<ProbeResult | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly activeTrip = signal<string | null>(null);
  readonly picking = signal(false);
  private seq = 0;

  readonly trip = computed<ProbeTrip | null>(() => this.result()?.trips.find((t) => t.point_id === this.activeTrip()) ?? null);

  constructor() {
    effect(() => {
      const p = this.state.testPoint();
      untracked(() => this.run(p));
    });
    effect(() => { this.trip(); untracked(() => this.draw()); });
  }

  set(lat: number, lon: number): void { this.state.testPoint.set({ lat: +lat.toFixed(6), lon: +lon.toFixed(6) }); }
  clear(): void { this.state.testPoint.set(null); }

  /** Map layers of the test point; call once the map exists (the shell does). */
  install(): void {
    this.state.addGroup({
      id: 'test-point',
      sources: { 'probe-pin': { type: 'geojson', data: EMPTY as any }, 'probe-walk': { type: 'geojson', data: EMPTY as any },
        'probe-legs': { type: 'geojson', data: EMPTY as any }, 'probe-hits': { type: 'geojson', data: EMPTY as any } },
      layers: [
        { id: 'probe-walk', type: 'line', source: 'probe-walk', layout: { 'line-cap': 'round' },
          paint: { 'line-color': ['coalesce', ['get', 'color'], '#fff'], 'line-width': 2, 'line-dasharray': [1, 2], 'line-opacity': 0.85 } },
        { id: 'probe-legs-casing', type: 'line', source: 'probe-legs', layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#101014', 'line-width': 7, 'line-opacity': 0.8 } },
        { id: 'probe-legs', type: 'line', source: 'probe-legs', layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': ['get', 'color'], 'line-width': 4, 'line-dasharray': ['case', ['==', ['get', 'mode'], 'walk'], ['literal', [1, 1.5]], ['literal', [1, 0]]] as any } },
        { id: 'probe-hits', type: 'symbol', source: 'probe-hits',
          layout: { 'icon-image': blipExpr(), 'icon-size': 1.05, 'icon-allow-overlap': true } },
        { id: 'probe-pin', type: 'symbol', source: 'probe-pin',
          layout: { 'icon-image': `blip:target:${PROBE_VIOLET.slice(1)}`, 'icon-size': 1.5, 'icon-allow-overlap': true, 'icon-ignore-placement': true } },
      ],
    });
    this.draw();
  }

  private run(p: { lat: number; lon: number } | null): void {
    const id = ++this.seq;
    this.error.set('');
    if (!p) { this.result.set(null); this.draw(); return; }
    this.loading.set(true);
    this.result.set(null);
    this.draw();
    this.api.probe(p.lat, p.lon).subscribe({
      next: (r) => {
        if (id !== this.seq) return;
        this.result.set(r);
        if (!r.trips.some((t) => t.point_id === this.activeTrip())) this.activeTrip.set(r.trips.find((t) => t.legs.length)?.point_id ?? null);
        this.loading.set(false);
        this.draw();
      },
      error: (e) => { if (id === this.seq) { this.error.set(apiError(e)); this.loading.set(false); } },
    });
  }

  private draw(): void {
    const p = this.state.testPoint();
    const r = this.result();
    const pin = p ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: {} }] } : EMPTY;
    const walk: any[] = [], hits: any[] = [];
    for (const c of r?.pois.categories ?? []) {
      const best = c.items[0];
      if (!best || !p) continue;
      hits.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [best.lon, best.lat] }, properties: { icon: c.icon, color: c.color } });
      if (c.within || c.category === 'sats') walk.push({ type: 'Feature', properties: { color: c.color },
        geometry: { type: 'LineString', coordinates: [[p.lon, p.lat], [best.lon, best.lat]] } });
    }
    const legs = (this.trip()?.legs ?? []).filter((l) => l.path.length > 1).map((l) => ({
      type: 'Feature', properties: { mode: l.mode, color: l.color ?? MODE_COLOURS[l.mode] ?? MODE_COLOURS['transit'] },
      geometry: { type: 'LineString', coordinates: l.path } }));
    this.state.setData('probe-pin', pin);
    this.state.setData('probe-walk', { type: 'FeatureCollection', features: walk });
    this.state.setData('probe-hits', { type: 'FeatureCollection', features: hits });
    this.state.setData('probe-legs', { type: 'FeatureCollection', features: legs });
  }
}
