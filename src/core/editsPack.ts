import { denormalize } from './canonical';
import { getVersion } from './versions';
import type { ImportedPack } from './types';

/**
 * Textures you paint in the editor live in a synthetic pack.
 *
 * Treating edits as just another pack means the resolve and export pipelines
 * need no special case: an edit is a candidate like any other, and saving one
 * simply pins that slot's pick to this pack.
 *
 * Files are stored under *modern* canonical paths regardless of the export
 * target, so `canonicalize(path, 'modern')` round-trips back to the exact key
 * the edit was made for. Export then renames it for whatever version is chosen.
 */
export const EDITS_PACK_ID = '__dreampack_edits__';

const STORAGE_VERSION = getVersion('1.20.1');

export function isEditsPack(packId: string): boolean {
  return packId === EDITS_PACK_ID;
}

/** Where an edit for this slot is stored inside the edits pack. */
export function editStoragePath(key: string): string | null {
  return denormalize(key, STORAGE_VERSION);
}

export function createEditsPack(): ImportedPack {
  return {
    id: EDITS_PACK_ID,
    name: 'My Edits',
    description: 'Textures painted in DreamPack',
    packFormat: STORAGE_VERSION.packFormat,
    era: STORAGE_VERSION.era,
    iconDataUrl: null,
    fileCount: 0,
    bytes: 0,
    importedAt: Date.now(),
    color: '#FFAA00',
  };
}
