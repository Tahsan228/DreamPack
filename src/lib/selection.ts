/**
 * Rectangle geometry for the editor's selection, in texture coordinates.
 *
 * Kept free of the DOM so the fiddly parts - which handle is under the cursor,
 * what a drag past the opposite edge means - are testable without a canvas.
 *
 * Two coordinate conventions meet here. A texel is addressed by its integer
 * index, so `containsPoint` treats a rect as half-open. An *edge* sits on a texel
 * boundary, so the right edge of a 1-wide rect at x=4 is 5.0, and `hitHandle` and
 * `dragHandle` take continuous coordinates to match.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A canvas's measured box: `getBoundingClientRect` plus its border widths. */
export interface CanvasBox {
  left: number;
  top: number;
  width: number;
  height: number;
  borderLeft: number;
  borderTop: number;
  borderRight: number;
  borderBottom: number;
}

/**
 * Where a pointer is on the texture, in continuous texel coordinates.
 *
 * A canvas draws on its content box but `getBoundingClientRect` measures its
 * border box, and this canvas has a border. Mapping straight through the rect
 * therefore shifts every stroke by the border and stretches the texture across a
 * box wider than the one it is drawn in. At 16x that is a sixth of a texel and
 * invisible; at 32x and above it passes a whole texel, so strokes land on the
 * wrong pixel and the outermost row and column cannot be reached at all.
 */
export function texelFromClient(
  clientX: number,
  clientY: number,
  box: CanvasBox,
  textureWidth: number,
  textureHeight: number,
): { x: number; y: number } {
  const width = box.width - box.borderLeft - box.borderRight;
  const height = box.height - box.borderTop - box.borderBottom;
  if (width <= 0 || height <= 0) return { x: 0, y: 0 };

  return {
    x: ((clientX - box.left - box.borderLeft) / width) * textureWidth,
    y: ((clientY - box.top - box.borderTop) / height) * textureHeight,
  };
}

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export type HitTarget = Handle | 'inside' | null;

/**
 * What is selected: a bounding box, and optionally which pixels inside it count.
 *
 * `mask` is `rect.w * rect.h` bytes, 1 where the pixel is in. A null mask means
 * the whole box, which is what dragging a box out gives you - so a rectangular
 * selection carries no per-pixel cost, and everything downstream asks the same
 * question either way.
 */
export interface Selection {
  rect: Rect;
  mask: Uint8Array | null;
}

/** Is this texel selected? */
export function covers(sel: Selection, x: number, y: number): boolean {
  if (!containsPoint(sel.rect, x, y)) return false;
  if (!sel.mask) return true;
  return sel.mask[(y - sel.rect.y) * sel.rect.w + (x - sel.rect.x)] === 1;
}

/** How many texels are selected. */
export function countCovered(sel: Selection): number {
  if (!sel.mask) return sel.rect.w * sel.rect.h;
  let n = 0;
  for (let i = 0; i < sel.mask.length; i++) if (sel.mask[i] === 1) n++;
  return n;
}

/** The rect covering both texels, whichever direction the drag went. */
export function rectFromDrag(ax: number, ay: number, bx: number, by: number): Rect {
  return {
    x: Math.min(ax, bx),
    y: Math.min(ay, by),
    w: Math.abs(bx - ax) + 1,
    h: Math.abs(by - ay) + 1,
  };
}

/** Fit a rect inside a texture, shrinking it first and then pulling it in. */
export function clampRect(rect: Rect, width: number, height: number): Rect {
  const w = Math.max(1, Math.min(Math.round(rect.w), width));
  const h = Math.max(1, Math.min(Math.round(rect.h), height));
  return {
    w,
    h,
    x: Math.max(0, Math.min(Math.round(rect.x), width - w)),
    y: Math.max(0, Math.min(Math.round(rect.y), height - h)),
  };
}

export function containsPoint(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && y >= rect.y && x < rect.x + rect.w && y < rect.y + rect.h;
}

/**
 * What the pointer is over: a resize handle, the inside of the box, or nothing.
 *
 * `tolerance` is in texels. The caller converts a handle's screen size with the
 * current zoom, so a handle stays grabbable at 1x, where a texel is one pixel.
 */
export function hitHandle(rect: Rect, x: number, y: number, tolerance: number): HitTarget {
  const left = rect.x;
  const right = rect.x + rect.w;
  const top = rect.y;
  const bottom = rect.y + rect.h;

  const nearLeft = Math.abs(x - left) <= tolerance;
  const nearRight = Math.abs(x - right) <= tolerance;
  const nearTop = Math.abs(y - top) <= tolerance;
  const nearBottom = Math.abs(y - bottom) <= tolerance;
  const spansX = x >= left - tolerance && x <= right + tolerance;
  const spansY = y >= top - tolerance && y <= bottom + tolerance;

  // Corners first: on a small box the corner handles overlap the edge ones, and
  // resizing both axes at once is what the user reached for.
  if (nearLeft && nearTop) return 'nw';
  if (nearRight && nearTop) return 'ne';
  if (nearLeft && nearBottom) return 'sw';
  if (nearRight && nearBottom) return 'se';
  if (nearTop && spansX) return 'n';
  if (nearBottom && spansX) return 's';
  if (nearLeft && spansY) return 'w';
  if (nearRight && spansY) return 'e';

  return containsPoint(rect, Math.floor(x), Math.floor(y)) ? 'inside' : null;
}

/** Move the edges a handle owns to where the pointer is. */
export function dragHandle(rect: Rect, handle: Handle, x: number, y: number): Rect {
  let left = rect.x;
  let right = rect.x + rect.w;
  let top = rect.y;
  let bottom = rect.y + rect.h;

  if (handle.includes('w')) left = Math.round(x);
  if (handle.includes('e')) right = Math.round(x);
  if (handle.includes('n')) top = Math.round(y);
  if (handle.includes('s')) bottom = Math.round(y);

  // Dragging past the opposite edge swaps which side is which. The box stays
  // valid; the artwork inside is not mirrored, which would be a different tool.
  const x0 = Math.min(left, right);
  const x1 = Math.max(left, right);
  const y0 = Math.min(top, bottom);
  const y1 = Math.max(top, bottom);

  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}
