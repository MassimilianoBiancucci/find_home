import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import type { Map as MlMap, Popup } from 'maplibre-gl';
import { blipId } from '../../components/map-icons';
import { walkTone } from '../../format';
import { GeoCollection, HouseLocation, HouseTrip, TransitResult } from '../../models';
import { setColour } from '../../set-colours';
import { HouseTravelStore } from '../../house/house-travel.store';
import { MapStateService } from './map-state.service';

export type RouteView = 'walk' | 'transit' | 'both';
const EMPTY: GeoCollection = { type: 'FeatureCollection', features: [] };
const ACCENT = '#b45cf0';
const BUILDING_LAYERS = ['zone-3d-buildings', 'fh-3d-buildings'];
/** House layers, bottom to top; kept above the zone layers, which load after them. */
export const HOUSE_LAYERS = ['house-building-3d', 'house-glow', 'house-transit-line', 'house-walk-casing', 'house-walk-line',
  'house-walk-label', 'house-transit-shade', 'house-transit-glow', 'house-transit-hi', 'house-transit-core', 'house-pin'];

/** The house layers that need moving so they are the topmost layers, in HOUSE_LAYERS order ([] when already so). */
export function layersToRaise(order: string[]): string[] {
  const present = HOUSE_LAYERS.filter((id) => order.includes(id));
  const tail = order.slice(order.length - present.length);
  return tail.join() === present.join() ? [] : present;
}

/** Walking paths from the house: one line per set in its category colour, labelled with tone-coloured minutes. */
export function walkFeatures(loc: HouseLocation): { lines: GeoCollection; labels: GeoCollection } {
  const lines: any[] = [], labels: any[] = [];
  for (const set of loc.sets ?? Object.keys(loc.walks)) {
    const w = loc.walks[set];
    if (!w || w.minutes == null || (w.path?.length ?? 0) < 2) continue;
    const props = { set, colour: setColour(set), minutes: w.minutes, metres: w.metres, target: w.target,
      label: loc.set_labels[set] ?? set, tone: walkTone(w.minutes, loc.walk_colours) };
    lines.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: w.path }, properties: props });
    labels.push({ type: 'Feature', geometry: { type: 'Point', coordinates: w.path[w.path.length - 1] },
      properties: { ...props, text: `${w.minutes} min` } });
  }
  return { lines: { type: 'FeatureCollection', features: lines }, labels: { type: 'FeatureCollection', features: labels } };
}

export interface TransitDraw {
  /** Only this trip (point_id), e.g. the zone view's point filter. */
  only?: string | null;
  /** Draw the services' routes too (the house page's switch); your points' routes are always drawn. */
  services?: boolean;
}

/** Trips whose every leg is a walk (too near for transit): the walking path to the target is already on the map. */
export function walkOnly(trip: HouseTrip): boolean { return !trip.legs.some((l) => l.mode !== 'walk'); }

/**
 * Transit legs of the computed itineraries, in line colours, along the saved line where it was found. Walk legs are
 * drawn only along the streets (a dotted grey path); ResRobot gives them as two points, and a straight line across
 * blocks says nothing. Each feature carries its trip id, so a hovered route can be drawn on top.
 */
export function transitFeatures(t: TransitResult | null, opts: TransitDraw = {}): GeoCollection {
  const feats: any[] = [];
  for (const trip of t?.trips ?? []) {
    if (opts.only && trip.point_id !== opts.only) continue;
    if (trip.kind === 'service' && (!opts.services || walkOnly(trip))) continue;
    for (const leg of trip.legs) {
      const walk = leg.mode === 'walk';
      const coords = leg.path?.length ? leg.path : walk ? [] : [[leg.from.lon, leg.from.lat], [leg.to.lon, leg.to.lat]];
      if (coords.length < 2 || (walk && coords.length < 3) || coords.some((c) => c[0] == null || c[1] == null)) continue;
      feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords },
        properties: { walk, colour: walk ? '#9a9aaa' : leg.color ?? '#607d8b', trip: trip.point_id, kind: trip.kind,
          label: `${trip.label}: ${walk ? 'walk' : leg.line ?? leg.mode}${leg.minutes ? ' · ' + leg.minutes + ' min' : ''}`
            + (trip.minutes != null ? ` (trip ${Math.round(trip.minutes)} min)` : '') } });
    }
  }
  return { type: 'FeatureCollection', features: feats };
}

/** The hover highlight of a transit route, under the given source: a dark shade, a glow in the line colour, the
 *  line itself brighter and wider, and a white core. Filtered to the hovered trip (none until hovered). */
export function routeHighlightLayers(prefix: string, source: string): any[] {
  const none = ['==', ['get', 'trip'], '__none__'];
  const cap = { 'line-cap': 'round', 'line-join': 'round' };
  return [
    { id: `${prefix}-shade`, type: 'line', source, filter: none, layout: cap,
      paint: { 'line-color': '#000000', 'line-width': 22, 'line-blur': 12, 'line-opacity': 0.55 } },
    { id: `${prefix}-glow`, type: 'line', source, filter: none, layout: cap,
      paint: { 'line-color': ['get', 'colour'], 'line-width': 16, 'line-blur': 9, 'line-opacity': 0.75 } },
    { id: `${prefix}-hi`, type: 'line', source, filter: none, layout: cap,
      paint: { 'line-color': ['get', 'colour'], 'line-width': 8, 'line-opacity': 1,
        'line-dasharray': ['case', ['get', 'walk'], ['literal', [1, 1.2]], ['literal', [1, 0]]] } },
    { id: `${prefix}-core`, type: 'line', source, filter: ['all', none, ['!', ['get', 'walk']]], layout: cap,
      paint: { 'line-color': '#ffffff', 'line-width': 2, 'line-opacity': 0.85 } },
  ];
}

/** Point the highlight layers at a trip (null: none) and dim the other routes while one is highlighted. */
export function setRouteHighlight(map: MlMap, prefix: string, base: string, trip: string | null): void {
  const f = ['==', ['get', 'trip'], trip ?? '__none__'];
  for (const id of [`${prefix}-shade`, `${prefix}-glow`, `${prefix}-hi`]) if (map.getLayer(id)) map.setFilter(id, f as any);
  if (map.getLayer(`${prefix}-core`)) map.setFilter(`${prefix}-core`, ['all', f, ['!', ['get', 'walk']]] as any);
  if (map.getLayer(base)) map.setPaintProperty(base, 'line-opacity', trip ? 0.3 : 0.9);
}

/** Tone names → paint colours (MapLibre cannot read CSS variables). */
const TONE_PAINT = ['match', ['get', 'tone'], 'good', '#2fbf71', 'neutral', '#e0b23a', 'bad', '#ef5350', '#cccccc'];

/**
 * The house in the 3D zone view: its building highlighted (from the vector tiles' building layer, else a 12 m box),
 * a glow and a pin at the address, walking paths to the nearest target of each set, and the transit legs of
 * "Compute transit routes". One layer group, `house`, above the zone layers.
 */
@Injectable({ providedIn: 'root' })
export class HouseLayerService {
  private state = inject(MapStateService);
  private travel = inject(HouseTravelStore);
  readonly routes = signal<RouteView>('both');
  readonly onlyPoint = signal<string | null>(null);
  private loc: HouseLocation | null = null;
  private transit: TransitResult | null = null;
  private popup: Popup | null = null;
  private bound = false;
  private raiser: (() => void) | null = null;

  constructor() {
    // the hovered route (on this map or in the Transit routes bubble) on top, glowing
    effect(() => {
      const trip = this.travel.hover();
      untracked(() => { const map = this.state.map(); if (map && this.loc) setRouteHighlight(map, 'house-transit', 'house-transit-line', trip); });
    });
  }

  show(loc: HouseLocation, transit: TransitResult | null): void {
    this.loc = loc;
    this.transit = transit;
    this.install();
    this.update();
    this.highlightBuilding();
  }

  setTransit(t: TransitResult | null): void { this.transit = t; this.update(); }

  /** Zoom out to the house, your points ([lon, lat]) and the transit legs: how far they are and where the lines run. */
  fitAll(points: number[][]): void {
    const map = this.state.map(), loc = this.loc;
    if (!map || !loc) return;
    const pts: number[][] = [[loc.lon, loc.lat], ...points];
    for (const f of transitFeatures(this.transit, { services: this.travel.showServices() }).features) pts.push(...(f.geometry as any).coordinates);
    const lons = pts.map((p) => p[0]), lats = pts.map((p) => p[1]);
    map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
      { padding: 80, maxZoom: 15, pitch: 45, duration: 1200 });
  }
  setRoutes(v: RouteView): void { this.routes.set(v); this.update(); }
  setOnlyPoint(id: string | null): void { this.onlyPoint.set(id); this.update(); }

  clear(): void {
    const map = this.state.map();
    if (map && this.raiser) map.off('styledata', this.raiser);
    this.raiser = null;
    this.popup?.remove();
    this.state.removeGroup('house');
    this.state.removeGroup('house-building');
    this.loc = null;
    this.transit = null;
  }

  /** After a style reload: the groups are re-applied by MapStateService; the building id must be found again. */
  restyle(): void { if (this.loc) { this.update(); this.highlightBuilding(); } }

  private install(): void {
    const loc = this.loc!;
    const here = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [loc.lon, loc.lat] }, properties: {} }] };
    this.state.addGroup({
      id: 'house',
      sources: { 'house-walk': { type: 'geojson', data: EMPTY as any }, 'house-walk-label': { type: 'geojson', data: EMPTY as any },
        'house-transit': { type: 'geojson', data: EMPTY as any }, 'house-here': { type: 'geojson', data: here as any } },
      layers: [
        { id: 'house-glow', type: 'circle', source: 'house-here',
          paint: { 'circle-color': ACCENT, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 14, 17, 46], 'circle-blur': 0.9,
            'circle-opacity': 0.55, 'circle-pitch-alignment': 'map' } },
        { id: 'house-transit-line', type: 'line', source: 'house-transit', layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': ['get', 'colour'], 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 3, 16, 7], 'line-opacity': 0.9,
            'line-dasharray': ['case', ['get', 'walk'], ['literal', [1, 1.5]], ['literal', [1, 0]]] } },
        { id: 'house-walk-casing', type: 'line', source: 'house-walk', layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#0b0b10', 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 4, 17, 10], 'line-opacity': 0.7 } },
        { id: 'house-walk-line', type: 'line', source: 'house-walk', layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': ['get', 'colour'], 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 2.5, 17, 6] } },
        { id: 'house-walk-label', type: 'symbol', source: 'house-walk-label',
          layout: { 'text-field': ['get', 'text'], 'text-size': 13, 'text-font': ['Noto Sans Regular'],
            'text-offset': [0, -1.3], 'text-allow-overlap': true, 'symbol-z-order': 'source' },
          paint: { 'text-color': TONE_PAINT, 'text-halo-color': '#0b0b10', 'text-halo-width': 1.6 } },
        ...routeHighlightLayers('house-transit', 'house-transit'),
        { id: 'house-pin', type: 'symbol', source: 'house-here',
          layout: { 'icon-image': blipId('home', ACCENT), 'icon-size': 1.6, 'icon-allow-overlap': true, 'icon-ignore-placement': true } },
      ] as any,
    });
    const map = this.state.map();
    if (map && !this.bound) { this.bindHover(map); this.bound = true; }
    if (map && !this.raiser) {
      this.raiser = () => this.raise(map);
      map.on('styledata', this.raiser);
    }
  }

  /** Keep the house layers on top: the zone's heatmap, 3D buildings and pins are added after them. */
  private raise(map: MlMap): void {
    const order = (map.getStyle()?.layers ?? []).map((l) => l.id);
    for (const id of layersToRaise(order)) if (map.getLayer(id)) map.moveLayer(id);
  }

  private update(): void {
    if (!this.loc) return;
    const r = this.routes();
    const walks = walkFeatures(this.loc);
    this.state.setData('house-walk', r === 'transit' ? EMPTY : walks.lines);
    this.state.setData('house-walk-label', r === 'transit' ? EMPTY : walks.labels);
    this.state.setData('house-transit', r === 'walk' ? EMPTY
      : transitFeatures(this.transit, { only: this.onlyPoint(), services: this.travel.showServices() }));
  }

  /** Find the building footprint under the address once the tiles are drawn; fall back to a small extruded box. */
  private highlightBuilding(): void {
    const map = this.state.map();
    const loc = this.loc;
    if (!map || !loc) return;
    const run = () => {
      if (this.loc !== loc) return;
      const layers = BUILDING_LAYERS.filter((l) => map.getLayer(l));
      const hit: any = layers.length ? map.queryRenderedFeatures(map.project([loc.lon, loc.lat]), { layers })[0] : null;
      this.state.removeGroup('house-building');
      if (hit && hit.id != null) {
        const src = hit.source, srcLayer = hit.sourceLayer;
        this.state.addGroup({ id: 'house-building', layers: [{
          id: 'house-building-3d', type: 'fill-extrusion', source: src, 'source-layer': srcLayer, filter: ['==', ['id'], hit.id],
          paint: { 'fill-extrusion-color': ACCENT, 'fill-extrusion-opacity': 0.95,
            'fill-extrusion-height': ['+', ['coalesce', ['get', 'render_height'], 10], 2], 'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0] },
        }] as any });
      } else {
        const d = 6 / 111_320, dl = d / Math.cos((loc.lat * Math.PI) / 180);
        const box = [[loc.lon - dl, loc.lat - d], [loc.lon + dl, loc.lat - d], [loc.lon + dl, loc.lat + d], [loc.lon - dl, loc.lat + d], [loc.lon - dl, loc.lat - d]];
        this.state.addGroup({ id: 'house-building', sources: { 'house-box': { type: 'geojson', data: {
          type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [box] }, properties: {} }] } as any } },
          layers: [{ id: 'house-building-3d', type: 'fill-extrusion', source: 'house-box',
            paint: { 'fill-extrusion-color': ACCENT, 'fill-extrusion-opacity': 0.9, 'fill-extrusion-height': 15 } }] as any });
      }
    };
    if (map.loaded() && map.areTilesLoaded()) run(); else map.once('idle', run);
  }

  private bindHover(map: MlMap): void {
    const ml = this.state.ml;
    const show = (e: any) => {
      const p = e.features?.[0]?.properties;
      if (!p || !ml) return;
      map.getCanvas().style.cursor = 'pointer';
      const text = p['minutes'] != null
        ? `${p['label']}${p['target'] ? ' · ' + p['target'] : ''} · ${p['minutes']} min${p['metres'] ? ' · ' + p['metres'] + ' m' : ''}`
        : p['label'];
      this.popup?.remove();
      this.popup = new ml.Popup({ closeButton: false, closeOnClick: false, className: 'fh-house-pop' })
        .setLngLat(e.lngLat).setText(text).addTo(map);
    };
    const hide = () => { map.getCanvas().style.cursor = ''; this.popup?.remove(); this.popup = null; };
    for (const id of ['house-walk-line', 'house-transit-line']) {
      map.on('mousemove', id, show);
      map.on('mouseleave', id, hide);
    }
    map.on('mousemove', 'house-transit-line', (e: any) => {
      const trip = e.features?.[0]?.properties?.['trip'] ?? null;
      if (trip !== this.travel.hover()) this.travel.hover.set(trip);
    });
    map.on('mouseleave', 'house-transit-line', () => this.travel.hover.set(null));
  }
}
