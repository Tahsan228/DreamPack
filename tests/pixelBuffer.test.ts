import { describe, expect, it } from 'vitest';
import {
  clearRect, crop, drawScaled, floodFill, getPixel, setPixel, type PixelBuffer, type RGBA,
} from '../src/lib/pixelBuffer';

const buffer = (width: number, height: number): PixelBuffer => ({
  data: new Uint8ClampedArray(width * height * 4),
  width,
  height,
});

const fill = (buf: PixelBuffer, c: RGBA) => {
  for (let y = 0; y < buf.height; y++) for (let x = 0; x < buf.width; x++) setPixel(buf, x, y, c);
};

const RED: RGBA = { r: 255, g: 0, b: 0, a: 255 };
const BLUE: RGBA = { r: 0, g: 0, b: 255, a: 255 };
const CLEAR: RGBA = { r: 0, g: 0, b: 0, a: 0 };

describe('crop', () => {
  it('takes the rect out of the buffer', () => {
    const buf = buffer(4, 4);
    setPixel(buf, 1, 1, RED);

    const piece = crop(buf, { x: 1, y: 1, w: 2, h: 2 });

    expect(piece.width).toBe(2);
    expect(getPixel(piece, 0, 0)).toEqual(RED);
    expect(getPixel(piece, 1, 1)).toEqual(CLEAR);
  });

  it('reads as transparent past the edge of the buffer', () => {
    const buf = buffer(2, 2);
    fill(buf, RED);

    const piece = crop(buf, { x: 1, y: 1, w: 3, h: 3 });

    expect(getPixel(piece, 0, 0)).toEqual(RED);
    expect(getPixel(piece, 2, 2)).toEqual(CLEAR);
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
  /**
   * The reason the transform floats: every drag redraws from the crop taken when
   * the pixels were lifted, so a trip down to one texel and back is lossless.
   */
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
    // The transparent part of the piece must leave what was underneath.
    expect(getPixel(dest, 1, 1)).toEqual(BLUE);
  });

  it('blends a half-transparent pixel over what is there', () => {
    const dest = buffer(1, 1);
    setPixel(dest, 0, 0, BLUE);
    const source = buffer(1, 1);
    setPixel(source, 0, 0, { r: 255, g: 0, b: 0, a: 128 });

    drawScaled(dest, source, { x: 0, y: 0, w: 1, h: 1 });

    const out = getPixel(dest, 0, 0);
    expect(out.a).toBe(255);
    expect(out.r).toBeGreaterThan(100);
    expect(out.b).toBeGreaterThan(100);
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

    floodFill(buf, 0, 0, RED, { rect: { x: 0, y: 0, w: 2, h: 2 }, mask: null });

    expect(getPixel(buf, 1, 1)).toEqual(RED);
    expect(getPixel(buf, 2, 2)).toEqual(CLEAR);
  });

  it('does nothing when the start is outside the bounds', () => {
    const buf = buffer(4, 4);

    floodFill(buf, 3, 3, RED, { rect: { x: 0, y: 0, w: 2, h: 2 }, mask: null });

    expect(getPixel(buf, 3, 3)).toEqual(CLEAR);
  });

  it('stops at the edge of a masked shape, not its bounding box', () => {
    const buf = buffer(3, 1);

    floodFill(buf, 0, 0, RED, {
      rect: { x: 0, y: 0, w: 3, h: 1 },
      mask: new Uint8Array([1, 0, 1]),
    });

    expect(getPixel(buf, 0, 0)).toEqual(RED);
    expect(getPixel(buf, 1, 0)).toEqual(CLEAR);
    // Unreachable: the flood cannot cross the gap the mask leaves.
    expect(getPixel(buf, 2, 0)).toEqual(CLEAR);
  });

  it('leaves a different colour alone', () => {
    const buf = buffer(3, 1);
    setPixel(buf, 1, 0, BLUE);

    floodFill(buf, 0, 0, RED);

    expect(getPixel(buf, 0, 0)).toEqual(RED);
    expect(getPixel(buf, 1, 0)).toEqual(BLUE);
    expect(getPixel(buf, 2, 0)).toEqual(CLEAR);
  });
});
