import type { Map as MlMap } from 'maplibre-gl';

/** OpenFreeMap "fiord" paints water slightly darker than land, so lakes and the sea vanish. Layer ids are the style's. */
const DARK_WATER: Record<string, Record<string, unknown>> = {
  water: { 'fill-color': '#2a6b9e' },
  waterway: { 'line-color': '#4093cc', 'line-opacity': 0.9 },
  water_name: { 'text-color': '#a9d4f5', 'text-halo-color': '#0e2c46', 'text-halo-width': 1.4 },
};

/** Call after each style load in dark mode; layers the style does not have are skipped. */
export function applyDarkWater(map: MlMap): void {
  for (const [id, paint] of Object.entries(DARK_WATER)) {
    if (!map.getLayer(id)) continue;
    for (const [prop, value] of Object.entries(paint)) map.setPaintProperty(id, prop, value);
  }
}
