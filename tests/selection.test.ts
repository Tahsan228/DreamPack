import { describe, expect, it } from 'vitest';
import {
  clampRect, containsPoint, dragHandle, hitHandle, rectFromDrag, texelFromClient,
} from '../src/lib/selection';

describe('texelFromClient', () => {
  /**
   * The canvas is drawn on its content box but measured by its border box, and
   * the editor's canvas has a 2px border. Mapping through the border box shifts
   * every stroke and squeezes the texture into a box larger than itself - which
   * at 16x is a sixth of a texel and invisible, and at 32x and above is a whole
   * texel: strokes land on the wrong column and the outermost row and column
   * cannot be reached at all.
   */
  const box = {
    left: 100, top: 50,
    // 96px of canvas inside a 2px border on every side.
    width: 100, height: 100,
    borderLeft: 2, borderTop: 2, borderRight: 2, borderBottom: 2,
  };

  it('puts the first texel under the top-left of the drawing surface', () => {
    const point = texelFromClient(100 + 2 + 0.5, 50 + 2 + 0.5, box, 32, 32);
    expect(Math.floor(point.x)).toBe(0);
    expect(Math.floor(point.y)).toBe(0);
  });

  it('puts the last texel under the bottom-right of the drawing surface', () => {
    const point = texelFromClient(100 + 2 + 95.5, 50 + 2 + 95.5, box, 32, 32);
    expect(Math.floor(point.x)).toBe(31);
    expect(Math.floor(point.y)).toBe(31);
  });

  it('maps the middle of each texel to that texel', () => {
    const zoom = 96 / 32;
    for (let t = 0; t < 32; t++) {
      const point = texelFromClient(100 + 2 + (t + 0.5) * zoom, 50 + 2 + 1, box, 32, 32);
      expect(Math.floor(point.x), `texel ${t}`).toBe(t);
    }
  });

  it('is continuous, so an edge can be hit exactly', () => {
    // The boundary between texel 3 and 4, for the selection's handle hit-test.
    expect(texelFromClient(100 + 2 + 4 * 3, 50 + 2, box, 32, 32).x).toBeCloseTo(4, 5);
  });

  it('handles a texture that is taller than it is wide', () => {
    const strip = { ...box, height: 388, width: 100 };
    // 384px tall drawing surface, 128 texels: 3px each.
    expect(Math.floor(texelFromClient(100 + 2 + 1, 50 + 2 + 2.5 * 3, strip, 32, 128).y)).toBe(2);
    expect(Math.floor(texelFromClient(100 + 2 + 1, 50 + 2 + 383, strip, 32, 128).y)).toBe(127);
  });
});

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

  it('includes the first texel and excludes the far edge', () => {
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

  it('widens with the tolerance, so a handle stays grabbable when zoomed out', () => {
    expect(hitHandle(rect, 5.4, 8, 0.2)).toBe('inside');
    expect(hitHandle(rect, 5.4, 8, 1.5)).toBe('w');
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
