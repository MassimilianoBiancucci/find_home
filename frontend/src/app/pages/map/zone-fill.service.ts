import { Injectable, computed, inject, signal } from '@angular/core';
import type { Map as MlMap } from 'maplibre-gl';
import { GeoCollection } from '../../models';
import { ApiService } from '../../services/api.service';
import { MapStateService } from './map-state.service';

export type Classes = 'quantile' | 'equal' | 'percentile';
export type Display = 'fill' | 'extrude' | 'heat';
export type RampName = 'viridis' | 'magma' | 'greens' | 'blues' | 'diverging';
export interface FillSettings { opacity: number; ramp: RampName; classes: Classes; steps: number; display: Display; outline: boolean; reverse: boolean; }
export interface FillLayer {
  key: string; label: string; unit: string; help?: string;
  /** zone id → value (null: no data); `n` per zone when the value needs a minimum count (listing statistics). */
  values: Record<string, number | null>;
  higherIsBetter?: boolean;
  /** Listings view: the 'heat' display draws listing points instead of zones. */
  points?: GeoCollection;
}

/** Colour-blind-safe sequential ramps (low → high) and a diverging one (below → above the median). */
export const RAMPS: Record<RampName, string[]> = {
  viridis: ['#440154', '#46327e', '#365c8d', '#277f8e', '#1fa187', '#4ac16d', '#a0da39', '#fde725'],
  magma: ['#000004', '#2c115f', '#721f81', '#b73779', '#f1605d', '#feb078', '#fcfdbf'],
  greens: ['#e5f5e0', '#c7e9c0', '#a1d99b', '#74c476', '#41ab5d', '#238b45', '#005a32'],
  blues: ['#deebf7', '#c6dbef', '#9ecae1', '#6baed6', '#4292c6', '#2171b5', '#084594'],
  diverging: ['#b2182b', '#d6604d', '#f4a582', '#f7f7f7', '#92c5de', '#4393c3', '#2166ac'],
};
export const NO_DATA = '#5a5a66';
const DEFAULTS: FillSettings = { opacity: 0.6, ramp: 'viridis', classes: 'quantile', steps: 6, display: 'fill', outline: true, reverse: false };
const KEY = 'fh-explore-fill';

/** `steps` colours sampled evenly from a ramp. */
export function sampleRamp(name: RampName, steps: number, reverse = false): string[] {
  const r = RAMPS[name];
  const out = Array.from({ length: steps }, (_, i) => r[Math.round((i * (r.length - 1)) / Math.max(1, steps - 1))]);
  return reverse ? out.reverse() : out;
}

/** Upper bounds of each class (the last one is the max). Quantile: equal counts; equal: equal widths;
 *  percentile: the 0-100 rank, so the breaks are fixed at 100/steps. */
export function breaks(values: number[], method: Classes, steps: number): number[] {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return [];
  if (method === 'percentile') return Array.from({ length: steps }, (_, i) => (100 * (i + 1)) / steps);
  if (method === 'equal') {
    const lo = v[0], hi = v[v.length - 1], w = (hi - lo) / steps || 1;
    return Array.from({ length: steps }, (_, i) => (i === steps - 1 ? hi : lo + w * (i + 1)));
  }
  return Array.from({ length: steps }, (_, i) => v[Math.min(v.length - 1, Math.ceil(((i + 1) * v.length) / steps) - 1)]);
}

/** Percentile rank (0-100) of each value among the values. */
export function ranks(values: Record<string, number | null>): Record<string, number | null> {
  const have = Object.values(values).filter((x): x is number => x != null).sort((a, b) => a - b);
  const out: Record<string, number | null> = {};
  for (const [k, v] of Object.entries(values)) {
    if (v == null || !have.length) { out[k] = null; continue; }
    const below = have.filter((x) => x < v).length, same = have.filter((x) => x === v).length;
    out[k] = (100 * (below + same / 2)) / have.length;
  }
  return out;
}

/** Class index of a value (0-based), given the upper bounds. */
export function classOf(v: number, ub: number[]): number {
  const i = ub.findIndex((b) => v <= b);
  return i < 0 ? ub.length - 1 : i;
}

/**
 * Explore's zone choropleth: any per-zone value (indices, POI amount, commute, listing statistics) coloured by
 * class, as a flat fill, a 3D extrusion by value, or (listing views) a point-density heatmap. Settings persist
 * per browser.
 */
@Injectable({ providedIn: 'root' })
export class ZoneFillService {
  private api = inject(ApiService);
  private state = inject(MapStateService);
  readonly settings = signal<FillSettings>(this.read());
  readonly layer = signal<FillLayer | null>(null);
  readonly hover = signal<{ name: string; value: number | null; rank: number | null } | null>(null);
  private zones: GeoCollection | null = null;
  private bound: MlMap | null = null;

  /** Classes for the legend: [from, to, colour]. */
  readonly legend = computed(() => {
    const l = this.layer(), s = this.settings();
    if (!l) return [];
    const vals = this.classValues(l, s);
    const ub = breaks(Object.values(vals).filter((x): x is number => x != null), s.classes, s.steps);
    const cs = sampleRamp(s.ramp, ub.length, s.reverse);
    const lo = Math.min(...Object.values(l.values).filter((x): x is number => x != null));
    return ub.map((b, i) => ({ from: i === 0 ? (s.classes === 'percentile' ? 0 : lo) : ub[i - 1], to: b, colour: cs[i] }));
  });

  show(l: FillLayer | null): void {
    this.layer.set(l);
    if (!l) { this.state.removeGroup('explore-fill'); this.state.removeGroup('explore-heat'); return; }
    if (!this.zones) {
      this.api.geoZones().subscribe({ next: (z) => { this.zones = z; this.draw(); } });
      return;
    }
    this.draw();
  }

  update(patch: Partial<FillSettings>): void {
    this.settings.update((s) => ({ ...s, ...patch }));
    try { localStorage.setItem(KEY, JSON.stringify(this.settings())); } catch { /* storage unavailable */ }
    this.draw();
  }

  clear(): void { this.show(null); }

  private classValues(l: FillLayer, s: FillSettings): Record<string, number | null> {
    return s.classes === 'percentile' ? ranks(l.values) : l.values;
  }

  private draw(): void {
    const l = this.layer(), s = this.settings();
    if (!l || !this.zones) return;
    const vals = this.classValues(l, s);
    const ub = breaks(Object.values(vals).filter((x): x is number => x != null), s.classes, s.steps);
    const cs = sampleRamp(s.ramp, ub.length, s.reverse);
    const rk = ranks(l.values);
    const max = Math.max(1, ...Object.values(l.values).filter((x): x is number => x != null));
    const feats = this.zones.features.map((f: any) => {
      const id = f.properties?.zone_id, v = l.values[id] ?? null, cv = vals[id] ?? null;
      return { ...f, properties: { ...f.properties, v, r: rk[id] ?? null, c: cv == null || !ub.length ? NO_DATA : cs[classOf(cv, ub)],
        h: v == null ? 0 : 30 + 1200 * (v / max), nd: v == null } };
    });
    this.state.removeGroup('explore-fill');
    this.state.removeGroup('explore-heat');
    if (s.display === 'heat' && l.points) {
      this.state.addGroup({ id: 'explore-heat', below: 'listings', sources: { 'explore-heat': { type: 'geojson', data: l.points as any } },
        layers: [{ id: 'explore-heat', type: 'heatmap', source: 'explore-heat',
          paint: { 'heatmap-opacity': s.opacity, 'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 9, 12, 14, 40],
            'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 9, 0.8, 14, 2],
            'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(0,0,0,0)',
              ...sampleRamp(s.ramp, 6, s.reverse).flatMap((c, i) => [(i + 1) / 6, c])] } }] as any });
      return;
    }
    const layers: any[] = s.display === 'extrude'
      ? [{ id: 'explore-fill-3d', type: 'fill-extrusion', source: 'explore-fill', filter: ['!', ['get', 'nd']],
          paint: { 'fill-extrusion-color': ['get', 'c'], 'fill-extrusion-opacity': Math.max(0.3, s.opacity), 'fill-extrusion-height': ['get', 'h'] } }]
      : [{ id: 'explore-fill', type: 'fill', source: 'explore-fill',
          paint: { 'fill-color': ['get', 'c'], 'fill-opacity': ['case', ['get', 'nd'], s.opacity * 0.35, s.opacity] } }];
    if (s.outline) layers.push({ id: 'explore-fill-line', type: 'line', source: 'explore-fill', paint: { 'line-color': '#101014', 'line-opacity': 0.4, 'line-width': 0.6 } });
    // an invisible fill for hovering in 3D as well
    if (s.display === 'extrude') layers.push({ id: 'explore-fill', type: 'fill', source: 'explore-fill', paint: { 'fill-opacity': 0 } });
    this.state.addGroup({ id: 'explore-fill', below: 'listings', sources: { 'explore-fill': { type: 'geojson', data: EMPTY as any } }, layers });
    this.state.setData('explore-fill', { type: 'FeatureCollection', features: feats });
    this.bindHover();
  }

  private bindHover(): void {
    const map = this.state.map();
    if (!map || this.bound === map) return;
    this.bound = map;
    map.on('mousemove', 'explore-fill', (e: any) => {
      const p = e.features?.[0]?.properties;
      this.hover.set(p ? { name: p['name'] ?? p['zone_id'], value: p['v'] === 'null' ? null : p['v'] ?? null, rank: p['r'] ?? null } : null);
    });
    map.on('mouseleave', 'explore-fill', () => this.hover.set(null));
  }

  private read(): FillSettings {
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return DEFAULTS; }
  }
}

const EMPTY: GeoCollection = { type: 'FeatureCollection', features: [] };
