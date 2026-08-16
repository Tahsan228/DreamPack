/**
 * Turn a sprite into a solid mesh.
 *
 * Minecraft does not draw a held item as a flat picture: it extrudes the sprite,
 * so the silhouette gets real thickness and every edge where the art meets
 * transparency becomes a visible wall. A bucket seen edge-on is a slab of metal,
 * not a sheet of paper.
 *
 * The mesh is built from the alpha channel:
 *
 *   - front and back faces are emitted per horizontal run of opaque pixels, so
 *     the silhouette is exact without costing a quad per pixel
 *   - a side wall is emitted wherever an opaque pixel touches a transparent one,
 *     which scales with the perimeter rather than the area and stays cheap even
 *     for a 256px texture
 *
 * Kept free of three.js so it can be tested in node.
 */

export interface MeshArrays {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}

type Vec3 = [number, number, number];

/**
 * The sprite occupies a 1x1 square centred on the origin, matching the unit cube
 * the block shapes use, and is `depth` thick along z.
 */
export function buildSpriteMesh(
  solid: Uint8Array,
  width: number,
  height: number,
  depth: number,
): MeshArrays {
  const out: MeshArrays = { positions: [], normals: [], uvs: [], indices: [] };
  if (width <= 0 || height <= 0 || solid.length < width * height) return out;

  const at = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && solid[y * width + x] !== 0;

  const half = depth / 2;
  // Pixel column x spans [x0(x), x0(x+1)]; row y spans [y0(y+1), y0(y)] because
  // image rows run downwards while the mesh's y axis runs up.
  const px = (x: number) => -0.5 + x / width;
  const py = (y: number) => 0.5 - y / height;
  // Texture v is flipped for the same reason.
  const uOf = (x: number) => x / width;
  const vOf = (y: number) => 1 - y / height;

  /** Append a quad as two triangles, a->b->c->d counter-clockwise from outside. */
  const quad = (a: Vec3, b: Vec3, c: Vec3, d: Vec3, n: Vec3, uv: number[]) => {
    const base = out.positions.length / 3;
    for (const v of [a, b, c, d]) out.positions.push(v[0], v[1], v[2]);
    for (let i = 0; i < 4; i++) out.normals.push(n[0], n[1], n[2]);
    out.uvs.push(...uv);
    out.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };

  for (let y = 0; y < height; y++) {
    const top = py(y);
    const bottom = py(y + 1);
    const vTop = vOf(y);
    const vBottom = vOf(y + 1);

    // ---- Front and back, one quad per run of opaque pixels ----------------
    let runStart = -1;
    for (let x = 0; x <= width; x++) {
      const on = x < width && at(x, y);
      if (on && runStart === -1) runStart = x;
      if (!on && runStart !== -1) {
        const left = px(runStart);
        const right = px(x);
        const uLeft = uOf(runStart);
        const uRight = uOf(x);

        quad(
          [left, bottom, half], [right, bottom, half], [right, top, half], [left, top, half],
          [0, 0, 1],
          [uLeft, vBottom, uRight, vBottom, uRight, vTop, uLeft, vTop],
        );
        // Wound the other way round so it faces -z.
        quad(
          [right, bottom, -half], [left, bottom, -half], [left, top, -half], [right, top, -half],
          [0, 0, -1],
          [uRight, vBottom, uLeft, vBottom, uLeft, vTop, uRight, vTop],
        );
        runStart = -1;
      }
    }

    // ---- Side walls, wherever an opaque pixel meets a transparent one ------
    for (let x = 0; x < width; x++) {
      if (!at(x, y)) continue;

      const left = px(x);
      const right = px(x + 1);
      // A wall is a single colour: sample the middle of the pixel it belongs to.
      const u = uOf(x + 0.5);
      const v = vOf(y + 0.5);
      const flat = [u, v, u, v, u, v, u, v];

      if (!at(x - 1, y)) {
        quad(
          [left, bottom, -half], [left, bottom, half], [left, top, half], [left, top, -half],
          [-1, 0, 0], flat,
        );
      }
      if (!at(x + 1, y)) {
        quad(
          [right, bottom, half], [right, bottom, -half], [right, top, -half], [right, top, half],
          [1, 0, 0], flat,
        );
      }
      if (!at(x, y - 1)) {
        quad(
          [left, top, half], [right, top, half], [right, top, -half], [left, top, -half],
          [0, 1, 0], flat,
        );
      }
      if (!at(x, y + 1)) {
        quad(
          [left, bottom, -half], [right, bottom, -half], [right, bottom, half], [left, bottom, half],
          [0, -1, 0], flat,
        );
      }
    }
  }

  return out;
}

/**
 * Opacity mask for the first frame of a texture.
 *
 * Animated textures are vertical filmstrips, so only the top frame describes the
 * shape - the rest are the same silhouette in other colours.
 */
export function solidMask(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  threshold = 8,
): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    mask[i] = data[i * 4 + 3] >= threshold ? 1 : 0;
  }
  return mask;
}

/** How many square frames a filmstrip holds. 1 for a still texture. */
export function frameCount(width: number, height: number): number {
  if (width <= 0 || height < width) return 1;
  return Math.max(1, Math.floor(height / width));
}
