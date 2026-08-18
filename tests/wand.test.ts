import { describe, expect, it } from 'vitest';
import { scaleMask, selectSimilar } from '../src/lib/wand';
import { covers, countCovered, type Selection } from '../src/lib/selection';
import { setPixel, type PixelBuffer, type RGBA } from '../src/lib/pixelBuffer';

const RED: RGBA = { r: 255, g: 0, b: 0, a: 255 };
const NEAR_RED: RGBA = { r: 240, g: 10, b: 10, a: 255 };
const BLUE: RGBA = { r: 0, g: 0, b: 255, a: 255 };

/**
 * Build a buffer from rows of single-character colour codes, so the shape being
 * selected is visible in the test.
 */
function paint(rows: string[]): PixelBuffer {
  const width = rows[0].length;
  const height = rows.length;
  const buf: PixelBuffer = {
    data: new Uint8ClampedArray(width * height * 4),
    width,
    height,
  };
  const colours: Record<string, RGBA> = {
    r: RED, n: NEAR_RED, b: BLUE, '.': { r: 0, g: 0, b: 0, a: 0 },
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) setPixel(buf, x, y, colours[rows[y][x]]);
  }
  return buf;
}

const shape = (sel: Selection, width: number, height: number): string[] => {
  const rows: string[] = [];
  for (let y = 0; y < height; y++) {
    let row = '';
    for (let x = 0; x < width; x++) row += covers(sel, x, y) ? '#' : '.';
    rows.push(row);
  }
  return rows;
};

describe('selectSimilar', () => {
  it('takes the connected run of one colour', () => {
    const buf = paint([
      'rrbb',
      'rrbb',
      'bbbb',
    ]);

    const sel = selectSimilar(buf, 0, 0, 0, false)!;

    expect(shape(sel, 4, 3)).toEqual([
      '##..',
      '##..',
      '....',
    ]);
    expect(sel.rect).toEqual({ x: 0, y: 0, w: 2, h: 2 });
  });

  it('leaves a matching patch that is not connected alone', () => {
    const buf = paint([
      'rbr',
      'bbb',
    ]);

    const sel = selectSimilar(buf, 0, 0, 0, false)!;

    expect(shape(sel, 3, 2)).toEqual([
      '#..',
      '...',
    ]);
  });

  it('takes every matching pixel when asked for the colour everywhere', () => {
    const buf = paint([
      'rbr',
      'bbb',
    ]);

    const sel = selectSimilar(buf, 0, 0, 0, true)!;

    expect(shape(sel, 3, 2)).toEqual([
      '#.#',
      '...',
    ]);
    // The box spans both patches even though the middle is not selected.
    expect(sel.rect).toEqual({ x: 0, y: 0, w: 3, h: 1 });
    expect(countCovered(sel)).toBe(2);
  });

  it('at zero tolerance takes only an exact match', () => {
    const buf = paint(['rn']);
    expect(countCovered(selectSimilar(buf, 0, 0, 0, true)!)).toBe(1);
  });

  it('widens with tolerance', () => {
    const buf = paint(['rn']);
    // near-red is 15/255 away on the red channel.
    expect(countCovered(selectSimilar(buf, 0, 0, 0.1, true)!)).toBe(2);
  });

  it('does not reach a different colour even at a generous tolerance', () => {
    const buf = paint(['rb']);
    expect(countCovered(selectSimilar(buf, 0, 0, 0.5, true)!)).toBe(1);
  });

  it('treats transparency as part of the colour', () => {
    // A transparent pixel and an opaque one are not the same, however close
    // their RGB happens to be - otherwise clicking the background swallows the
    // artwork drawn in a similar hue.
    const buf = paint(['r.']);
    expect(countCovered(selectSimilar(buf, 0, 0, 0.2, true)!)).toBe(1);
  });

  it('returns nothing for a click outside the texture', () => {
    expect(selectSimilar(paint(['r']), 5, 5, 0, false)).toBeNull();
  });

  it('selects the whole texture at full tolerance', () => {
    const buf = paint(['rb', 'bn']);
    expect(countCovered(selectSimilar(buf, 0, 0, 1, true)!)).toBe(4);
  });
});

describe('scaleMask', () => {
  it('is unchanged when the rect does not move', () => {
    const mask = new Uint8Array([1, 0, 0, 1]);
    const rect = { x: 0, y: 0, w: 2, h: 2 };
    expect(scaleMask(mask, rect, rect)).toEqual(mask);
  });

  it('nearest-neighbours a mask up, so it keeps matching its pixels', () => {
    const mask = new Uint8Array([1, 0, 0, 1]);
    const scaled = scaleMask(mask, { x: 0, y: 0, w: 2, h: 2 }, { x: 5, y: 5, w: 4, h: 4 })!;

    expect(scaled.length).toBe(16);
    expect([...scaled]).toEqual([
      1, 1, 0, 0,
      1, 1, 0, 0,
      0, 0, 1, 1,
      0, 0, 1, 1,
    ]);
  });

  it('passes a null mask through, since that means the whole box', () => {
    expect(scaleMask(null, { x: 0, y: 0, w: 2, h: 2 }, { x: 0, y: 0, w: 4, h: 4 })).toBeNull();
  });
});
