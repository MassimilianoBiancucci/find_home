import { Injectable, computed, inject, signal } from '@angular/core';
import type { Map as MlMap } from 'maplibre-gl';
import { ConnectivityJob, ConnectivityMatrix, ConnectivityPlan, ConnectivityScope, GeoCollection, IndicesMap, RouteStatus } from '../../models';
import { ApiService, apiError } from '../../services/api.service';
import { MapStateService } from './map-state.service';

/** Minutes → colour, the same ramp in the fill, the tint and the legend. */
export const RAMP: [number, string][] = [[0, '#1f9d55'], [15, '#7bc96f'], [25, '#d6c94a'], [35, '#f0a95a'], [45, '#e5653e'], [60, '#b0303a']];
/** Grey: a zone with only failed routes, or only estimates while estimates are excluded. */
export const NO_DATA_GREY = '#7d7d88';
const colourExpr: any = ['case', ['==', ['get', 'g'], 1], NO_DATA_GREY,
  ['step', ['coalesce', ['get', 'm'], -1], 'rgba(0,0,0,0)', ...RAMP.flatMap(([v, c]) => [v, c])]];   // -1: no data
/** Index percentile → colour (higher is better), for the 'idx:*' views. */
export const IDX_RAMP: [number, string][] = [[0, '#b0303a'], [20, '#e5653e'], [40, '#f0a95a'], [60, '#d6c94a'], [80, '#7bc96f'], [90, '#1f9d55']];
const idxExpr: any = ['step', ['coalesce', ['get', 'p'], -1], 'rgba(0,0,0,0)', ...IDX_RAMP.flatMap(([v, c]) => [v, c])];
/** One colour per route status, shared by the bubble chips, the route list and the legend. */
export const STATUS_COLOURS: Record<RouteStatus, string> = {
  cached: 'var(--fh-good)', stale: 'var(--fh-amber)', estimated: 'var(--fh-blue)', failed: 'var(--fh-bad)',
  missing: 'var(--fh-muted)', pending: 'var(--fh-cyan)',
};
export const SCOPE_LABELS: Record<string, string> = {
  'missing,estimates': 'Refresh', failed: 'Retry failed', stale: 'Update stale',
};
const EMPTY: GeoCollection = { type: 'FeatureCollection', features: [] };

export interface ZoneHover { name: string; district: string; values: { label: string; minutes: number | null }[]; weighted: number | null; estimate: boolean; }

/** Zone × point commute matrix for the Connectivity mode, the Explore tint and the test point. */
@Injectable({ providedIn: 'root' })
export class ConnectivityService {
  private api = inject(ApiService);
  private state = inject(MapStateService);
  readonly matrix = signal<ConnectivityMatrix | null>(null);
  readonly job = signal<ConnectivityJob | null>(null);
  readonly view = signal<string>('weighted');            // 'weighted', a point id, or 'idx:transport' / 'idx:transport_services'
  readonly indices = signal<IndicesMap | null>(null);
  readonly indexWindow = signal<string>('');              // '' = window-weighted average
  readonly opacity = signal(0.55);
  readonly hover = signal<ZoneHover | null>(null);
  readonly error = signal('');
  readonly excludeEstimates = signal(false);
  readonly routesOpen = signal(false);
  readonly plans = signal<Record<string, ConnectivityPlan>>({});        // cost preview per scope key
  /** A zone to fly to and inspect (route list row click); the mode consumes it. */
  readonly focus = signal<{ zone_id: string; lat: number; lon: number } | null>(null);
  private zones: GeoCollection | null = null;
  private poll?: ReturnType<typeof setInterval>;
  private hoverBound = new WeakMap<MlMap, Set<string>>();

  readonly coverage = computed(() => { const m = this.matrix(); return m ? `${m.covered}/${m.zone_count}` : ''; });

  load(): void {
    const zones$ = this.zones ? null : this.api.geoZones();
    zones$?.subscribe({ next: (z) => { this.zones = z; this.redraw(); }, error: (e) => this.error.set(apiError(e)) });
    this.api.connectivity().subscribe({
      next: (m) => { this.matrix.set(m); this.job.set(m.job); this.redraw(); this.loadPlans(); if (m.job.running) this.startPolling(); },
      error: (e) => this.error.set(apiError(e)),
    });
  }

  setView(v: string): void {
    this.view.set(v);
    if (v.startsWith('idx:') && !this.indices()) this.loadIndices(); else this.redraw();
  }
  setIndexWindow(w: string): void { this.indexWindow.set(w); this.loadIndices(); }
  private loadIndices(): void {
    this.api.allIndices(this.indexWindow() || undefined).subscribe({
      next: (i) => { this.indices.set(i); this.redraw(); }, error: (e) => this.error.set(apiError(e)) });
  }

  setOpacity(v: number): void {
    this.opacity.set(v);
    const map = this.state.map();
    if (map?.getLayer('conn-fill')) map.setPaintProperty('conn-fill', 'fill-opacity', v);
  }

  setExcludeEstimates(on: boolean): void { this.excludeEstimates.set(on); this.redraw(); }

  refresh(scope: ConnectivityScope[] = ['missing', 'estimates']): void {
    this.api.connectivityRefresh(scope).subscribe({ next: (j) => { this.job.set(j); this.startPolling(); }, error: (e) => this.error.set(apiError(e)) });
  }
  cancel(): void { this.api.connectivityCancel().subscribe(); }

  /** Answer a paused refresh: continue with the provider, switch to estimates, or stop. */
  decide(action: 'continue' | 'estimate' | 'stop', remember: boolean): void {
    this.api.connectivityDecide(action, remember).subscribe({ next: (j) => this.job.set(j), error: (e) => this.error.set(apiError(e)) });
  }

  /** Cost of each bubble action, so a button says what it will spend before you press it. */
  loadPlans(): void {
    for (const key of Object.keys(SCOPE_LABELS)) {
      this.api.connectivityPlan(key.split(',') as ConnectivityScope[]).subscribe({
        next: (p) => this.plans.update((all) => ({ ...all, [key]: p })),
        error: () => undefined,
      });
    }
  }

  minutes(zoneId: string | null | undefined, pointId: string): number | null {
    return zoneId ? this.matrix()?.zones[zoneId]?.by_point[pointId] ?? null : null;
  }

  /** Full-colour choropleth (Connectivity mode); call removeFill() on leave. */
  addFill(): void {
    this.state.addGroup({
      id: 'connectivity', below: 'listings',
      sources: { 'conn-zones': { type: 'geojson', data: EMPTY as any } },
      layers: [
        { id: 'conn-fill', type: 'fill', source: 'conn-zones', paint: { 'fill-color': colourExpr, 'fill-opacity': this.opacity() } },
        { id: 'conn-line', type: 'line', source: 'conn-zones', paint: { 'line-color': '#101014', 'line-opacity': 0.35, 'line-width': 0.6 } },
      ] as any,
    });
    this.bindHover('conn-fill');
    this.redraw();
  }
  removeFill(): void { this.state.removeGroup('connectivity'); this.hover.set(null); }

  /** Light tint for Explore (toggle 'connectivity-tint' in Layers, off by default). */
  installTint(): void {
    if (!this.state.map()) return;
    if (this.state.visible()['connectivity-tint'] === undefined) this.state.setVisible('connectivity-tint', false);
    this.state.addGroup({
      id: 'connectivity-tint', below: 'listings',
      sources: { 'conn-tint': { type: 'geojson', data: EMPTY as any } },
      layers: [
        { id: 'conn-tint-fill', type: 'fill', source: 'conn-tint', paint: { 'fill-color': colourExpr, 'fill-opacity': 0.14 } },
        { id: 'conn-tint-line', type: 'line', source: 'conn-tint', paint: { 'line-color': colourExpr, 'line-width': 1.2, 'line-opacity': 0.7 } },
      ] as any,
    });
    this.bindHover('conn-tint-fill');
    if (!this.matrix()) this.load(); else this.redraw();
  }

  private bindHover(layer: string): void {
    const map = this.state.map();
    if (!map) return;
    const bound = this.hoverBound.get(map) ?? new Set<string>();
    this.hoverBound.set(map, bound);
    if (bound.has(layer)) return;
    bound.add(layer);
    map.on('mousemove', layer, (e: any) => {
      const p = e.features?.[0]?.properties;
      const m = this.matrix();
      if (!p || !m) return;
      const z = m.zones[p['zone_id']];
      this.hover.set({ name: p['name'], district: p['district'], weighted: z?.weighted ?? null, estimate: !!z?.estimate,
        values: m.points.map((pt) => ({ label: pt.label.split(' · ')[0], minutes: z?.by_point[pt.id] ?? null })) });
    });
    map.on('mouseleave', layer, () => this.hover.set(null));
  }

  private redraw(): void {
    const m = this.matrix();
    if (!this.zones || !m) return;
    const v = this.view();
    const idxKey = v.startsWith('idx:') ? (v.slice(4) as 'transport' | 'transport_services') : null;
    const idx = this.indices();
    const map = this.state.map();
    if (map?.getLayer('conn-fill')) map.setPaintProperty('conn-fill', 'fill-color', idxKey ? idxExpr : colourExpr);
    const failed = new Set(m.failed_zones ?? []);
    const hideEst = this.excludeEstimates();
    const fc = { ...this.zones, features: this.zones.features.map((f) => {
      const id = f.properties['zone_id'];
      const all = m.zones[id];
      const z = hideEst ? m.zones_real?.[id] : all;
      const val = z ? (v === 'weighted' ? z.weighted : z.by_point[v] ?? null) : null;
      const grey = !z && (!!all || failed.has(id)) ? 1 : 0;      // only estimates (excluded) or only failures
      const p = idxKey ? idx?.zones[id]?.[idxKey]?.percentile ?? null : null;
      return { ...f, properties: { ...f.properties, m: val, p, est: all?.estimate ?? false, g: idxKey ? 0 : grey } };
    }) };
    this.state.setData('conn-zones', fc);
    this.state.setData('conn-tint', fc);
  }

  private startPolling(): void {
    if (this.poll) return;
    this.poll = setInterval(() => this.api.connectivityStatus().subscribe({
      next: (j) => {
        this.job.set(j);
        if (!j.running) { clearInterval(this.poll); this.poll = undefined; this.load(); }
      },
      error: () => { clearInterval(this.poll); this.poll = undefined; },
    }), 2000);
  }
}
