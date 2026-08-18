import { getPixel, setPixel, type PixelBuffer } from './pixelBuffer';
import { covers, type Selection } from './selection';

/**
 * Colour adjustment for a texture, so a pack can be recoloured rather than
 * repainted.
 *
 * Pure and DOM-free, like the rest of `lib`, so the maths is tested directly
 * instead of through a canvas.
 */
export interface Adjustment {
  /** Degrees around the colour wheel. */
  hue: number;
  /** Multiplier: 0 is grey, 1 unchanged, 2 twice as colourful. */
  saturation: number;
  /** Stops of light: each whole step doubles or halves. */
  exposure: number;
}

export const NEUTRAL: Adjustment = { hue: 0, saturation: 1, exposure: 0 };

export function isNeutral(a: Adjustment): boolean {
  return a.hue === 0 && a.saturation === 1 && a.exposure === 0;
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;

  if (max === min) return [0, 0, l];

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === rn
    ? ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60
    : max === gn
      ? ((bn - rn) / d + 2) * 60
      : ((rn - gn) / d + 4) * 60;

  return [h, s, l];
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = l - c / 2;

  const [r, g, b] =
    hp < 1 ? [c, x, 0]
      : hp < 2 ? [x, c, 0]
        : hp < 3 ? [0, c, x]
          : hp < 4 ? [0, x, c]
            : hp < 5 ? [x, 0, c]
              : [c, 0, x];

  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

/**
 * Write `src` into `dest` with the adjustment applied, optionally only over a
 * selection.
 *
 * Hue and saturation go through HSL because that is what "shift the colour"
 * means to a person. Exposure multiplies rather than adds, so shading scales
 * proportionally: adding a constant lifts dark and light pixels by the same
 * amount, which flattens the shading pixel art is built out of.
 */
export function adjustInto(
  dest: PixelBuffer,
  src: PixelBuffer,
  a: Adjustment,
  area?: Selection,
): void {
  const gain = 2 ** a.exposure;
  const rect = area?.rect;

  const x0 = rect ? Math.max(0, rect.x) : 0;
  const y0 = rect ? Math.max(0, rect.y) : 0;
  const x1 = rect ? Math.min(src.width, rect.x + rect.w) : src.width;
  const y1 = rect ? Math.min(src.height, rect.y + rect.h) : src.height;

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      // A wand selection covers a shape, not a box, so the mask decides which of
      // the pixels inside those bounds actually move.
      if (area && !covers(area, x, y)) continue;

      const p = getPixel(src, x, y);

      // Colour hidden behind zero alpha becomes a fringe the moment the texture
      // is scaled, so an invisible pixel is left exactly as it is.
      if (p.a === 0) {
        setPixel(dest, x, y, p);
        continue;
      }

      const [h, s, l] = rgbToHsl(p.r, p.g, p.b);
      const [r, g, b] = hslToRgb(
        h + a.hue,
        Math.max(0, Math.min(1, s * a.saturation)),
        l,
      );

      setPixel(dest, x, y, {
        r: clamp255(r * gain),
        g: clamp255(g * gain),
        b: clamp255(b * gain),
        a: p.a,
      });
    }
  }
}
