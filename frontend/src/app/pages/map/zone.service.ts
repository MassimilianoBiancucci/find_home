import { Injectable, computed, inject, signal } from '@angular/core';
import type { Map as MlMap } from 'maplibre-gl';
import { GeoCollection, IndicesMap, ZoneCentroids, ZoneFacts, ZoneHeatmap, ZoneIndices, ZoneLines } from '../../models';
import { ObjectKind, objectId, objectUrl, pinId, pinUrl } from '../../components/map-icons';
import { ApiService, apiError } from '../../services/api.service';
import { ThemeService } from '../../services/theme.service';
import { MapStateService } from './map-state.service';

/** Connectivity centroid colour per group. */
export const GROUP_COLOURS: Record<string, string> = { rail: '#0089ca', bus: '#d71d24' };
/** How each target set is drawn: a standing 3D pin (glyph, badge, glyph colour) or a standalone 3D object, and the
 *  coloured glow on the ground under it (none for bus stops and parks: there are too many of them). */
export type TargetIcon = ({ pin: { glyph: string; bg: string; fg?: string } } | { object: ObjectKind }) & { halo?: string };
export const TARGET_ICONS: Record<string, TargetIcon> = {
  rail: { pin: { glyph: 'metro', bg: '#0089ca' }, halo: '#1c9bff' }, bus: { pin: { glyph: 'bus', bg: '#d71d24' } },
  ferry: { pin: { glyph: 'ferry', bg: '#00a5ac' }, halo: '#12d6d6' }, park: { object: 'tree' },
  grocery: { object: 'bag', halo: '#ffe14d' }, pharmacy: { object: 'cross', halo: '#2ff07a' },
  gym: { object: 'kettlebell', halo: '#ff5a00' }, vet: { object: 'cat', halo: '#c77dff' },
};
const FALLBACK: TargetIcon = { pin: { glyph: 'dot', bg: '#8a8aa0' } };
export function targetIconId(set: string): string {
  const t = TARGET_ICONS[set] ?? FALLBACK;
  return 'object' in t ? objectId(t.object) : pinId(t.pin.glyph, t.pin.bg, t.pin.fg);
}
export function targetIconUrl(set: string): string {
  const t = TARGET_ICONS[set] ?? FALLBACK;
  return 'object' in t ? objectUrl(t.object) : pinUrl(t.pin.glyph, t.pin.bg, t.pin.fg);
}
export const ICON_SCALE_MIN = 0.6, ICON_SCALE_MAX = 1.8;
const ICON_SCALE_KEY = 'fh-zone-icon-scale';
function readScale(): number {
  try {
    const v = Number(localStorage.getItem(ICON_SCALE_KEY));
    return v >= ICON_SCALE_MIN && v <= ICON_SCALE_MAX ? v : 1;
  } catch { return 1; }
}
const EMPTY: GeoCollection = { type: 'FeatureCollection', features: [] };
/** Heatmap colours from near to far, one per legend bin (zone.yaml bins_min) plus "beyond the last bin". */
export const HEAT_COLOURS = ['#1a9850', '#66bd63', '#a6d96a', '#fee08b', '#fdae61', '#f46d43', '#d73027'];
export const BEYOND = '#6b6b78';
/** Marker colour per target set; others take the fallback. */
export { SET_COLOURS } from '../../set-colours';
import { SET_COLOURS } from '../../set-colours';

/** Map → Zone: the selected zone, its facts, lines and heatmap, and the layers that show them. */
@Injectable({ providedIn: 'root' })
export class ZoneService {
  private api = inject(ApiService);
  private state = inject(MapStateService);
  private theme = inject(ThemeService);
  readonly selected = signal<string | null>(null);
  readonly facts = signal<ZoneFacts | null>(null);
  readonly lines = signal<ZoneLines | null>(null);
  readonly heatmap = signal<ZoneHeatmap | null>(null);
  readonly indices = signal<ZoneIndices | null>(null);
  readonly centroids = signal<ZoneCentroids | null>(null);
  readonly allIndices = signal<IndicesMap | null>(null);   // every zone's indices, for the percentile
  readonly sets = signal<string[]>(['rail', 'bus']);
  readonly mode = signal<'walk' | 'bike'>('walk');
  readonly neighbours = signal(false);
  readonly colourBy = signal<string>('t');                 // 't' (nearest of all sets) or 't_<set>'
  readonly loading = signal(false);
  readonly error = signal('');
  readonly hoverName = signal<string | null>(null);
  /** Size multiplier of the target icons and their glow (slider in the Heatmap targets bubble), kept per browser. */
  readonly iconScale = signal(readScale());
  readonly legend = computed(() => {
    const bins = this.heatmap()?.bins_min ?? [2, 5, 8, 12, 16, 20];
    return bins.map((b, i) => ({ label: `${i ? bins[i - 1] : 0}–${b}`, colour: HEAT_COLOURS[i] ?? HEAT_COLOURS.at(-1)! }));
  });
  private zones: GeoCollection | null = null;
  private camera: { center: [number, number]; zoom: number; pitch: number; bearing: number } | null = null;
  private heatReq = 0;

  // ── selection mode ──────────────────────────────────────
  /** Hover outline + clickable fill over every zone (no zone selected yet). */
  installPicker(onPick: (id: string) => void): () => void {
    const map = this.state.map();
    if (!map) return () => undefined;
    this.state.addGroup({
      id: 'zone-pick', below: 'listings',
      sources: { 'zone-all': { type: 'geojson', data: (this.zones ?? EMPTY) as any }, 'zone-hover': { type: 'geojson', data: EMPTY as any } },
      layers: [
        { id: 'zone-pick-fill', type: 'fill', source: 'zone-all', paint: { 'fill-color': '#8a8aa0', 'fill-opacity': 0.06 } },
        { id: 'zone-pick-line', type: 'line', source: 'zone-all', paint: { 'line-color': '#8a8aa0', 'line-opacity': 0.5, 'line-width': 0.6 } },
        { id: 'zone-hover-line', type: 'line', source: 'zone-hover', paint: { 'line-color': this.neon(), 'line-width': 3, 'line-blur': 1 } },
      ] as any,
    });
    if (!this.zones) this.api.geoZones().subscribe({ next: (z) => { this.zones = z; this.state.setData('zone-all', z); } });
    const move = (e: any) => {
      const f = e.features?.[0];
      this.hoverName.set(f?.properties?.['name'] ?? null);
      this.state.setData('zone-hover', f ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: f.geometry, properties: {} }] } : EMPTY);
      map.getCanvas().style.cursor = f ? 'pointer' : '';
    };
    const leave = () => { this.hoverName.set(null); this.state.setData('zone-hover', EMPTY); map.getCanvas().style.cursor = ''; };
    const click = (e: any) => { const id = e.features?.[0]?.properties?.['zone_id']; if (id) onPick(id); };
    map.on('mousemove', 'zone-pick-fill', move);
    map.on('mouseleave', 'zone-pick-fill', leave);
    map.on('click', 'zone-pick-fill', click);
    return () => {
      map.off('mousemove', 'zone-pick-fill', move);
      map.off('mouseleave', 'zone-pick-fill', leave);
      map.off('click', 'zone-pick-fill', click);
      leave();
      this.state.removeGroup('zone-pick');
    };
  }

  // ── focus ───────────────────────────────────────────────
  select(id: string): void {
    if (this.selected() === id && this.facts()) return;
    this.selected.set(id);
    this.facts.set(null);
    this.lines.set(null);
    this.heatmap.set(null);
    this.error.set('');
    this.api.zone(id).subscribe({
      next: (f) => { this.facts.set(f); this.drawFocus(f); this.flyTo(f); this.loadHeatmap(); this.loadTargets(); },
      error: (e) => this.error.set(apiError(e)),
    });
    this.api.zoneLines(id).subscribe({ next: (l) => this.lines.set(l), error: () => this.lines.set(null) });
    this.centroids.set(null);
    this.api.zoneCentroids(id).subscribe({ next: (c) => { this.centroids.set(c); this.drawCentroids(c); }, error: () => this.drawCentroids(null) });
    this.indices.set(null);
    this.api.zoneIndices(id).subscribe({ next: (i) => this.indices.set(i), error: () => this.indices.set(null) });
    if (!this.allIndices()) this.api.allIndices().subscribe({ next: (a) => this.allIndices.set(a), error: () => undefined });
  }

  /** After a style reload (theme switch): redraw the focus layers, whose colours depend on the theme. */
  restyle(): void {
    const f = this.facts();
    if (!f) return;
    this.state.removeGroup('zone-focus');
    this.drawFocus(f);
  }

  setSets(sets: string[]): void { this.sets.set(sets); this.colourBy.set('t'); this.loadHeatmap(); this.loadTargets(); }
  setMode(m: 'walk' | 'bike'): void { this.mode.set(m); this.loadHeatmap(); }
  setNeighbours(on: boolean): void { this.neighbours.set(on); this.loadHeatmap(); this.loadTargets(); }
  setColourBy(prop: string): void {
    this.colourBy.set(prop);
    const map = this.state.map();
    if (map?.getLayer('zone-heat-line')) map.setPaintProperty('zone-heat-line', 'line-color', this.heatColour(prop) as any);
  }

  /** Leave the mode: drop the layers and put the camera back where it was before the first fly-to. */
  leave(): void {
    for (const g of ['zone-focus', 'zone-heat', 'zone-targets', 'zone-3d', 'zone-centroids']) this.state.removeGroup(g);
    const map = this.state.map();
    if (map && this.camera) map.easeTo({ ...this.camera, duration: 600 });
    this.camera = null;
    this.selected.set(null);
    this.facts.set(null);
    this.heatmap.set(null);
    this.lines.set(null);
  }

  private loadHeatmap(): void {
    const id = this.selected();
    if (!id) return;
    const req = ++this.heatReq;
    this.loading.set(true);
    this.api.zoneHeatmap(id, this.sets(), this.mode(), this.neighbours()).subscribe({
      next: (h) => {
        if (req !== this.heatReq) return;                       // a newer request replaced this one
        this.heatmap.set(h);
        this.loading.set(false);
        this.drawHeat(h);
      },
      error: (e) => { if (req === this.heatReq) { this.loading.set(false); this.error.set(apiError(e)); } },
    });
  }

  private loadTargets(): void {
    const id = this.selected();
    if (!id) return;
    this.api.zoneTargets(id, this.sets(), this.neighbours()).subscribe({
      next: (t) => {
        const features = Object.values(t).flatMap((fc) => fc.features);
        this.drawTargets({ type: 'FeatureCollection', features });
      },
      error: () => this.drawTargets(EMPTY),
    });
  }

  private neon(): string { return this.theme.theme() === 'dark' ? '#22e6ff' : '#990ae3'; }

  private heatColour(prop: string): any {
    const bins = this.heatmap()?.bins_min ?? [2, 5, 8, 12, 16, 20];
    const steps = bins.slice(0, -1).flatMap((b, i) => [b, HEAT_COLOURS[i + 1] ?? HEAT_COLOURS.at(-1)]);
    return ['case', ['has', prop], ['step', ['/', ['get', prop], 60], HEAT_COLOURS[0], ...steps], BEYOND];
  }

  private drawFocus(f: ZoneFacts): void {
    const outline = { type: 'Feature', geometry: f.outline, properties: {} };
    const rings = (f.outline.type === 'Polygon' ? [f.outline.coordinates] : f.outline.coordinates).map((poly: any) => poly[0]);
    const mask = { type: 'Feature', properties: {}, geometry: { type: 'Polygon',
      coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]], ...rings] } };
    const neon = this.neon();
    this.state.addGroup({
      id: 'zone-focus',
      sources: { 'zone-outline': { type: 'geojson', data: outline as any }, 'zone-mask': { type: 'geojson', data: mask as any } },
      layers: [
        { id: 'zone-mask-fill', type: 'fill', source: 'zone-mask', paint: { 'fill-color': '#05050a', 'fill-opacity': 0.45 } },
        { id: 'zone-glow-wide', type: 'line', source: 'zone-outline', paint: { 'line-color': neon, 'line-width': 14, 'line-blur': 10, 'line-opacity': 0.35 } },
        { id: 'zone-glow-mid', type: 'line', source: 'zone-outline', paint: { 'line-color': neon, 'line-width': 6, 'line-blur': 3, 'line-opacity': 0.6 } },
        { id: 'zone-glow-core', type: 'line', source: 'zone-outline', paint: { 'line-color': neon, 'line-width': 2 } },
      ] as any,
    });
    this.state.setData('zone-outline', outline);
    this.state.setData('zone-mask', mask);
    // 3D buildings inside the zone only: `within` does not take polygon features, `distance` to the zone does.
    this.state.removeGroup('zone-3d');
    this.state.addGroup({
      id: 'zone-3d',
      layers: (style) => {
        const src = Object.entries(style.sources ?? {}).find(([, s]) => (s as any).type === 'vector')?.[0];
        return src ? [{
          id: 'zone-3d-buildings', source: src, 'source-layer': 'building', type: 'fill-extrusion', minzoom: 13,
          filter: ['<=', ['distance', f.outline], 0],
          paint: { 'fill-extrusion-color': this.theme.theme() === 'dark' ? '#5a5f7a' : '#b9b3c9', 'fill-extrusion-opacity': 0.8,
            'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 10], 'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0] },
        } as any] : [];
      },
    });
  }

  private drawHeat(h: ZoneHeatmap): void {
    this.state.addGroup({
      id: 'zone-heat', below: 'zone-targets',
      sources: { 'zone-heat': { type: 'geojson', data: EMPTY as any } },
      layers: [{ id: 'zone-heat-line', type: 'line', source: 'zone-heat',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': this.heatColour(this.colourBy()), 'line-opacity': 0.95,
          'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.5, 15, 4, 17, 7] } }] as any,
    });
    this.state.setData('zone-heat', h.segments);
    const map = this.state.map();
    if (map?.getLayer('zone-heat-line')) map.setPaintProperty('zone-heat-line', 'line-color', this.heatColour(this.colourBy()) as any);
  }

  /** Targets as standing 3D pins or 3D objects (TARGET_ICONS): anchored at the spot, upright when the map is tilted, drawn above the
   *  buildings and the heatmap; nearer pins cover farther ones. */
  private drawTargets(fc: GeoCollection): void {
    const icon: any = ['match', ['get', 'set'], ...Object.keys(TARGET_ICONS).flatMap((k) => [k, targetIconId(k)]), targetIconId('')];
    const halos = Object.entries(TARGET_ICONS).filter(([, t]) => t.halo);
    const haloColour: any = ['match', ['get', 'set'], ...halos.flatMap(([k, t]) => [k, t.halo!]), '#ffffff'];
    this.state.addGroup({
      id: 'zone-targets',
      sources: { 'zone-targets': { type: 'geojson', data: EMPTY as any } },
      layers: [{ id: 'zone-targets-halo', type: 'circle', source: 'zone-targets',
        filter: ['in', ['get', 'set'], ['literal', halos.map(([k]) => k)]],
        paint: { 'circle-color': haloColour, 'circle-blur': 0.9, 'circle-opacity': 0.55, 'circle-pitch-alignment': 'map',
          'circle-radius': this.haloRadius() } },
      { id: 'zone-targets-pin', type: 'symbol', source: 'zone-targets',
        layout: { 'icon-image': icon, 'icon-anchor': 'bottom', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
          'icon-pitch-alignment': 'viewport', 'icon-rotation-alignment': 'viewport', 'symbol-z-order': 'viewport-y',
          'icon-size': this.iconSize() } }] as any,
    });
    this.state.setData('zone-targets', fc);
    const map = this.state.map();
    for (const id of ['zone-targets-halo', 'zone-targets-pin']) if (map?.getLayer(id)) map.moveLayer(id);   // above everything added since
  }

  setIconScale(v: number): void {
    const k = Math.min(Math.max(v, ICON_SCALE_MIN), ICON_SCALE_MAX);
    this.iconScale.set(k);
    try { localStorage.setItem(ICON_SCALE_KEY, String(k)); } catch { /* storage unavailable */ }
    const map = this.state.map();
    if (map?.getLayer('zone-targets-pin')) map.setLayoutProperty('zone-targets-pin', 'icon-size', this.iconSize());
    if (map?.getLayer('zone-targets-halo')) map.setPaintProperty('zone-targets-halo', 'circle-radius', this.haloRadius());
  }
  private iconSize(): any {
    const k = this.iconScale();
    return ['interpolate', ['linear'], ['zoom'], 11, 0.7 * k, 14, 1.05 * k, 17, 1.4 * k];
  }
  private haloRadius(): any {
    const k = this.iconScale();
    return ['interpolate', ['linear'], ['zoom'], 11, 9 * k, 14, 18 * k, 17, 30 * k];
  }

  /** Show or hide the centroid layer (hidden by default; the choice persists like the other map layers). */
  readonly showCentroids = computed(() => this.state.isVisible('zone-centroids', false));
  setShowCentroids(on: boolean): void { this.state.setVisible('zone-centroids', on); }

  /** The zone's connectivity centroids: a dot in the group colour and the range circle (centroids.range_m) around
   *  it, drawn as a polygon in metres so it keeps its true size when the map is tilted. */
  private drawCentroids(c: ZoneCentroids | null): void {
    if (this.state.visible()['zone-centroids'] === undefined) this.state.setVisible('zone-centroids', false);
    const items = c?.centroids ?? [];
    const range = c?.range_m ?? 400;
    const props = (s: ZoneCentroids['centroids'][number]) => ({ name: s.name, group: s.group, share: s.share_within_walk });
    const dots = { type: 'FeatureCollection', features: items.map((s) => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [s.lon, s.lat] }, properties: props(s) })) };
    const rings = { type: 'FeatureCollection', features: items.map((s) => ({
      type: 'Feature', geometry: { type: 'Polygon', coordinates: [circle(s.lon, s.lat, range)] }, properties: props(s) })) };
    const colour: any = ['match', ['get', 'group'], ...Object.entries(GROUP_COLOURS).flat(), '#8a8aa0'];
    this.state.addGroup({
      id: 'zone-centroids',
      sources: { 'zone-centroids': { type: 'geojson', data: EMPTY as any }, 'zone-centroid-range': { type: 'geojson', data: EMPTY as any } },
      layers: [
        { id: 'zone-centroids-range-fill', type: 'fill', source: 'zone-centroid-range', paint: { 'fill-color': colour, 'fill-opacity': 0.08 } },
        { id: 'zone-centroids-range-line', type: 'line', source: 'zone-centroid-range',
          paint: { 'line-color': colour, 'line-width': 1.5, 'line-opacity': 0.85, 'line-dasharray': [2, 2] } },
        { id: 'zone-centroids-dot', type: 'circle', source: 'zone-centroids',
          paint: { 'circle-radius': 5, 'circle-color': colour, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } },
        ...(this.state.map()?.getStyle()?.glyphs ? [{ id: 'zone-centroids-label', type: 'symbol', source: 'zone-centroids',
          layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-offset': [0, 1.2], 'text-anchor': 'top' },
          paint: { 'text-color': '#fff', 'text-halo-color': '#101014', 'text-halo-width': 1.3 } }] : []),
      ] as any,
    });
    this.state.setData('zone-centroids', dots);
    this.state.setData('zone-centroid-range', rings);
  }

  private flyTo(f: ZoneFacts): void {
    const map: MlMap | null = this.state.map();
    if (!map) return;
    if (!this.camera) {
      const c = map.getCenter();
      this.camera = { center: [c.lng, c.lat], zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
    }
    const coords: number[][] = (f.outline.type === 'Polygon' ? [f.outline.coordinates] : f.outline.coordinates).flat(2);
    const lons = coords.map((c) => c[0]), lats = coords.map((c) => c[1]);
    const cam = map.cameraForBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 70 });
    if (!cam) return;
    map.flyTo({ ...cam, zoom: (cam.zoom ?? 14) - 0.3, pitch: 55, bearing: -20, duration: 1500, essential: true });
  }
}

/** A circle of `metres` around [lon, lat] as a closed ring (64 points; local flat-earth offsets, exact enough at a few km). */
export function circle(lon: number, lat: number, metres: number, steps = 64): number[][] {
  const dLat = metres / 111_320, dLon = metres / (111_320 * Math.cos((lat * Math.PI) / 180));
  const ring = Array.from({ length: steps }, (_, i) => {
    const a = (2 * Math.PI * i) / steps;
    return [+(lon + dLon * Math.cos(a)).toFixed(6), +(lat + dLat * Math.sin(a)).toFixed(6)];
  });
  return [...ring, ring[0]];
}
