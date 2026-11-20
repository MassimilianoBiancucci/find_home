/**
 * The layers that stay above every other one on the map, bottom to top: the homes (rejected dots, the houses' light,
 * the houses), then the focused home of the zone view (its light, routes, walk labels and house; its walking paths lie
 * under the buildings, see UNDER_BUILDINGS). Every mode's own layers (zone
 * heatmap and fill, 3D buildings, service pins, area shapes, transit lines, places) stay under them.
 */
export const LISTING_LAYERS = ['listings-rejected', 'listings-halo', 'listings'];
/** The focused home's layers, bottom to top (house-layer.service.ts). */
export const HOUSE_LAYERS = ['house-building-3d', 'house-glow', 'house-glow-core', 'house-transit-line',
  'house-walk-label', 'house-transit-shade', 'house-transit-glow', 'house-transit-hi', 'house-transit-core', 'house-pin'];
export const TOP_LAYERS = [...LISTING_LAYERS, ...HOUSE_LAYERS];

/** The top layers that need moving so they are the topmost, in `top` order ([] when already so). */
export function layersToRaise(order: string[], top: string[] = TOP_LAYERS): string[] {
  const present = top.filter((id) => order.includes(id));
  const tail = order.slice(order.length - present.length);
  return tail.join() === present.join() ? [] : present;
}

/**
 * Lines that lie on the ground under the zone view's 3D buildings, bottom to top: the heatmap's streets, then the
 * focused home's walking paths to the services. A building in front hides them; they show faintly through it, so the
 * depth reads. (Their minute labels stay on top.)
 */
export const BUILDINGS = 'zone-3d-buildings';
export const UNDER_BUILDINGS = ['zone-heat-line', 'house-walk-casing', 'house-walk-line'];

/** The ground lines that need moving to sit just under the buildings, in order ([] when already so, or no buildings). */
export function layersToTuck(order: string[]): string[] {
  const b = order.indexOf(BUILDINGS);
  if (b < 0) return [];
  const present = UNDER_BUILDINGS.filter((id) => order.includes(id));
  return order.slice(b - present.length, b).join() === present.join() ? [] : present;
}
