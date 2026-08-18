# Texture Editor Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a rectangular selection to the texture editor that clamps painting to the selected area and can move and rescale the pixels inside it.

**Architecture:** Two pure DOM-free modules hold the geometry and the pixel arithmetic so both are unit-testable under this repo's node/jsdom setup; `TextureEditor.tsx` keeps only gesture handling and drawing. A transform stays *floating* — a pristine crop plus a rect — until it is stamped down, so repeated rescales never compound.

**Tech Stack:** React 18, TypeScript strict, vitest, canvas 2D, Playwright for the browser pass.

## Global Constraints

- TypeScript strict with `noUnusedLocals` and `noUnusedParameters`; `npm run build` runs `tsc --noEmit` over `src` and `tests`.
- Pure modules must not touch the DOM: `HTMLCanvasElement.prototype.getContext` returns `null` in this repo's test setup (`tests/setupDom.ts:26`).
- Pixel buffers are the structural type `{ data: Uint8ClampedArray; width: number; height: number }`, which `ImageData` already satisfies.
- Texture coordinates are texels. Hit-testing and handle drags take continuous coordinates; painting takes integers.
- Match surrounding style: comments explain *why*, `MCButton` for controls, sounds via `src/lib/sfx.ts`.
- Do not commit; the working tree already carries unrelated uncommitted work.

---

### Task 1: Selection geometry

**Files:**
- Create: `src/lib/selection.ts`
- Test: `tests/selection.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `Rect { x, y, w, h }`, `Handle = 'nw'|'n'|'ne'|'e'|'se'|'s'|'sw'|'w'`, `HitTarget = Handle | 'inside' | null`, `rectFromDrag(ax, ay, bx, by): Rect`, `clampRect(rect, width, height): Rect`, `containsPoint(rect, x, y): boolean`, `hitHandle(rect, x, y, tolerance): HitTarget`, `dragHandle(rect, handle, x, y): Rect`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { clampRect, containsPoint, dragHandle, hitHandle, rectFromDrag } from '../src/lib/selection';

describe('rectFromDrag', () => {
  it('covers both texels whichever way the drag went', () => {
    expect(rectFromDrag(3, 2, 5, 6)).toEqual({ x: 3, y: 2, w: 3, h: 5 });
    expect(rectFromDrag(5, 6, 3, 2)).toEqual({ x: 3, y: 2, w: 3, h: 5 });
  });

  it('is 1x1 for a click', () => {
    expect(rectFromDrag(4, 4, 4, 4)).toEqual({ x: 4, y: 4, w: 1, h: 1 });
  });
});

describe('clampRect', () => {
  it('pulls a rect back inside the texture', () => {
    expect(clampRect({ x: 14, y: 14, w: 8, h: 8 }, 16, 16)).toEqual({ x: 8, y: 8, w: 8, h: 8 });
    expect(clampRect({ x: -4, y: -4, w: 8, h: 8 }, 16, 16)).toEqual({ x: 0, y: 0, w: 8, h: 8 });
  });

  it('shrinks a rect larger than the texture', () => {
    expect(clampRect({ x: 0, y: 0, w: 40, h: 40 }, 16, 16)).toEqual({ x: 0, y: 0, w: 16, h: 16 });
  });
});

describe('containsPoint', () => {
  const rect = { x: 2, y: 2, w: 3, h: 3 };
  it('includes the top-left texel and excludes the far edge', () => {
    expect(containsPoint(rect, 2, 2)).toBe(true);
    expect(containsPoint(rect, 4, 4)).toBe(true);
    expect(containsPoint(rect, 5, 4)).toBe(false);
    expect(containsPoint(rect, 1, 2)).toBe(false);
  });
});

describe('hitHandle', () => {
  const rect = { x: 4, y: 4, w: 8, h: 8 };
  it('finds the corners', () => {
    expect(hitHandle(rect, 4, 4, 0.6)).toBe('nw');
    expect(hitHandle(rect, 12, 4, 0.6)).toBe('ne');
    expect(hitHandle(rect, 4, 12, 0.6)).toBe('sw');
    expect(hitHandle(rect, 12, 12, 0.6)).toBe('se');
  });

  it('finds the edges between the corners', () => {
    expect(hitHandle(rect, 8, 4, 0.6)).toBe('n');
    expect(hitHandle(rect, 8, 12, 0.6)).toBe('s');
    expect(hitHandle(rect, 4, 8, 0.6)).toBe('w');
    expect(hitHandle(rect, 12, 8, 0.6)).toBe('e');
  });

  it('reports the inside and the outside', () => {
    expect(hitHandle(rect, 8, 8, 0.6)).toBe('inside');
    expect(hitHandle(rect, 1, 1, 0.6)).toBeNull();
  });
});

describe('dragHandle', () => {
  const rect = { x: 4, y: 4, w: 8, h: 8 };
  it('moves the dragged edge only', () => {
    expect(dragHandle(rect, 'e', 16, 8)).toEqual({ x: 4, y: 4, w: 12, h: 8 });
    expect(dragHandle(rect, 'n', 8, 2)).toEqual({ x: 4, y: 2, w: 8, h: 10 });
  });

  it('moves both edges of a corner', () => {
    expect(dragHandle(rect, 'se', 20, 20)).toEqual({ x: 4, y: 4, w: 16, h: 16 });
  });

  it('normalises a drag past the opposite edge', () => {
    expect(dragHandle(rect, 'e', 0, 8)).toEqual({ x: 0, y: 4, w: 4, h: 8 });
  });

  it('never collapses below one texel', () => {
    expect(dragHandle(rect, 'e', 4, 8)).toEqual({ x: 4, y: 4, w: 1, h: 8 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/selection.test.ts`
Expected: FAIL — `Failed to resolve import "../src/lib/selection"`

- [ ] **Step 3: Implement `src/lib/selection.ts`**

```ts
export interface Rect { x: number; y: number; w: number; h: number }
export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export type HitTarget = Handle | 'inside' | null;

export function rectFromDrag(ax: number, ay: number, bx: number, by: number): Rect {
  return {
    x: Math.min(ax, bx),
    y: Math.min(ay, by),
    w: Math.abs(bx - ax) + 1,
    h: Math.abs(by - ay) + 1,
  };
}

export function clampRect(rect: Rect, width: number, height: number): Rect {
  const w = Math.max(1, Math.min(rect.w, width));
  const h = Math.max(1, Math.min(rect.h, height));
  return {
    w, h,
    x: Math.max(0, Math.min(rect.x, width - w)),
    y: Math.max(0, Math.min(rect.y, height - h)),
  };
}

export function containsPoint(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && y >= rect.y && x < rect.x + rect.w && y < rect.y + rect.h;
}

export function hitHandle(rect: Rect, x: number, y: number, tolerance: number): HitTarget {
  // Edges are texel boundaries, so these are continuous coordinates - the left
  // edge of texel 4 is 4.0 and its right edge is 5.0.
  const left = rect.x, right = rect.x + rect.w, top = rect.y, bottom = rect.y + rect.h;
  const nearLeft = Math.abs(x - left) <= tolerance;
  const nearRight = Math.abs(x - right) <= tolerance;
  const nearTop = Math.abs(y - top) <= tolerance;
  const nearBottom = Math.abs(y - bottom) <= tolerance;
  const spansX = x >= left - tolerance && x <= right + tolerance;
  const spansY = y >= top - tolerance && y <= bottom + tolerance;

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

export function dragHandle(rect: Rect, handle: Handle, x: number, y: number): Rect {
  let left = rect.x, right = rect.x + rect.w, top = rect.y, bottom = rect.y + rect.h;
  if (handle.includes('w')) left = Math.round(x);
  if (handle.includes('e')) right = Math.round(x);
  if (handle.includes('n')) top = Math.round(y);
  if (handle.includes('s')) bottom = Math.round(y);

  // Dragging past the opposite edge flips which side is which; the box stays
  // valid and the artwork inside is not mirrored.
  const x0 = Math.min(left, right), x1 = Math.max(left, right);
  const y0 = Math.min(top, bottom), y1 = Math.max(top, bottom);
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/selection.test.ts`
Expected: PASS, 12 tests

---

### Task 2: Pixel buffer operations

**Files:**
- Create: `src/lib/pixelBuffer.ts`
- Test: `tests/pixelBuffer.test.ts`
- Modify: `src/components/TextureEditor.tsx` — delete the local `RGBA`, `setPixel`, `getPixel`, `floodFill` and import them instead

**Interfaces:**
- Consumes: `Rect` from Task 1
- Produces: `PixelBuffer { data, width, height }`, `RGBA { r, g, b, a }`, `getPixel(buf, x, y): RGBA`, `setPixel(buf, x, y, c): void`, `crop(buf, rect): PixelBuffer`, `clearRect(buf, rect): void`, `drawScaled(dest, src, rect): void`, `floodFill(buf, x, y, colour, bounds?): void`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { clearRect, crop, drawScaled, floodFill, getPixel, setPixel, type PixelBuffer } from '../src/lib/pixelBuffer';

const buffer = (width: number, height: number): PixelBuffer => ({
  data: new Uint8ClampedArray(width * height * 4),
  width,
  height,
});

const fill = (buf: PixelBuffer, c: { r: number; g: number; b: number; a: number }) => {
  for (let y = 0; y < buf.height; y++) for (let x = 0; x < buf.width; x++) setPixel(buf, x, y, c);
};

const RED = { r: 255, g: 0, b: 0, a: 255 };
const BLUE = { r: 0, g: 0, b: 255, a: 255 };
const CLEAR = { r: 0, g: 0, b: 0, a: 0 };

describe('crop', () => {
  it('takes the rect out of the buffer', () => {
    const buf = buffer(4, 4);
    setPixel(buf, 1, 1, RED);
    const piece = crop(buf, { x: 1, y: 1, w: 2, h: 2 });
    expect(piece.width).toBe(2);
    expect(getPixel(piece, 0, 0)).toEqual(RED);
    expect(getPixel(piece, 1, 1)).toEqual(CLEAR);
  });
});

describe('clearRect', () => {
  it('empties the rect and leaves the rest', () => {
    const buf = buffer(4, 4);
    fill(buf, RED);
    clearRect(buf, { x: 1, y: 1, w: 2, h: 2 });
    expect(getPixel(buf, 1, 1)).toEqual(CLEAR);
    expect(getPixel(buf, 0, 0)).toEqual(RED);
    expect(getPixel(buf, 3, 3)).toEqual(RED);
  });
});

describe('drawScaled', () => {
  it('survives a shrink and a regrow, because it always reads the original', () => {
    const source = buffer(4, 4);
    setPixel(source, 0, 0, RED);
    setPixel(source, 3, 3, BLUE);

    const small = buffer(16, 16);
    drawScaled(small, source, { x: 0, y: 0, w: 1, h: 1 });

    const back = buffer(16, 16);
    drawScaled(back, source, { x: 0, y: 0, w: 4, h: 4 });

    expect(getPixel(back, 0, 0)).toEqual(RED);
    expect(getPixel(back, 3, 3)).toEqual(BLUE);
  });

  it('nearest-neighbours an upscale', () => {
    const source = buffer(2, 2);
    setPixel(source, 0, 0, RED);
    const dest = buffer(8, 8);
    drawScaled(dest, source, { x: 0, y: 0, w: 4, h: 4 });

    expect(getPixel(dest, 0, 0)).toEqual(RED);
    expect(getPixel(dest, 1, 1)).toEqual(RED);
    expect(getPixel(dest, 2, 2)).toEqual(CLEAR);
  });

  it('clips at the edge of the destination', () => {
    const source = buffer(2, 2);
    fill(source, RED);
    const dest = buffer(4, 4);
    drawScaled(dest, source, { x: 3, y: 3, w: 4, h: 4 });
    expect(getPixel(dest, 3, 3)).toEqual(RED);
    expect(dest.data.length).toBe(4 * 4 * 4);
  });

  it('composites rather than punching a transparent hole', () => {
    const dest = buffer(4, 4);
    fill(dest, BLUE);
    const source = buffer(2, 2);
    setPixel(source, 0, 0, RED);

    drawScaled(dest, source, { x: 0, y: 0, w: 2, h: 2 });

    expect(getPixel(dest, 0, 0)).toEqual(RED);
    // The transparent part of the source must leave what was underneath.
    expect(getPixel(dest, 1, 1)).toEqual(BLUE);
  });
});

describe('floodFill', () => {
  it('fills the matching area', () => {
    const buf = buffer(4, 4);
    floodFill(buf, 0, 0, RED);
    expect(getPixel(buf, 3, 3)).toEqual(RED);
  });

  it('stops at the bounds', () => {
    const buf = buffer(4, 4);
    floodFill(buf, 0, 0, RED, { x: 0, y: 0, w: 2, h: 2 });
    expect(getPixel(buf, 1, 1)).toEqual(RED);
    expect(getPixel(buf, 2, 2)).toEqual(CLEAR);
  });

  it('does nothing when the start is outside the bounds', () => {
    const buf = buffer(4, 4);
    floodFill(buf, 3, 3, RED, { x: 0, y: 0, w: 2, h: 2 });
    expect(getPixel(buf, 3, 3)).toEqual(CLEAR);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/pixelBuffer.test.ts`
Expected: FAIL — `Failed to resolve import "../src/lib/pixelBuffer"`

- [ ] **Step 3: Implement `src/lib/pixelBuffer.ts`**

```ts
import { containsPoint, type Rect } from './selection';

/** Structural shape of `ImageData`, so these run in tests without a canvas. */
export interface PixelBuffer {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface RGBA { r: number; g: number; b: number; a: number }

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

export function crop(buf: PixelBuffer, rect: Rect): PixelBuffer {
  const out: PixelBuffer = {
    data: new Uint8ClampedArray(rect.w * rect.h * 4),
    width: rect.w,
    height: rect.h,
  };
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) {
      const sx = rect.x + x, sy = rect.y + y;
      if (sx < 0 || sy < 0 || sx >= buf.width || sy >= buf.height) continue;
      setPixel(out, x, y, getPixel(buf, sx, sy));
    }
  }
  return out;
}

export function clearRect(buf: PixelBuffer, rect: Rect): void {
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      if (x < 0 || y < 0 || x >= buf.width || y >= buf.height) continue;
      setPixel(buf, x, y, { r: 0, g: 0, b: 0, a: 0 });
    }
  }
}

/**
 * Nearest-neighbour a source buffer into a rect, compositing over what is there.
 *
 * Compositing rather than replacing is what lets a moved selection be dropped on
 * top of other artwork: the transparent parts of the piece leave the art beneath
 * alone instead of punching a rectangular hole around it.
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

      // Source-over for the partly transparent case.
      const d = getPixel(dest, dx, dy);
      const sa = s.a / 255, da = d.a / 255;
      const a = sa + da * (1 - sa);
      const mix = (sc: number, dc: number) => Math.round((sc * sa + dc * da * (1 - sa)) / a);
      setPixel(dest, dx, dy, { r: mix(s.r, d.r), g: mix(s.g, d.g), b: mix(s.b, d.b), a: Math.round(a * 255) });
    }
  }
}

export function floodFill(buf: PixelBuffer, x: number, y: number, colour: RGBA, bounds?: Rect): void {
  if (bounds && !containsPoint(bounds, x, y)) return;

  const target = getPixel(buf, x, y);
  const same = (p: RGBA) => p.r === target.r && p.g === target.g && p.b === target.b && p.a === target.a;
  if (same(colour)) return;

  const stack: Array<[number, number]> = [[x, y]];
  const seen = new Uint8Array(buf.width * buf.height);

  while (stack.length > 0) {
    const [cx, cy] = stack.pop()!;
    if (cx < 0 || cy < 0 || cx >= buf.width || cy >= buf.height) continue;
    if (bounds && !containsPoint(bounds, cx, cy)) continue;
    const flat = cy * buf.width + cx;
    if (seen[flat]) continue;
    if (!same(getPixel(buf, cx, cy))) continue;

    seen[flat] = 1;
    setPixel(buf, cx, cy, colour);
    stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/pixelBuffer.test.ts`
Expected: PASS, 9 tests

- [ ] **Step 5: Point the editor at the shared helpers**

In `src/components/TextureEditor.tsx`, delete the local `RGBA` interface and the
`setPixel`, `getPixel` and `floodFill` definitions, and import them:

```ts
import { floodFill, getPixel, setPixel, type RGBA } from '../lib/pixelBuffer';
```

- [ ] **Step 6: Verify nothing regressed**

Run: `npx vitest run && npm run build`
Expected: PASS, build clean

---

### Task 3: The select tool

**Files:**
- Modify: `src/components/TextureEditor.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1 and 2
- Produces: no exports; user-visible behaviour only

- [ ] **Step 1: Add the tool, the state and the float**

```ts
type Tool = 'select' | 'pencil' | 'eraser' | 'bucket' | 'eyedropper';

const [selection, setSelection] = useState<Rect | null>(null);
/** Lifted pixels: the pristine crop plus where it currently sits. */
const floatRef = useRef<{ source: PixelBuffer; rect: Rect } | null>(null);
const gestureRef = useRef<
  { mode: 'new' | 'move' | 'resize'; handle: Handle | null; startRect: Rect; startX: number; startY: number }
  | null
>(null);
```

- [ ] **Step 2: Add lift, stamp and discard**

```ts
/**
 * Take the selected pixels out of the texture and hold them.
 *
 * The crop taken here is the only thing later drags resample from, so scaling a
 * piece down and back up returns the artwork rather than a blur of whatever the
 * last drag left behind. One undo snapshot covers the whole transform.
 */
const lift = (rect: Rect) => {
  const pixels = pixelsRef.current;
  if (!pixels || floatRef.current) return;
  pushUndo();
  floatRef.current = { source: crop(pixels, rect), rect };
  clearRect(pixels, rect);
  setDirty(true);
};

const stampFloat = () => {
  const float = floatRef.current;
  const pixels = pixelsRef.current;
  if (!float || !pixels) return;
  drawScaled(pixels, float.source, float.rect);
  floatRef.current = null;
  setDirty(true);
  setStrokeTick((t) => t + 1);
  setHistoryTick((t) => t + 1);
};

/** Drop the lifted pixels without writing them; undo restores the hole. */
const discardFloat = () => {
  floatRef.current = null;
};
```

- [ ] **Step 3: Route pointer events through the select tool**

Add a texel helper and branch `onPointerDown` / `onPointerMove` / `onPointerUp`
on `tool === 'select'`. Continuous coordinates for hit-testing, floored for the
rubber band:

```ts
const toTexel = (clientX: number, clientY: number) => {
  const canvas = canvasRef.current;
  const pixels = pixelsRef.current;
  if (!canvas || !pixels) return null;
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((clientX - rect.left) / rect.width) * pixels.width,
    y: ((clientY - rect.top) / rect.height) * pixels.height,
  };
};

const beginSelect = (clientX: number, clientY: number) => {
  const point = toTexel(clientX, clientY);
  const pixels = pixelsRef.current;
  if (!point || !pixels) return;

  // A handle is a few screen pixels; convert that to texels so it stays
  // grabbable at 1x zoom, where a texel is one pixel on screen.
  const tolerance = Math.max(0.5, HANDLE / zoom / 2);
  const target = selection ? hitHandle(selection, point.x, point.y, tolerance) : null;

  if (target === null) {
    stampFloat();
    const x = Math.floor(point.x), y = Math.floor(point.y);
    gestureRef.current = { mode: 'new', handle: null, startRect: { x, y, w: 1, h: 1 }, startX: point.x, startY: point.y };
    setSelection(clampRect({ x, y, w: 1, h: 1 }, pixels.width, pixels.height));
    return;
  }

  gestureRef.current = {
    mode: target === 'inside' ? 'move' : 'resize',
    handle: target === 'inside' ? null : target,
    startRect: selection!,
    startX: point.x,
    startY: point.y,
  };
};

const dragSelect = (clientX: number, clientY: number) => {
  const gesture = gestureRef.current;
  const point = toTexel(clientX, clientY);
  const pixels = pixelsRef.current;
  if (!gesture || !point || !pixels) return;

  let next: Rect;
  if (gesture.mode === 'new') {
    next = rectFromDrag(gesture.startRect.x, gesture.startRect.y, Math.floor(point.x), Math.floor(point.y));
  } else if (gesture.mode === 'move') {
    const dx = Math.round(point.x - gesture.startX);
    const dy = Math.round(point.y - gesture.startY);
    if (dx === 0 && dy === 0) return;
    lift(gesture.startRect);
    next = { ...gesture.startRect, x: gesture.startRect.x + dx, y: gesture.startRect.y + dy };
  } else {
    const resized = dragHandle(gesture.startRect, gesture.handle!, point.x, point.y);
    if (resized.x === gesture.startRect.x && resized.y === gesture.startRect.y
      && resized.w === gesture.startRect.w && resized.h === gesture.startRect.h) return;
    lift(gesture.startRect);
    next = resized;
  }

  const clamped = clampRect(next, pixels.width, pixels.height);
  if (floatRef.current) floatRef.current.rect = clamped;
  setSelection(clamped);
};
```

`onPointerUp` clears `gestureRef.current`. The existing painting path stays as it
is for the other tools.

- [ ] **Step 4: Clamp painting to the selection**

In `applyAt`, after the texel is computed and the eyedropper branch has run:

```ts
// The eyedropper is exempt: sampling cannot damage the texture, and a pick that
// silently did nothing outside the box would read as a bug.
if (selection && !containsPoint(selection, x, y)) return;
```

and pass the bounds to the fill:

```ts
floodFill(pixels, x, y, color, selection ?? undefined);
```

- [ ] **Step 5: Stamp the float wherever the transform has to end**

- `setTool` for any paint tool → `stampFloat()` first
- deselect (`Esc`, `Ctrl+D`, the deselect button) → `stampFloat()` then `setSelection(null)`
- `handleSave` → `stampFloat()` before reading `pixelsRef.current`
- `resizeTo` and `importImage` → `stampFloat()` then `setSelection(null)`; the
  dimensions change under it
- `undo` and `redo` → `discardFloat()` first, then clamp any selection to the
  restored dimensions

- [ ] **Step 6: Draw the marquee**

At the end of `repaint`, after the grid:

```ts
const float = floatRef.current;
if (float) {
  const piece = document.createElement('canvas');
  piece.width = float.source.width;
  piece.height = float.source.height;
  piece.getContext('2d')?.putImageData(
    new ImageData(new Uint8ClampedArray(float.source.data), float.source.width, float.source.height), 0, 0,
  );
  ctx.drawImage(piece, float.rect.x * zoom, float.rect.y * zoom, float.rect.w * zoom, float.rect.h * zoom);
}

if (selection) {
  const x = selection.x * zoom, y = selection.y * zoom;
  const w = selection.w * zoom, h = selection.h * zoom;

  // Dim outside only while selecting: under a paint tool it would falsify the
  // colours you are trying to match.
  if (tool === 'select') {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, canvas.width, y);
    ctx.fillRect(0, y + h, canvas.width, canvas.height - (y + h));
    ctx.fillRect(0, y, x, h);
    ctx.fillRect(x + w, y, canvas.width - (x + w), h);
  }

  // Black under white dashes, so the outline reads on any artwork.
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.strokeStyle = '#000';
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = '#fff';
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  ctx.setLineDash([]);

  if (tool === 'select') {
    for (const [hx, hy] of [
      [x, y], [x + w / 2, y], [x + w, y],
      [x, y + h / 2], [x + w, y + h / 2],
      [x, y + h], [x + w / 2, y + h], [x + w, y + h],
    ]) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(hx - HANDLE / 2, hy - HANDLE / 2, HANDLE, HANDLE);
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.strokeRect(hx - HANDLE / 2, hy - HANDLE / 2, HANDLE, HANDLE);
    }
  }
}
```

`const HANDLE = 8;` beside the other module constants. `repaint`'s dependency
array gains `selection` and `tool`.

- [ ] **Step 7: Keys, cursor and the sidebar**

- key map gains `m: 'select'`
- `Ctrl+A` selects the whole texture, `Ctrl+D` deselects, `Delete`/`Backspace`
  discards a float or clears the selected pixels behind one `pushUndo`
- `Escape` deselects when there is a selection, otherwise closes the editor
- while the select tool is active and no gesture is running, `onPointerMove` sets
  the canvas cursor from `hitHandle`: `nwse-resize`, `nesw-resize`, `ns-resize`,
  `ew-resize`, `move`, else `crosshair`
- a "Selection" section in the sidebar shows `w×h at x,y` with **select all** and
  **deselect** buttons, and the key hints

- [ ] **Step 8: Verify**

Run: `npx vitest run && npm run build`
Expected: PASS, build clean

---

### Task 4: Browser pass

**Files:**
- Create (temporary): `scripts/_verify-selection.mjs`

- [ ] **Step 1: Drive the editor in a real browser**

Start `npx vite --port 5199`, then with Playwright: import `.shots/TestPackA.zip`,
select a slot, open **Edit Texture**, click the **select** tool, drag a box across
part of the texture, screenshot; drag from inside it to move the piece, screenshot;
drag the south-east handle outward, screenshot; switch to the pencil, paint outside
the box and confirm the pixels do not change; paint inside and confirm they do.

- [ ] **Step 2: Check the shots and the console**

Expected: a dashed box with handles, the piece moving and rescaling with a hole
left behind, no console errors, and paint landing only inside the box.

- [ ] **Step 3: Delete the scratch script**

---

## Self-Review

**Spec coverage:** select tool and shortcut (T3.1, T3.7) · rubber band (T3.3) ·
move pixels (T3.3) · resize resamples (T3.3) · lift once and resample from the
pristine crop (T2 `drawScaled`, T3.2) · stamp rules (T3.5) · undo is one step and
discards a float (T3.2, T3.5) · paint clamp and bounded fill (T3.4, T2) ·
eyedropper exempt (T3.4) · `Ctrl+A` / `Ctrl+D` / `Delete` / `Esc` (T3.7) ·
dashed outline, screen-sized handles, dimming (T3.6) · pure modules (T1, T2) ·
tests (T1, T2) · browser pass (T4).

**Placeholders:** none — every step carries its code.

**Type consistency:** `Rect` and `Handle` come from `selection.ts` and are used
unchanged in `pixelBuffer.ts` and the editor; `PixelBuffer` and `RGBA` come from
`pixelBuffer.ts`; `floatRef` holds `{ source: PixelBuffer; rect: Rect }` in every
step that touches it.
