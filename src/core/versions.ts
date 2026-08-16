import type { Era } from './types';

/**
 * Single source of truth for per-version pack behaviour.
 *
 * `packFormat` is what gets written into pack.mcmeta. Mojang bumps this on
 * almost every release now; only the versions people actually build packs for
 * are listed. If a number ever needs correcting, this is the only place to touch.
 */
export interface VersionSpec {
  id: string;
  label: string;
  packFormat: number;
  era: Era;
  /** Directory segment for item textures: 'items' pre-1.13, 'item' after. */
  itemDir: 'items' | 'item';
  blockDir: 'blocks' | 'block';
  /** Optifine looked in mcpatcher/ on very old versions; optifine/ works on all of them. */
  optifineDir: string;
}

export const VERSIONS: VersionSpec[] = [
  {
    id: '1.8.9',
    label: '1.8.9',
    packFormat: 1,
    era: 'legacy',
    itemDir: 'items',
    blockDir: 'blocks',
    optifineDir: 'optifine',
  },
  {
    id: '1.12.2',
    label: '1.12.2',
    packFormat: 3,
    era: 'legacy',
    itemDir: 'items',
    blockDir: 'blocks',
    optifineDir: 'optifine',
  },
  {
    id: '1.16.5',
    label: '1.16.5',
    packFormat: 6,
    era: 'modern',
    itemDir: 'item',
    blockDir: 'block',
    optifineDir: 'optifine',
  },
  {
    id: '1.20.1',
    label: '1.20.1',
    packFormat: 15,
    era: 'modern',
    itemDir: 'item',
    blockDir: 'block',
    optifineDir: 'optifine',
  },
  {
    id: '1.21.4',
    label: '1.21.4',
    packFormat: 46,
    era: 'modern',
    itemDir: 'item',
    blockDir: 'block',
    optifineDir: 'optifine',
  },
];

export const DEFAULT_VERSION = '1.8.9';

export function getVersion(id: string): VersionSpec {
  return VERSIONS.find((v) => v.id === id) ?? VERSIONS[0];
}

/**
 * Guess which era a pack was built for.
 *
 * pack_format is the strong signal, but plenty of packs ship a wrong or missing
 * one, so directory layout gets the final say when the two disagree — the
 * filenames are what actually matter for merging.
 */
export function detectEra(packFormat: number | null, paths: string[]): Era {
  let legacyHits = 0;
  let modernHits = 0;

  for (const p of paths) {
    if (p.includes('/textures/items/') || p.includes('/textures/blocks/')) legacyHits++;
    else if (p.includes('/textures/item/') || p.includes('/textures/block/')) modernHits++;
    // Cheap early exit: once one side is clearly ahead the answer will not change.
    if (legacyHits + modernHits > 400) break;
  }

  if (legacyHits > modernHits * 2) return 'legacy';
  if (modernHits > legacyHits * 2) return 'modern';
  if (packFormat !== null) return packFormat <= 3 ? 'legacy' : 'modern';
  return legacyHits >= modernHits ? 'legacy' : 'modern';
}
