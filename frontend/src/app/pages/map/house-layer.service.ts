import { Injectable, inject, signal } from '@angular/core';
import type { Map as MlMap, Popup } from 'maplibre-gl';
import { blipId } from '../../components/map-icons';
import { walkTone } from '../../format';
import { GeoCollection, HouseLocation, TransitResult } from '../../models';
import { setColour } from '../../set-colours';
import { MapStateService } from './map-state.service';

export type RouteView = 'walk' | 'transit' | 'both';
const EMPTY: GeoCollection = { type: 'FeatureCollection', features: [] };
const ACCENT = '#b45cf0';
const BUILDING_LAYERS = ['zone-3d-buildings', 'fh-3d-buildings'];
/** House layers, bottom to top; kept above the zone layers, which load after them. */
export const HOUSE_LAYERS = ['house-building-3d', 'house-glow', 'house-transit-line', 'house-walk-casing', 'house-walk-line',
  'house-walk-label', 'house-pin'];

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

/** Transit legs of the computed itineraries (line colours; walk legs as dotted grey). */
export function transitFeatures(t: TransitResult | null, only?: string | null): GeoCollection {
  const feats: any[] = [];
  for (const trip of t?.trips ?? []) {
    if (only && trip.point_id !== only) continue;
    for (const leg of trip.legs) {
      const coords = leg.path?.length ? leg.path : [[leg.from.lon, leg.from.lat], [leg.to.lon, leg.to.lat]];
      if (coords.length < 2 || coords.some((c) => c[0] == null || c[1] == null)) continue;
      feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords },
        properties: { walk: leg.mode === 'walk', colour: leg.mode === 'walk' ? '#9a9aaa' : leg.color ?? '#607d8b',
          trip: trip.point_id, label: `${trip.label}: ${leg.mode === 'walk' ? 'walk' : leg.line ?? leg.mode}` } });
    }
  }
  return { type: 'FeatureCollection', features: feats };
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
  readonly routes = signal<RouteView>('both');
  readonly onlyPoint = signal<string | null>(null);
  private loc: HouseLocation | null = null;
  private transit: TransitResult | null = null;
  private popup: Popup | null = null;
  private bound = false;
  private raiser: (() => void) | null = null;

  show(loc: HouseLocation, transit: TransitResult | null): void {
    this.loc = loc;
    this.transit = transit;
    this.install();
    this.update();
    this.highlightBuilding();
  }

  setTransit(t: TransitResult | null): void { this.transit = t; this.update(); }
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
    this.state.setData('house-transit', r === 'walk' ? EMPTY : transitFeatures(this.transit, this.onlyPoint()));
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
  }
}
