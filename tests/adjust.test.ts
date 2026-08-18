import { describe, expect, it } from 'vitest';
import { adjustInto, hslToRgb, isNeutral, NEUTRAL, rgbToHsl, type Adjustment } from '../src/lib/adjust';
import { getPixel, setPixel, type PixelBuffer, type RGBA } from '../src/lib/pixelBuffer';

const buffer = (w: number, h: number): PixelBuffer => ({
  data: new Uint8ClampedArray(w * h * 4),
  width: w,
  height: h,
});

const one = (c: RGBA): PixelBuffer => {
  const buf = buffer(1, 1);
  setPixel(buf, 0, 0, c);
  return buf;
};

const run = (c: RGBA, a: Partial<Adjustment>): RGBA => {
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
      expect(Math.abs(r2 - r), `r of ${r},${g},${b}`).toBeLessThanOrEqual(1);
      expect(Math.abs(g2 - g), `g of ${r},${g},${b}`).toBeLessThanOrEqual(1);
      expect(Math.abs(b2 - b), `b of ${r},${g},${b}`).toBeLessThanOrEqual(1);
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
    const twice = run(once, { hue: 180 });

    expect(Math.abs(twice.r - 200)).toBeLessThanOrEqual(2);
    expect(Math.abs(twice.g - 40)).toBeLessThanOrEqual(2);
    expect(Math.abs(twice.b - 30)).toBeLessThanOrEqual(2);
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

  it('does not run a channel past the ends when pushed', () => {
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
    // Colour hidden behind zero alpha fringes as soon as the texture is scaled,
    // so an adjustment must not touch it at all.
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

    adjustInto(dest, src, { ...NEUTRAL, exposure: -1 }, { rect: { x: 1, y: 0, w: 2, h: 1 }, mask: null });

    expect(getPixel(dest, 0, 0)).toEqual({ r: 200, g: 40, b: 30, a: 255 });
    expect(getPixel(dest, 1, 0)).toEqual({ r: 100, g: 20, b: 15, a: 255 });
    expect(getPixel(dest, 2, 0)).toEqual({ r: 100, g: 20, b: 15, a: 255 });
    expect(getPixel(dest, 3, 0)).toEqual({ r: 200, g: 40, b: 30, a: 255 });
  });

  it('follows a mask, not just its bounding box', () => {
    // What a wand selection produces: a shape inside a box, where the pixels the
    // mask leaves out have to come through untouched.
    const src = buffer(3, 1);
    for (let x = 0; x < 3; x++) setPixel(src, x, 0, { r: 100, g: 100, b: 100, a: 255 });
    const dest = buffer(3, 1);
    dest.data.set(src.data);

    adjustInto(dest, src, { ...NEUTRAL, exposure: -1 }, {
      rect: { x: 0, y: 0, w: 3, h: 1 },
      mask: new Uint8Array([1, 0, 1]),
    });

    expect(getPixel(dest, 0, 0)).toEqual({ r: 50, g: 50, b: 50, a: 255 });
    expect(getPixel(dest, 1, 0)).toEqual({ r: 100, g: 100, b: 100, a: 255 });
    expect(getPixel(dest, 2, 0)).toEqual({ r: 50, g: 50, b: 50, a: 255 });
  });

  it('clips a rect that runs off the edge', () => {
    const src = buffer(2, 1);
    for (let x = 0; x < 2; x++) setPixel(src, x, 0, { r: 100, g: 100, b: 100, a: 255 });
    const dest = buffer(2, 1);
    dest.data.set(src.data);

    adjustInto(dest, src, { ...NEUTRAL, exposure: -1 }, { rect: { x: 1, y: 0, w: 8, h: 8 }, mask: null });

    expect(getPixel(dest, 0, 0)).toEqual({ r: 100, g: 100, b: 100, a: 255 });
    expect(getPixel(dest, 1, 0)).toEqual({ r: 50, g: 50, b: 50, a: 255 });
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
