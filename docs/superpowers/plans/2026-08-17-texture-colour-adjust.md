# Texture Colour Adjust Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let someone recolour a texture with hue, saturation and exposure sliders instead of repainting it.

**Architecture:** The colour maths lives in a pure module beside `selection.ts` and `pixelBuffer.ts`; the editor holds a pristine copy of the pixels for the duration of an adjustment and re-derives from it on every slider move, exactly as it already does for a floating selection.

**Tech Stack:** React 18, TypeScript strict, vitest, canvas 2D, Playwright for the browser pass.

## Global Constraints

- TypeScript strict with `noUnusedLocals` and `noUnusedParameters`; `npm run build` runs `tsc --noEmit` over `src` and `tests`.
- Pure modules must not touch the DOM: `getContext` returns `null` in this repo's test setup.
- Pixel buffers are `PixelBuffer` from `src/lib/pixelBuffer.ts`: `{ data: Uint8ClampedArray; width: number; height: number }`.
- Neutral values are hue `0`, saturation `1`, exposure `0`.
- Alpha is copied through untouched, and a pixel with `a === 0` is skipped entirely.
- Match surrounding style: comments explain *why*, `MCButton` for controls, `mc-range` for sliders.
- Do not commit; the working tree already carries unrelated uncommitted work.

---

### Task 1: Colour maths

**Files:**
- Create: `src/lib/adjust.ts`
- Test: `tests/adjust.test.ts`

**Interfaces:**
- Consumes: `PixelBuffer` from `src/lib/pixelBuffer.ts`, `Rect` from `src/lib/selection.ts`
- Produces: `Adjustment { hue: number; saturation: number; exposure: number }`, `NEUTRAL: Adjustment`, `isNeutral(a): boolean`, `rgbToHsl(r, g, b): [number, number, number]`, `hslToRgb(h, s, l): [number, number, number]`, `adjustInto(dest: PixelBuffer, src: PixelBuffer, a: Adjustment, rect?: Rect): void`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { adjustInto, hslToRgb, isNeutral, NEUTRAL, rgbToHsl } from '../src/lib/adjust';
import { getPixel, setPixel, type PixelBuffer, type RGBA } from '../src/lib/pixelBuffer';

const buffer = (w: number, h: number): PixelBuffer => ({
  data: new Uint8ClampedArray(w * h * 4), width: w, height: h,
});

const one = (c: RGBA): PixelBuffer => {
  const buf = buffer(1, 1);
  setPixel(buf, 0, 0, c);
  return buf;
};

const run = (c: RGBA, a: Partial<typeof NEUTRAL>): RGBA => {
  const src = one(c);
  const dest = buffer(1, 1);
  adjustInto(dest, src, { ...NEUTRAL, ...a });
  return getPixel(dest, 0, 0);
};

describe('rgbToHsl / hslToRgb', () => {
  it('round-trips within a unit', () => {
    for (const [r, g, b] of [[255, 0, 0], [0, 128, 64], [12, 200, 255], [40, 40, 40], [255, 255, 255]]) {
      const [h, s, l] = rgbToHsl(r, g, b);
      const [r2, g2, b2] = hslToRgb(h, s, l);
      expect(Math.abs(r2 - r)).toBeLessThanOrEqual(1);
      expect(Math.abs(g2 - g)).toBeLessThanOrEqual(1);
      expect(Math.abs(b2 - b)).toBeLessThanOrEqual(1);
    }
  });
});

describe('hue', () => {
  it('is identity at a full turn', () => {
    expect(run({ r: 200, g: 40, b: 30, a: 255 }, { hue: 360 }))
      .toEqual({ r: 200, g: 40, b: 30, a: 255 });
  });

  it('half a turn twice returns the original', () => {
    const once = run({ r: 200, g: 40, b: 30, a: 255 }, { hue: 180 });
    const src = one(once);
    const dest = buffer(1, 1);
    adjustInto(dest, src, { ...NEUTRAL, hue: 180 });
    const twice = getPixel(dest, 0, 0);
    for (const ch of ['r', 'g', 'b'] as const) {
      expect(Math.abs(twice[ch] - 200 * (ch === 'r' ? 1 : 0) - (ch === 'g' ? 40 : 0) - (ch === 'b' ? 30 : 0)))
        .toBeLessThanOrEqual(2);
    }
  });

  it('moves red towards green a third of the way round', () => {
    const out = run({ r: 255, g: 0, b: 0, a: 255 }, { hue: 120 });
    expect(out.g).toBeGreaterThan(200);
    expect(out.r).toBeLessThan(40);
  });
});

describe('saturation', () => {
  it('at zero leaves grey of the same lightness', () => {
    const out = run({ r: 200, g: 40, b: 30, a: 255 }, { saturation: 0 });
    expect(out.r).toBe(out.g);
    expect(out.g).toBe(out.b);
    const [, , l] = rgbToHsl(200, 40, 30);
    expect(Math.abs(out.r - Math.round(l * 255))).toBeLessThanOrEqual(1);
  });

  it('does not run a channel past 255 when pushed', () => {
    const out = run({ r: 250, g: 40, b: 30, a: 255 }, { saturation: 2 });
    expect(out.r).toBeLessThanOrEqual(255);
    expect(out.b).toBeGreaterThanOrEqual(0);
  });
});

describe('exposure', () => {
  it('doubles at +1 EV and halves at -1 EV', () => {
    expect(run({ r: 100, g: 60, b: 20, a: 255 }, { exposure: 1 }))
      .toEqual({ r: 200, g: 120, b: 40, a: 255 });
    expect(run({ r: 100, g: 60, b: 20, a: 255 }, { exposure: -1 }))
      .toEqual({ r: 50, g: 30, b: 10, a: 255 });
  });

  it('clamps rather than wrapping', () => {
    expect(run({ r: 200, g: 200, b: 200, a: 255 }, { exposure: 2 }))
      .toEqual({ r: 255, g: 255, b: 255, a: 255 });
  });
});

describe('alpha', () => {
  it('is copied through untouched', () => {
    expect(run({ r: 200, g: 40, b: 30, a: 128 }, { hue: 90 }).a).toBe(128);
  });

  it('leaves a fully transparent pixel alone', () => {
    // A hue shift on invisible pixels shows up as fringing once the texture is
    // scaled, so they must not be touched at all.
    expect(run({ r: 0, g: 0, b: 0, a: 0 }, { hue: 90, saturation: 2, exposure: 1 }))
      .toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });
});

describe('adjustInto with a rect', () => {
  it('changes only what is inside it', () => {
    const src = buffer(4, 1);
    for (let x = 0; x < 4; x++) setPixel(src, x, 0, { r: 200, g: 40, b: 30, a: 255 });
    const dest = buffer(4, 1);
    dest.data.set(src.data);

    adjustInto(dest, src, { ...NEUTRAL, exposure: -1 }, { x: 1, y: 0, w: 2, h: 1 });

    expect(getPixel(dest, 0, 0)).toEqual({ r: 200, g: 40, b: 30, a: 255 });
    expect(getPixel(dest, 1, 0)).toEqual({ r: 100, g: 20, b: 15, a: 255 });
    expect(getPixel(dest, 2, 0)).toEqual({ r: 100, g: 20, b: 15, a: 255 });
    expect(getPixel(dest, 3, 0)).toEqual({ r: 200, g: 40, b: 30, a: 255 });
  });
});

describe('isNeutral', () => {
  it('is true only at the neutral values', () => {
    expect(isNeutral(NEUTRAL)).toBe(true);
    expect(isNeutral({ hue: 1, saturation: 1, exposure: 0 })).toBe(false);
    expect(isNeutral({ hue: 0, saturation: 1.1, exposure: 0 })).toBe(false);
    expect(isNeutral({ hue: 0, saturation: 1, exposure: -0.5 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/adjust.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/adjust'`

- [ ] **Step 3: Implement `src/lib/adjust.ts`**

```ts
import { getPixel, setPixel, type PixelBuffer } from './pixelBuffer';
import type { Rect } from './selection';

export interface Adjustment {
  /** Degrees around the colour wheel. */
  hue: number;
  /** Multiplier: 0 is grey, 1 unchanged, 2 twice as colourful. */
  saturation: number;
  /** Stops of light: each step doubles or halves. */
  exposure: number;
}

export const NEUTRAL: Adjustment = { hue: 0, saturation: 1, exposure: 0 };

export function isNeutral(a: Adjustment): boolean {
  return a.hue === 0 && a.saturation === 1 && a.exposure === 0;
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
  else if (max === gn) h = ((bn - rn) / d + 2) * 60;
  else h = ((rn - gn) / d + 4) * 60;
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
    hp < 1 ? [c, x, 0] :
    hp < 2 ? [x, c, 0] :
    hp < 3 ? [0, c, x] :
    hp < 4 ? [0, x, c] :
    hp < 5 ? [x, 0, c] : [c, 0, x];

  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

/**
 * Write `src` into `dest` with the adjustment applied, optionally only inside a rect.
 *
 * Hue and saturation go through HSL because that is what "shift the colour"
 * means to a person. Exposure multiplies instead of adding, so shading scales
 * proportionally - adding a constant lifts dark and light pixels by the same
 * amount and flattens the shading pixel art depends on.
 */
export function adjustInto(
  dest: PixelBuffer,
  src: PixelBuffer,
  a: Adjustment,
  rect?: Rect,
): void {
  const gain = 2 ** a.exposure;
  const x0 = rect ? Math.max(0, rect.x) : 0;
  const y0 = rect ? Math.max(0, rect.y) : 0;
  const x1 = rect ? Math.min(src.width, rect.x + rect.w) : src.width;
  const y1 = rect ? Math.min(src.height, rect.y + rect.h) : src.height;

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = getPixel(src, x, y);
      // Invisible pixels carry colour that fringes as soon as the texture is
      // scaled, so they are left exactly as they are.
      if (p.a === 0) {
        setPixel(dest, x, y, p);
        continue;
      }

      const [h, s, l] = rgbToHsl(p.r, p.g, p.b);
      const [r, g, b] = hslToRgb(h + a.hue, Math.max(0, Math.min(1, s * a.saturation)), l);
      setPixel(dest, x, y, {
        r: clamp255(r * gain), g: clamp255(g * gain), b: clamp255(b * gain), a: p.a,
      });
    }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/adjust.test.ts`
Expected: PASS

---

### Task 2: The Adjust panel

**Files:**
- Modify: `src/components/TextureEditor.tsx`

**Interfaces:**
- Consumes: everything Task 1 produces, plus the editor's existing `pushUndo`, `stampFloat`, `repaint`, `selection`, `pixelsRef`
- Produces: no exports; user-visible behaviour only

- [ ] **Step 1: Add the state and the pristine copy**

```ts
const [adjustment, setAdjustment] = useState<Adjustment>(NEUTRAL);
/**
 * The pixels as they were before this adjustment began, and the region they
 * came from. Every slider move re-derives from these: re-applying a colour
 * transform to its own 8-bit output loses a little more on each pass, so
 * sliding back to neutral has to return to the original, not approach it.
 */
const adjustBaseRef = useRef<{ source: PixelBuffer; rect: Rect | null } | null>(null);
```

- [ ] **Step 2: Drive the sliders**

```ts
const applyAdjustment = (next: Adjustment) => {
  const pixels = pixelsRef.current;
  if (!pixels) return;

  if (!adjustBaseRef.current) {
    // Whatever is being carried lands first, so it is adjusted along with
    // everything else rather than dropped on top afterwards.
    stampFloat();
    pushUndo();
    const rect = selection ?? null;
    adjustBaseRef.current = {
      source: rect ? crop(pixels, rect) : { data: new Uint8ClampedArray(pixels.data), width: pixels.width, height: pixels.height },
      rect,
    };
  }

  const base = adjustBaseRef.current;
  if (base.rect) {
    // The crop starts at 0,0, so shift it back to where it came from.
    const shifted: PixelBuffer = { data: pixels.data, width: pixels.width, height: pixels.height };
    for (let y = 0; y < base.rect.h; y++) {
      for (let x = 0; x < base.rect.w; x++) {
        setPixel(shifted, base.rect.x + x, base.rect.y + y, getPixel(base.source, x, y));
      }
    }
    adjustInto(pixels, pixels, next, base.rect);
  } else {
    adjustInto(pixels, base.source, next);
  }

  setAdjustment(next);
  setDirty(true);
  repaint();
};

const commitAdjustment = () => {
  if (!adjustBaseRef.current) return;
  adjustBaseRef.current = null;
  setAdjustment(NEUTRAL);
  setStrokeTick((t) => t + 1);
  setHistoryTick((t) => t + 1);
};

const resetAdjustment = () => {
  const base = adjustBaseRef.current;
  const pixels = pixelsRef.current;
  if (!base || !pixels) return;
  if (base.rect) {
    for (let y = 0; y < base.rect.h; y++) {
      for (let x = 0; x < base.rect.w; x++) {
        setPixel(pixels, base.rect.x + x, base.rect.y + y, getPixel(base.source, x, y));
      }
    }
  } else {
    pixels.data.set(base.source.data);
  }
  adjustBaseRef.current = null;
  setAdjustment(NEUTRAL);
  setStrokeTick((t) => t + 1);
  setHistoryTick((t) => t + 1);
  repaint();
  playThud();
};
```

- [ ] **Step 3: Commit the adjustment wherever it must end**

`handleSave`, `resizeTo`, `importImage` and `undo`/`redo` already call `stampFloat`
or `discardFloat`. Add `commitAdjustment()` beside each `stampFloat()` call, and in
`undo`/`redo` clear the base without restoring (`adjustBaseRef.current = null;
setAdjustment(NEUTRAL);`) so the snapshot taken when the adjustment began is what
comes back.

- [ ] **Step 4: Render the panel**

```tsx
<div className="section-title">Adjust</div>
<div style={{ padding: '0 10px' }}>
  {([
    ['hue', -180, 180, 1, `${adjustment.hue > 0 ? '+' : ''}${adjustment.hue}°`],
    ['saturation', 0, 200, 5, `${Math.round(adjustment.saturation * 100)}%`],
    ['exposure', -200, 200, 5, `${adjustment.exposure > 0 ? '+' : ''}${adjustment.exposure.toFixed(2)} EV`],
  ] as Array<[keyof Adjustment, number, number, number, string]>).map(([name, min, max, step, label]) => (
    <label key={name} className="mc-text-shadow" style={{ fontSize: 16, display: 'block', marginTop: 6 }}>
      {name} {label}
      <input
        type="range"
        className="mc-range"
        min={min}
        max={max}
        step={step}
        value={name === 'hue' ? adjustment.hue : name === 'saturation' ? adjustment.saturation * 100 : adjustment.exposure * 100}
        onChange={(e) => {
          const raw = Number(e.target.value);
          applyAdjustment({
            ...adjustment,
            [name]: name === 'hue' ? raw : raw / 100,
          });
        }}
        disabled={!dims}
      />
    </label>
  ))}
  <div className="row" style={{ gap: 6, marginTop: 6 }}>
    <MCButton small onClick={commitAdjustment} disabled={isNeutral(adjustment)} title="Keep this colour change and start a fresh one">
      apply
    </MCButton>
    <MCButton small variant="danger" onClick={resetAdjustment} disabled={isNeutral(adjustment)} title="Put the original colours back">
      reset
    </MCButton>
  </div>
  <div className="t-gray" style={{ fontSize: 16, marginTop: 6, lineHeight: 'var(--lh-body)' }}>
    {selection ? 'changes only the selected area' : 'changes the whole texture'}
  </div>
</div>
```

- [ ] **Step 5: Verify**

Run: `npx vitest run && npm run build`
Expected: PASS, build clean

---

### Task 3: Browser pass

**Files:**
- Create (temporary): `scripts/_verify-adjust.mjs`

- [ ] **Step 1: Drive the sliders in a real browser**

Start `npx vite --port 5199`, then with Playwright: import `.shots/TestPackA.zip`,
open a texture in the editor, sample a known texel, drag the hue slider and confirm
the texel's colour changed, drag it back to 0 and confirm the texel is exactly its
original value, then use **reset** from a non-neutral position and confirm the same.
Then make a selection, adjust exposure, and confirm a texel outside the box is
untouched while one inside changed.

- [ ] **Step 2: Check the console and delete the script**

Expected: no console errors; the scratch script is removed afterwards.

---

## Self-Review

**Spec coverage:** three sliders with the stated ranges (T2.4) · live preview
(T2.2) · pristine copy taken once with one undo entry (T2.1, T2.2) · apply and
reset (T2.2, T2.4) · automatic commit on save/resize/import/undo (T2.3) · scoped
by the selection, float stamped first (T2.2) · alpha untouched and transparent
pixels skipped (T1) · HSL for hue and saturation, multiplier for exposure (T1) ·
pure module tests (T1) · browser pass (T3).

**Placeholders:** none — every step carries its code.

**Type consistency:** `Adjustment`, `NEUTRAL`, `isNeutral`, `adjustInto` are used
in Task 2 exactly as Task 1 defines them; `PixelBuffer`, `crop`, `getPixel` and
`setPixel` come from `pixelBuffer.ts`; `Rect` and `selection` from the existing
editor state.
