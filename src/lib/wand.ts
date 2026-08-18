import { getPixel, type PixelBuffer, type RGBA } from './pixelBuffer';
import type { Rect, Selection } from './selection';

/**
 * Selecting by colour rather than by dragging a box.
 *
 * Kept apart from `selection.ts` because this needs pixels, and `pixelBuffer.ts`
 * already depends on `selection.ts` for its geometry.
 */

/**
 * How far apart two colours are, 0 (identical) to 1 (opposite ends).
 *
 * The widest channel decides, alpha included: a transparent pixel and an opaque
 * one of the same hue are not the same colour, and treating them as one would
 * mean clicking the background swallowed the artwork drawn over it.
 */
function distance(a: RGBA, b: RGBA): number {
  return Math.max(
    Math.abs(a.r - b.r),
    Math.abs(a.g - b.g),
    Math.abs(a.b - b.b),
    Math.abs(a.a - b.a),
  ) / 255;
}

/**
 * Select the pixels matching the one clicked.
 *
 * `everywhere` decides between the connected patch under the cursor and every
 * matching pixel in the texture - the difference between recolouring one blue
 * gem and recolouring all the blue on a sword at once.
 *
 * Returns null when the click is outside the texture.
 */
export function selectSimilar(
  buf: PixelBuffer,
  x: number,
  y: number,
  tolerance: number,
  everywhere: boolean,
): Selection | null {
  if (x < 0 || y < 0 || x >= buf.width || y >= buf.height) return null;

  const target = getPixel(buf, x, y);
  const hit = new Uint8Array(buf.width * buf.height);
  const matches = (px: number, py: number) => distance(getPixel(buf, px, py), target) <= tolerance;

  if (everywhere) {
    for (let py = 0; py < buf.height; py++) {
      for (let px = 0; px < buf.width; px++) {
        if (matches(px, py)) hit[py * buf.width + px] = 1;
      }
    }
  } else {
    const stack: Array<[number, number]> = [[x, y]];
    while (stack.length > 0) {
      const [cx, cy] = stack.pop()!;
      if (cx < 0 || cy < 0 || cx >= buf.width || cy >= buf.height) continue;
      const flat = cy * buf.width + cx;
      if (hit[flat]) continue;
      if (!matches(cx, cy)) continue;

      hit[flat] = 1;
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
  }

  // Trim to what was actually hit, so the box the handles sit on is the shape's
  // own bounds rather than the whole texture.
  let minX = buf.width;
  let minY = buf.height;
  let maxX = -1;
  let maxY = -1;
  for (let py = 0; py < buf.height; py++) {
    for (let px = 0; px < buf.width; px++) {
      if (!hit[py * buf.width + px]) continue;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
  }
  if (maxX < 0) return null;

  const rect: Rect = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  const mask = new Uint8Array(rect.w * rect.h);
  for (let py = 0; py < rect.h; py++) {
    for (let px = 0; px < rect.w; px++) {
      mask[py * rect.w + px] = hit[(rect.y + py) * buf.width + (rect.x + px)];
    }
  }

  return { rect, mask };
}

/**
 * Resample a mask onto a new box, the same nearest-neighbour way the pixels
 * themselves are scaled, so the two stay in step through a transform.
 */
export function scaleMask(mask: Uint8Array | null, from: Rect, to: Rect): Uint8Array | null {
  if (!mask) return null;
  if (from.w === to.w && from.h === to.h) return mask;

  const out = new Uint8Array(to.w * to.h);
  for (let y = 0; y < to.h; y++) {
    const sy = Math.min(from.h - 1, Math.floor((y * from.h) / to.h));
    for (let x = 0; x < to.w; x++) {
      const sx = Math.min(from.w - 1, Math.floor((x * from.w) / to.w));
      out[y * to.w + x] = mask[sy * from.w + sx];
    }
  }
  return out;
}
