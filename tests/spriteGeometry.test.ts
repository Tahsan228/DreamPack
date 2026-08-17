import { describe, expect, it } from 'vitest';
import { buildSpriteMesh, frameCount, solidMask } from '../src/lib/spriteGeometry';

/** Vertices as [x,y,z] triples, for readable assertions. */
const verts = (positions: number[]) => {
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i < positions.length; i += 3) {
    out.push([positions[i], positions[i + 1], positions[i + 2]]);
  }
  return out;
};

const mask = (rows: string[]) => {
  const width = rows[0].length;
  const data = new Uint8Array(width * rows.length);
  rows.forEach((row, y) => {
    [...row].forEach((c, x) => {
      data[y * width + x] = c === '#' ? 1 : 0;
    });
  });
  return { data, width, height: rows.length };
};

describe('buildSpriteMesh', () => {
  it('gives a single pixel six faces', () => {
    const m = mask(['#']);
    const mesh = buildSpriteMesh(m.data, m.width, m.height, 0.25);

    // Front, back and four walls; two triangles each.
    expect(mesh.indices.length / 3).toBe(12);
    expect(mesh.positions.length / 3).toBe(24);
  });

  it('extrudes to the depth it is given', () => {
    const m = mask(['#']);
    const mesh = buildSpriteMesh(m.data, m.width, m.height, 0.25);
    const zs = verts(mesh.positions).map((v) => v[2]);

    // A flat sheet would sit entirely at z = 0; this must have real thickness.
    expect(Math.min(...zs)).toBeCloseTo(-0.125);
    expect(Math.max(...zs)).toBeCloseTo(0.125);
  });

  it('spans the unit square, so it matches the block shapes', () => {
    const m = mask(['##', '##']);
    const mesh = buildSpriteMesh(m.data, m.width, m.height, 0.0625);
    const xs = verts(mesh.positions).map((v) => v[0]);
    const ys = verts(mesh.positions).map((v) => v[1]);

    expect(Math.min(...xs)).toBeCloseTo(-0.5);
    expect(Math.max(...xs)).toBeCloseTo(0.5);
    expect(Math.min(...ys)).toBeCloseTo(-0.5);
    expect(Math.max(...ys)).toBeCloseTo(0.5);
  });

  it('emits nothing for a fully transparent sprite', () => {
    const m = mask(['..', '..']);
    expect(buildSpriteMesh(m.data, m.width, m.height, 0.0625).indices).toHaveLength(0);
  });

  /**
   * The saving that makes this affordable on a 256px texture: a solid row is one
   * quad, not one per pixel, so the front and back cost stays with the shape
   * rather than the resolution.
   */
  it('merges a run of opaque pixels into one quad per face', () => {
    const solidRow = buildSpriteMesh(mask(['####']).data, 4, 1, 0.0625);
    const gappedRow = buildSpriteMesh(mask(['##.#']).data, 4, 1, 0.0625);

    // Two front/back quads for the unbroken row, four for the split one.
    const frontBackQuads = (mesh: { normals: number[] }) => {
      let n = 0;
      for (let i = 0; i < mesh.normals.length; i += 3) {
        if (Math.abs(mesh.normals[i + 2]) === 1) n++;
      }
      return n / 4;
    };

    expect(frontBackQuads(solidRow)).toBe(2);
    expect(frontBackQuads(gappedRow)).toBe(4);
  });

  it('walls off a hole in the middle of the sprite', () => {
    const withHole = buildSpriteMesh(mask(['###', '#.#', '###']).data, 3, 3, 0.0625);
    const filled = buildSpriteMesh(mask(['###', '###', '###']).data, 3, 3, 0.0625);

    // The hole's four inner edges each need a wall the filled version does not.
    const sideQuads = (mesh: { normals: number[] }) => {
      let n = 0;
      for (let i = 0; i < mesh.normals.length; i += 3) {
        if (Math.abs(mesh.normals[i + 2]) !== 1) n++;
      }
      return n / 4;
    };

    expect(sideQuads(withHole) - sideQuads(filled)).toBe(4);
  });

  it('keeps uvs inside the texture', () => {
    const m = mask(['#.#', '.#.']);
    const mesh = buildSpriteMesh(m.data, m.width, m.height, 0.0625);
    for (const uv of mesh.uvs) {
      expect(uv).toBeGreaterThanOrEqual(0);
      expect(uv).toBeLessThanOrEqual(1);
    }
  });

  it('survives a mask smaller than its declared size', () => {
    expect(buildSpriteMesh(new Uint8Array(2), 4, 4, 0.0625).indices).toHaveLength(0);
  });
});

describe('solidMask', () => {
  it('marks pixels opaque by their alpha channel', () => {
    // Two pixels: one opaque, one clear.
    const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 0]);
    expect([...solidMask(data, 2, 1)]).toEqual([1, 0]);
  });

  it('treats nearly transparent pixels as holes', () => {
    const data = new Uint8ClampedArray([255, 0, 0, 4, 255, 0, 0, 200]);
    expect([...solidMask(data, 2, 1)]).toEqual([0, 1]);
  });
});

describe('frameCount', () => {
  it('reads a filmstrip height as whole frames', () => {
    expect(frameCount(16, 64)).toBe(4);
    expect(frameCount(16, 16)).toBe(1);
  });

  it('treats a wide or ragged texture as a single frame', () => {
    expect(frameCount(64, 16)).toBe(1);
    expect(frameCount(0, 16)).toBe(1);
  });
});
