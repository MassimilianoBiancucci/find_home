import type { Map as MlMap } from 'maplibre-gl';

/**
 * GTA-style map blips: a round badge in the category colour with a white glyph, dark outline and a soft glow.
 * Drawn synchronously on a canvas (Path2D), so MapLibre's `styleimagemissing` can add any blip on demand and
 * blips survive style reloads. Image id: `blip:<glyph>:<rrggbb>` (see blipId). Glyphs are 24×24 paths, own drawings.
 */
interface Glyph { d: string; fill?: boolean; }

const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

export const GLYPHS: Record<string, Glyph> = {
  dumbbell: { d: 'M3 9v6M6 7v10M18 7v10M21 9v6M6 12h12' },
  barbell: { d: 'M2 12h20M5 8v8M8 6v12M16 6v12M19 8v8' },
  cart: { d: `M3 4h2.5l2.4 10.5h10l2.1-7.5H6.6${circle(9.5, 19, 1.4)}${circle(16.5, 19, 1.4)}` },
  metro: { d: 'M6 6h12M12 6v13' },
  train: { d: 'M8 3h8a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3zM5 10h14M9 21l-1.5-4M15 21l1.5-4M9 13.5h.01M15 13.5h.01' },
  bus: { d: 'M7 3h10a2 2 0 0 1 2 2v12H5V5a2 2 0 0 1 2-2zM5 11h14M8 20v-3M16 20v-3M8.5 14h.01M15.5 14h.01' },
  tram: { d: 'M9 3h6M12 3v3M8 6h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM6 12h12M9 21l1-3M15 21l-1-3' },
  ferry: { d: 'M4 15l1.5 4h13L20 15zM7 15V9h10v6M12 9V5M9 7h6M3 21c1.5 0 1.5-1 3-1s1.5 1 3 1 1.5-1 3-1 1.5 1 3 1 1.5-1 3-1 1.5 1 3 1' },
  tree: { d: 'M12 3l6 8h-3l4 5H5l4-5H6zM12 16v5' },
  paw: { d: `${circle(7, 9, 1.9)}${circle(10.5, 5.8, 1.9)}${circle(13.5, 5.8, 1.9)}${circle(17, 9, 1.9)}M12 11.5c3 0 5.5 3.5 5.5 6 0 1.6-1.4 2.5-3 2.5-1 0-1.6-.5-2.5-.5s-1.5.5-2.5.5c-1.6 0-3-.9-3-2.5 0-2.5 2.5-6 5.5-6z`, fill: true },
  pill: { d: 'M10.5 20.5a4.95 4.95 0 0 1-7-7l6-6a4.95 4.95 0 0 1 7 7zM7.5 10.5l6 6' },
  home: { d: 'M4 11l8-7 8 7M6 9.5V20h12V9.5M10 20v-5h4v5' },
  briefcase: { d: 'M5 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zM9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3 13h18' },
  heart: { d: 'M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.3a4.2 4.2 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z', fill: true },
  pin: { d: `M12 21s-6.5-6.2-6.5-11.2a6.5 6.5 0 0 1 13 0C18.5 14.8 12 21 12 21z${circle(12, 9.8, 2.2)}` },
  target: { d: `${circle(12, 12, 5.5)}M12 2v5M12 17v5M2 12h5M17 12h5` },
  dot: { d: circle(12, 12, 4), fill: true },
  // a sitting cat seen from the front, with its tail curling round (filled; pin3d adds the eyes)
  cat: { d: 'M7 3.5l2.4 3.3h5.2L17 3.5v6.3a5 5 0 0 1-1.1 3.1c1.6 1.3 2.6 3.4 2.6 5.8 0 1.4-.8 2.3-2 2.3H8.5c-1.3 0-2-.9-2-2.3 '
    + '0-2.4 1-4.5 2.6-5.8A5 5 0 0 1 7 9.8zM17.2 20.6c2.6.3 4.4-1 4.6-3.4l-1.3-.2c-.2 1.6-1.3 2.4-3.3 2.3z', fill: true },
};

export const BLIP_PREFIX = 'blip:';
const SIZE = 48;               // px, added with pixelRatio 2 → 24 css px

export function blipId(glyph: string | null | undefined, color: string | null | undefined): string {
  return `${BLIP_PREFIX}${glyph && GLYPHS[glyph] ? glyph : 'dot'}:${(color ?? '#8a8aa0').replace('#', '').toLowerCase()}`;
}

/** MapLibre expression building the blip id from feature properties `icon` and `color`. */
export function blipExpr(fallbackGlyph = 'dot', fallbackColor = '#8a8aa0'): any {
  return ['concat', BLIP_PREFIX, ['coalesce', ['get', 'icon'], fallbackGlyph], ':',
    ['downcase', ['slice', ['coalesce', ['get', 'color'], fallbackColor], 1]]];
}

function draw(glyph: string, color: string, size = SIZE): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  if (!g || typeof Path2D === 'undefined') return null;     // jsdom in unit tests
  const c = size / 2, r = size * 0.34;
  g.shadowColor = color;
  g.shadowBlur = size * 0.16;
  g.beginPath();
  g.arc(c, c, r, 0, Math.PI * 2);
  g.fillStyle = color;
  g.fill();
  g.shadowBlur = 0;
  g.lineWidth = size * 0.055;
  g.strokeStyle = '#101014';
  g.stroke();
  g.beginPath();
  g.arc(c, c, r - size * 0.05, Math.PI * 1.15, Math.PI * 1.85);   // top highlight: the "metal" finish
  g.strokeStyle = 'rgba(255,255,255,.35)';
  g.lineWidth = size * 0.03;
  g.stroke();
  const def = GLYPHS[glyph] ?? GLYPHS['dot'];
  const s = (r * 1.2) / 24;
  g.save();
  g.translate(c - 12 * s, c - 12 * s);
  g.scale(s, s);
  g.strokeStyle = g.fillStyle = '#fff';
  g.lineWidth = 2.3;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const path = new Path2D(def.d);
  if (def.fill) g.fill(path); else g.stroke(path);
  g.restore();
  return canvas;
}

/** Parse `blip:<glyph>:<rrggbb>`; null for ids that are not blips. */
export function parseBlipId(id: string): { glyph: string; color: string } | null {
  if (!id.startsWith(BLIP_PREFIX)) return null;
  const [glyph, hex] = id.slice(BLIP_PREFIX.length).split(':');
  return /^[0-9a-f]{6}$/.test(hex ?? '') ? { glyph, color: `#${hex}` } : null;
}

/** Add a missing blip image synchronously (call from map.on('styleimagemissing')). */
export function installBlip(map: MlMap, id: string): void {
  const b = parseBlipId(id);
  if (!b || map.hasImage(id)) return;
  const canvas = draw(b.glyph, b.color);
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx) return;
  map.addImage(id, ctx.getImageData(0, 0, canvas.width, canvas.height), { pixelRatio: 2 });
}

const urlCache = new Map<string, string>();

/** Data URL of a blip for legends and lists ('' when canvas is unavailable). */
export function blipUrl(glyph: string | null | undefined, color: string | null | undefined): string {
  const id = blipId(glyph, color);
  const hit = urlCache.get(id);
  if (hit !== undefined) return hit;
  const b = parseBlipId(id)!;
  const url = draw(b.glyph, b.color)?.toDataURL() ?? '';
  urlCache.set(id, url);
  return url;
}

// ── 3D pins ─────────────────────────────────────────────────
/**
 * A small standing pin for heatmap targets: a glossy shaded badge (radial light from the top left, dark rim, specular
 * arc) on a tapered stem with a soft ground shadow, so in a tilted map it reads as an object standing on the spot.
 * Used with `icon-anchor: bottom` and `icon-pitch-alignment: viewport`. Image id: `pin3d:<glyph>:<bg>:<fg>`.
 */
export const PIN_PREFIX = 'pin3d:';
const PIN_W = 56, PIN_H = 72;            // px, added with pixelRatio 2 → 28 × 36 css px before icon-size

export function pinId(glyph: string, bg: string, fg = '#ffffff'): string {
  return `${PIN_PREFIX}${GLYPHS[glyph] ? glyph : 'dot'}:${bg.replace('#', '').toLowerCase()}:${fg.replace('#', '').toLowerCase()}`;
}

export function parsePinId(id: string): { glyph: string; bg: string; fg: string } | null {
  if (!id.startsWith(PIN_PREFIX)) return null;
  const [glyph, bg, fg] = id.slice(PIN_PREFIX.length).split(':');
  return /^[0-9a-f]{6}$/.test(bg ?? '') && /^[0-9a-f]{6}$/.test(fg ?? '') ? { glyph, bg: `#${bg}`, fg: `#${fg}` } : null;
}

/** Mix a #rrggbb colour towards white (t > 0) or black (t < 0). */
export function shade(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(t >= 0 ? v + (255 - v) * t : v * (1 + t)));
  return `#${ch.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function drawPin(glyph: string, bg: string, fg: string): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas');
  canvas.width = PIN_W;
  canvas.height = PIN_H;
  const g = canvas.getContext('2d');
  if (!g || typeof Path2D === 'undefined') return null;
  const cx = PIN_W / 2, cy = 25, r = 20;
  g.beginPath();                                                  // ground shadow
  g.ellipse(cx, PIN_H - 6, 11, 4, 0, 0, Math.PI * 2);
  g.fillStyle = 'rgba(0,0,0,.38)';
  g.fill();
  g.beginPath();                                                  // stem
  g.moveTo(cx - 6, cy + r - 4);
  g.lineTo(cx + 6, cy + r - 4);
  g.lineTo(cx, PIN_H - 6);
  g.closePath();
  g.fillStyle = shade(bg, -0.45);
  g.fill();
  const grad = g.createRadialGradient(cx - 7, cy - 9, 2, cx, cy, r);
  grad.addColorStop(0, shade(bg, 0.5));
  grad.addColorStop(0.55, bg);
  grad.addColorStop(1, shade(bg, -0.4));
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fillStyle = grad;
  g.shadowColor = 'rgba(0,0,0,.45)';
  g.shadowBlur = 5;
  g.shadowOffsetY = 2;
  g.fill();
  g.shadowColor = 'transparent';
  g.lineWidth = 2.5;
  g.strokeStyle = '#101014';
  g.stroke();
  g.beginPath();                                                  // specular arc
  g.arc(cx, cy, r - 4, Math.PI * 1.1, Math.PI * 1.55);
  g.strokeStyle = 'rgba(255,255,255,.7)';
  g.lineWidth = 2.2;
  g.lineCap = 'round';
  g.stroke();
  const def = GLYPHS[glyph] ?? GLYPHS['dot'];
  const sc = (r * (glyph === 'cat' ? 1.45 : 1.25)) / 24;     // the cat silhouette is thinner: draw it larger
  g.save();
  g.translate(cx - 12 * sc, cy - 12 * sc);
  g.scale(sc, sc);
  g.strokeStyle = g.fillStyle = fg;
  g.lineWidth = 2.4;
  g.lineJoin = 'round';
  const path = new Path2D(def.d);
  if (def.fill) g.fill(path); else g.stroke(path);
  if (glyph === 'cat') {                                         // yellow eyes on the black cat
    g.fillStyle = '#ffd43b';
    for (const ex of [10.2, 13.8]) { g.beginPath(); g.ellipse(ex, 9.6, 0.9, 1.2, 0, 0, Math.PI * 2); g.fill(); }
  }
  g.restore();
  return canvas;
}

/** Add a missing 3D pin image synchronously (styleimagemissing); ignores other ids. */
export function installPin(map: MlMap, id: string): void {
  const p = parsePinId(id);
  if (!p || map.hasImage(id)) return;
  const canvas = drawPin(p.glyph, p.bg, p.fg);
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx) return;
  map.addImage(id, ctx.getImageData(0, 0, canvas.width, canvas.height), { pixelRatio: 2 });
}

const pinUrls = new Map<string, string>();

/** Data URL of a 3D pin for legends ('' without canvas). */
export function pinUrl(glyph: string, bg: string, fg = '#ffffff'): string {
  const id = pinId(glyph, bg, fg);
  if (!pinUrls.has(id)) {
    const p = parsePinId(id)!;
    pinUrls.set(id, drawPin(p.glyph, p.bg, p.fg)?.toDataURL() ?? '');
  }
  return pinUrls.get(id)!;
}

