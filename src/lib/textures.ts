/**
 * Procedurally generated surface textures.
 *
 * Minecraft's GUI is never flat — widgets.png and the dirt background both carry
 * per-pixel noise, which is most of why a plain CSS gradient reads as "not
 * Minecraft". These build the same kind of grain at runtime, so nothing has to
 * ship Mojang artwork.
 */

/** Deterministic value noise, so tiles are stable between renders. */
function hashNoise(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return (h >>> 24) / 255;
}

function paint(
  size: number,
  shade: (n: number, x: number, y: number) => [number, number, number],
): string {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b] = shade(hashNoise(x, y), x, y);
      const i = (y * size + x) * 4;
      image.data[i] = r;
      image.data[i + 1] = g;
      image.data[i + 2] = b;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

/** The dirt menu background. */
export function dirtTile(): string {
  return paint(16, (n) => [92 + n * 44, 68 + n * 34, 44 + n * 24]);
}

/**
 * Neutral grain, blended over buttons and panels with `soft-light` so it only
 * perturbs their existing colour. Kept close to mid-grey so it darkens and
 * lightens by roughly equal amounts.
 */
export function grainTile(): string {
  return paint(16, (n) => {
    // Just enough swing to break up a flat fill. Wider than about +/-20 and
    // soft-light turns it into visible static rather than surface texture.
    const v = 112 + n * 34;
    return [v, v, v];
  });
}

let installed = false;

/** Publish the tiles as CSS variables so stylesheets can use them directly. */
export function installTextures(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;

  const root = document.documentElement;
  const grain = grainTile();
  const dirt = dirtTile();
  if (grain) root.style.setProperty('--mc-grain', `url(${grain})`);
  if (dirt) root.style.setProperty('--mc-dirt', `url(${dirt})`);
}
