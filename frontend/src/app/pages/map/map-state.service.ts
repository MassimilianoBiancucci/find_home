import { Injectable, isDevMode, signal } from '@angular/core';
import type { LayerSpecification, Map as MlMap, SourceSpecification, StyleSpecification } from 'maplibre-gl';

export type MapLib = typeof import('maplibre-gl');
export interface MapSettings { style_url: string; style_url_dark?: string; attribution: string; center: [number, number]; zoom: number; }

/** A named set of sources and layers a mode adds; re-applied after every style change (theme switch). */
export interface LayerGroup {
  id: string;
  sources?: Record<string, SourceSpecification>;
  layers: LayerSpecification[] | ((style: StyleSpecification) => LayerSpecification[]);
  /** Keep this group below another group's first layer (e.g. polygons under markers). */
  below?: string;
}

export type Selection =
  | { kind: 'listing'; props: Record<string, any> }
  | { kind: 'point'; props: Record<string, any> }
  | { kind: 'feature'; layer: string; props: Record<string, any>; lngLat: [number, number] };

const VIS_KEY = 'fh-map-visible';

/** One MapLibre instance shared by the map modes, plus the state they share (visibility, selection, test point). */
@Injectable({ providedIn: 'root' })
export class MapStateService {
  ml?: MapLib;
  readonly map = signal<MlMap | null>(null);
  readonly styleReady = signal(0);                  // bumps after each style (re)load + groups re-applied
  readonly settings = signal<MapSettings | null>(null);
  readonly selection = signal<Selection | null>(null);
  readonly testPoint = signal<{ lat: number; lon: number } | null>(null);
  readonly visible = signal<Record<string, boolean>>(this.readVisible());
  private groups = new Map<string, LayerGroup>();
  private data = new Map<string, unknown>();
  private loaded = false;                           // map.isStyleLoaded() is false while tiles load, so track the style ourselves

  /** True once the current style has loaded and groups can be added. */
  ready(): boolean { return this.loaded && this.map() !== null; }

  /** Call before map.setStyle: groups are re-applied on the next style load. */
  styleChanging(): void { this.loaded = false; }

  attach(ml: MapLib, map: MlMap): void {
    this.ml = ml;
    this.map.set(map);
    if (isDevMode()) (window as any).fhMap = map;   // inspect from the browser console while developing
  }
  detach(): void { this.loaded = false; this.map.set(null); this.groups.clear(); this.data.clear(); this.selection.set(null); }

  isVisible(id: string, fallback = true): boolean { return this.visible()[id] ?? fallback; }

  setVisible(id: string, on: boolean): void {
    this.visible.update((v) => ({ ...v, [id]: on }));
    try { localStorage.setItem(VIS_KEY, JSON.stringify(this.visible())); } catch { /* storage unavailable */ }
    const map = this.map();
    const g = this.groups.get(id);
    if (!map || !g || !this.loaded) return;
    for (const l of this.layersOf(g, map)) if (map.getLayer(l.id)) map.setLayoutProperty(l.id, 'visibility', on ? 'visible' : 'none');
  }

  addGroup(g: LayerGroup): void {
    this.groups.set(g.id, g);
    const map = this.map();
    if (map && this.loaded) this.apply(map, g);
  }

  removeGroup(id: string): void {
    const g = this.groups.get(id);
    this.groups.delete(id);
    const map = this.map();
    if (!g || !map) return;
    for (const l of this.layersOf(g, map)) if (map.getLayer(l.id)) map.removeLayer(l.id);
    for (const s of Object.keys(g.sources ?? {})) if (map.getSource(s)) map.removeSource(s);
  }

  /** Replace a GeoJSON source's data; remembered so it survives style reloads. */
  setData(sourceId: string, data: unknown): void {
    this.data.set(sourceId, data);
    const src: any = this.map()?.getSource(sourceId);
    src?.setData?.(data);
  }

  /** Called by the canvas after every style load. */
  reapply(): void {
    const map = this.map();
    if (!map) return;
    this.loaded = true;
    for (const g of this.groups.values()) this.apply(map, g);
    this.styleReady.update((n) => n + 1);
  }

  private apply(map: MlMap, g: LayerGroup): void {
    for (const [id, spec] of Object.entries(g.sources ?? {})) {
      if (map.getSource(id)) continue;
      const stored = this.data.get(id);
      map.addSource(id, stored && (spec as any).type === 'geojson' ? { ...(spec as any), data: stored } : spec);
    }
    const before = g.below ? this.firstLayerOf(map, g.below) : undefined;
    const vis = this.isVisible(g.id) ? 'visible' : 'none';
    for (const l of this.layersOf(g, map)) {
      if (map.getLayer(l.id)) continue;
      const layout = { ...((l as any).layout ?? {}), visibility: (l as any).layout?.visibility === 'none' ? 'none' : vis };
      try { map.addLayer({ ...l, layout } as LayerSpecification, before); } catch { /* style lacks a source layer */ }
    }
  }

  private layersOf(g: LayerGroup, map: MlMap): LayerSpecification[] {
    return typeof g.layers === 'function' ? g.layers(map.getStyle()) : g.layers;
  }

  private firstLayerOf(map: MlMap, groupId: string): string | undefined {
    const g = this.groups.get(groupId);
    return g ? this.layersOf(g, map).map((l) => l.id).find((id) => map.getLayer(id)) : undefined;
  }

  private readVisible(): Record<string, boolean> {
    try { return JSON.parse(localStorage.getItem(VIS_KEY) ?? '{}'); } catch { return {}; }
  }
}
