import { covers, type Rect, type Selection } from './selection';

/**
 * Pixel work the editor does on its working buffer.
 *
 * These take the structural shape of `ImageData` rather than the class itself,
 * so they run under the node test environment, where there is no canvas to make
 * one with.
 */
export interface PixelBuffer {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function getPixel(buf: PixelBuffer, x: number, y: number): RGBA {
  const i = (y * buf.width + x) * 4;
  return { r: buf.data[i], g: buf.data[i + 1], b: buf.data[i + 2], a: buf.data[i + 3] };
}

export function setPixel(buf: PixelBuffer, x: number, y: number, c: RGBA): void {
  const i = (y * buf.width + x) * 4;
  buf.data[i] = c.r;
  buf.data[i + 1] = c.g;
  buf.data[i + 2] = c.b;
  buf.data[i + 3] = c.a;
}

/** A copy of one rect. Anything past the edge of the buffer comes back clear. */
export function crop(buf: PixelBuffer, rect: Rect): PixelBuffer {
  const out: PixelBuffer = {
    data: new Uint8ClampedArray(rect.w * rect.h * 4),
    width: rect.w,
    height: rect.h,
  };

  for (let y = 0; y < rect.h; y++) {
    const sy = rect.y + y;
    if (sy < 0 || sy >= buf.height) continue;
    for (let x = 0; x < rect.w; x++) {
      const sx = rect.x + x;
      if (sx < 0 || sx >= buf.width) continue;
      setPixel(out, x, y, getPixel(buf, sx, sy));
    }
  }

  return out;
}

export function clearRect(buf: PixelBuffer, rect: Rect): void {
  const empty: RGBA = { r: 0, g: 0, b: 0, a: 0 };
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    if (y < 0 || y >= buf.height) continue;
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      if (x < 0 || x >= buf.width) continue;
      setPixel(buf, x, y, empty);
    }
  }
}

/**
 * Nearest-neighbour a buffer into a rect, over the top of what is already there.
 *
 * Nearest neighbour because this is pixel art: an average of neighbouring texels
 * is a blur, not a smaller sprite.
 *
 * Compositing rather than replacing is what lets a moved piece be dropped onto
 * other artwork - the transparent parts of the piece leave what is underneath
 * alone, instead of punching a rectangular hole around it.
 */
export function drawScaled(dest: PixelBuffer, src: PixelBuffer, rect: Rect): void {
  for (let y = 0; y < rect.h; y++) {
    const dy = rect.y + y;
    if (dy < 0 || dy >= dest.height) continue;
    const sy = Math.min(src.height - 1, Math.floor((y * src.height) / rect.h));

    for (let x = 0; x < rect.w; x++) {
      const dx = rect.x + x;
      if (dx < 0 || dx >= dest.width) continue;
      const sx = Math.min(src.width - 1, Math.floor((x * src.width) / rect.w));

      const s = getPixel(src, sx, sy);
      if (s.a === 0) continue;
      if (s.a === 255) {
        setPixel(dest, dx, dy, s);
        continue;
      }

      // Source-over, for the half-transparent case.
      const d = getPixel(dest, dx, dy);
      const sa = s.a / 255;
      const da = d.a / 255;
      const a = sa + da * (1 - sa);
      const mix = (sc: number, dc: number) => Math.round((sc * sa + dc * da * (1 - sa)) / a);

      setPixel(dest, dx, dy, {
        r: mix(s.r, d.r),
        g: mix(s.g, d.g),
        b: mix(s.b, d.b),
        a: Math.round(a * 255),
      });
    }
  }
}

/**
 * Flood the area of matching colour reachable from a point.
 *
 * `bounds` is how the fill respects a selection: the same test the other tools
 * apply per pixel, applied to where the flood may spread. A masked selection
 * therefore stops the flood at the edge of the shape, not of its bounding box.
 */
export function floodFill(
  buf: PixelBuffer,
  x: number,
  y: number,
  colour: RGBA,
  bounds?: Selection,
): void {
  if (bounds && !covers(bounds, x, y)) return;

  const target = getPixel(buf, x, y);
  const same = (p: RGBA) => p.r === target.r && p.g === target.g && p.b === target.b && p.a === target.a;
  if (same(colour)) return;

  const stack: Array<[number, number]> = [[x, y]];
  const seen = new Uint8Array(buf.width * buf.height);

  while (stack.length > 0) {
    const [cx, cy] = stack.pop()!;
    if (cx < 0 || cy < 0 || cx >= buf.width || cy >= buf.height) continue;
    if (bounds && !covers(bounds, cx, cy)) continue;
    const flat = cy * buf.width + cx;
    if (seen[flat]) continue;
    if (!same(getPixel(buf, cx, cy))) continue;

    seen[flat] = 1;
    setPixel(buf, cx, cy, colour);
    stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
  }
}
