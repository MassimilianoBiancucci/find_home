/**
 * The layers that stay above every other one on the map, bottom to top: the homes (rejected dots, the houses' light,
 * the houses), then the focused home of the zone view (its walks, routes and pin). Every mode's own layers (zone
 * heatmap and fill, 3D buildings, service pins, area shapes, transit lines, places) stay under them.
 */
export const LISTING_LAYERS = ['listings-rejected', 'listings-halo', 'listings'];
/** The focused home's layers, bottom to top (house-layer.service.ts). */
export const HOUSE_LAYERS = ['house-building-3d', 'house-glow', 'house-transit-line', 'house-walk-casing', 'house-walk-line',
  'house-walk-label', 'house-transit-shade', 'house-transit-glow', 'house-transit-hi', 'house-transit-core', 'house-pin'];
export const TOP_LAYERS = [...LISTING_LAYERS, ...HOUSE_LAYERS];

/** The top layers that need moving so they are the topmost, in `top` order ([] when already so). */
export function layersToRaise(order: string[], top: string[] = TOP_LAYERS): string[] {
  const present = top.filter((id) => order.includes(id));
  const tail = order.slice(order.length - present.length);
  return tail.join() === present.join() ? [] : present;
}
