import { describe, expect, it } from 'vitest';
import { unzipSync, zipSync } from 'fflate';
import { findRootPrefix, parsePackMeta, pngSize, readPackEntries, shouldKeep } from '../src/core/packRead';
import { buildSlotIndex, resolveAll } from '../src/core/resolve';
import { denormalize } from '../src/core/canonical';
import { getVersion } from '../src/core/versions';

const encoder = new TextEncoder();

/**
 * A minimal valid PNG of the given size, built by hand so no Minecraft artwork
 * is needed. Only the signature and IHDR matter here — nothing decodes it.
 */
function fakePng(width: number, height: number, tint: number): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13); // IHDR length
  bytes.set(encoder.encode('IHDR'), 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes[24] = 8; // bit depth
  bytes[25] = 6; // RGBA
  bytes[29] = tint; // makes each pack's bytes differ
  return bytes;
}

const mcmeta = (packFormat: number, description: string) =>
  encoder.encode(JSON.stringify({ pack: { pack_format: packFormat, description } }));

/** A 1.8.9-style pack, optionally nested inside a wrapper folder. */
function legacyPackZip(tint: number, wrapper = ''): Uint8Array {
  return zipSync({
    [`${wrapper}pack.mcmeta`]: mcmeta(1, '§aTest §fPack'),
    [`${wrapper}pack.png`]: fakePng(64, 64, tint),
    [`${wrapper}assets/minecraft/textures/items/diamond_sword.png`]: fakePng(16, 16, tint),
    [`${wrapper}assets/minecraft/textures/items/apple_golden.png`]: fakePng(16, 16, tint),
    [`${wrapper}assets/minecraft/textures/blocks/wool_colored_red.png`]: fakePng(16, 16, tint),
    [`${wrapper}assets/minecraft/textures/blocks/water_still.png`]: fakePng(16, 512, tint),
    [`${wrapper}assets/minecraft/textures/blocks/water_still.png.mcmeta`]: encoder.encode(
      JSON.stringify({ animation: { frametime: 2 } }),
    ),
    [`${wrapper}assets/minecraft/textures/gui/icons.png`]: fakePng(256, 256, tint),
    [`${wrapper}assets/minecraft/sounds/random/click.ogg`]: new Uint8Array([1, 2, 3, tint]),
    [`${wrapper}README.md`]: encoder.encode('ignore me'),
    [`${wrapper}__MACOSX/._pack.png`]: encoder.encode('junk'),
  });
}

/** A 1.20-style pack using post-Flattening names. */
function modernPackZip(tint: number): Uint8Array {
  return zipSync({
    'pack.mcmeta': mcmeta(15, 'Modern Pack'),
    'assets/minecraft/textures/item/diamond_sword.png': fakePng(32, 32, tint),
    'assets/minecraft/textures/item/golden_apple.png': fakePng(32, 32, tint),
    'assets/minecraft/textures/block/red_wool.png': fakePng(32, 32, tint),
  });
}

const readZip = (zipBytes: Uint8Array) =>
  readPackEntries(unzipSync(zipBytes, { filter: (f) => shouldKeep(f.name) }));

describe('pack reading', () => {
  it('detects a 1.8.9 pack and keeps only pack files', () => {
    const pack = readZip(legacyPackZip(1));

    expect(pack.era).toBe('legacy');
    expect(pack.meta.packFormat).toBe(1);
    expect(pack.meta.description).toBe('Test Pack'); // colour codes stripped
    expect(pack.packPng).not.toBeNull();

    const paths = pack.index.map((f) => f.path);
    expect(paths).not.toContain('README.md');
    expect(paths.some((p) => p.includes('__MACOSX'))).toBe(false);
  });

  it('detects a modern pack', () => {
    const pack = readZip(modernPackZip(1));
    expect(pack.era).toBe('modern');
    expect(pack.meta.packFormat).toBe(15);
  });

  it('strips a wrapper folder so paths come out pack-relative', () => {
    const pack = readZip(legacyPackZip(1, 'MyCoolPack/'));
    expect(pack.index.map((f) => f.path)).toContain(
      'assets/minecraft/textures/items/diamond_sword.png',
    );
    expect(pack.meta.packFormat).toBe(1);
  });

  it('reads PNG dimensions without decoding', () => {
    expect(pngSize(fakePng(16, 512, 0))).toEqual({ width: 16, height: 512 });
    expect(pngSize(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it('survives a malformed pack.mcmeta', () => {
    expect(parsePackMeta(encoder.encode('{not json'))).toEqual({
      description: '',
      packFormat: null,
    });
  });

  it('reads a description given as a component array', () => {
    const bytes = encoder.encode(
      JSON.stringify({ pack: { pack_format: 1, description: [{ text: 'Hello ' }, 'world'] } }),
    );
    expect(parsePackMeta(bytes).description).toBe('Hello world');
  });
});

describe('findRootPrefix', () => {
  it('finds the wrapper folder from pack.mcmeta', () => {
    expect(findRootPrefix(['Cool/pack.mcmeta', 'Cool/assets/minecraft/x.png'])).toBe('Cool/');
  });

  it('falls back to the assets directory when pack.mcmeta is absent', () => {
    expect(findRootPrefix(['Cool/assets/minecraft/x.png'])).toBe('Cool/');
  });

  it('returns nothing for an already-flat pack', () => {
    expect(findRootPrefix(['pack.mcmeta', 'assets/minecraft/x.png'])).toBe('');
  });
});

describe('two packs through the full pipeline', () => {
  const a = readZip(legacyPackZip(1));
  const b = readZip(legacyPackZip(2));
  const slots = buildSlotIndex([
    { id: 'a', era: a.era, files: a.index },
    { id: 'b', era: b.era, files: b.index },
  ]);
  const v189 = getVersion('1.8.9');

  it('lands both packs on the same slots', () => {
    const sword = slots.find((s) => s.key === 'texture:item/diamond_sword');
    expect(sword?.candidates).toHaveLength(2);
    expect(sword?.category).toBe('Items');
  });

  it('carries the animation .mcmeta as a companion', () => {
    const water = slots.find((s) => s.key === 'texture:block/water_still');
    expect(water?.candidates[0].companions).toEqual([
      'assets/minecraft/textures/blocks/water_still.png.mcmeta',
    ]);
    expect(water?.candidates[0].height).toBe(512);
  });

  it('exports "pack A, but the sword from pack B" to the right 1.8.9 paths', () => {
    const resolved = resolveAll(slots, ['a', 'b'], { 'texture:item/diamond_sword': 'b' });

    const out = new Map<string, string>();
    for (const [key, candidate] of resolved) {
      const path = denormalize(key, v189);
      if (path) out.set(path, candidate.packId);
    }

    // The pick wins; everything else follows the priority order.
    expect(out.get('assets/minecraft/textures/items/diamond_sword.png')).toBe('b');
    expect(out.get('assets/minecraft/textures/items/apple_golden.png')).toBe('a');
    expect(out.get('assets/minecraft/textures/blocks/wool_colored_red.png')).toBe('a');
    expect(out.get('assets/minecraft/textures/gui/icons.png')).toBe('a');
    expect(out.get('assets/minecraft/sounds/random/click.ogg')).toBe('a');
  });
});

describe('mixing a modern pack into a 1.8.9 export', () => {
  const legacy = readZip(legacyPackZip(1));
  const modern = readZip(modernPackZip(9));
  const slots = buildSlotIndex([
    { id: 'old', era: legacy.era, files: legacy.index },
    { id: 'new', era: modern.era, files: modern.index },
  ]);

  it('matches the two eras onto shared slots', () => {
    const apple = slots.find((s) => s.key === 'texture:item/golden_apple');
    expect(apple?.candidates.map((c) => c.packId)).toEqual(['old', 'new']);
  });

  it('writes a texture picked from the modern pack under its 1.8.9 filename', () => {
    const resolved = resolveAll(slots, ['old', 'new'], { 'texture:item/golden_apple': 'new' });
    const winner = resolved.get('texture:item/golden_apple');

    expect(winner?.packId).toBe('new');
    expect(winner?.primaryPath).toBe('assets/minecraft/textures/item/golden_apple.png');
    expect(denormalize('texture:item/golden_apple', getVersion('1.8.9')))
      .toBe('assets/minecraft/textures/items/apple_golden.png');
  });

  it('writes the same pick under its modern filename for a 1.20 export', () => {
    expect(denormalize('texture:item/golden_apple', getVersion('1.20.1')))
      .toBe('assets/minecraft/textures/item/golden_apple.png');
  });
});
