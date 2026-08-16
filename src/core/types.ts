/** Shared vocabulary for the whole app. Kept dependency-free so workers and tests can import it. */

export type Category =
  | 'Items'
  | 'Blocks'
  | 'GUI'
  | 'Armor'
  | 'Entities'
  | 'Particles'
  | 'Environment'
  | 'Sounds'
  | 'CIT'
  | 'Models'
  | 'Other';

export const CATEGORIES: Category[] = [
  'Items',
  'Blocks',
  'GUI',
  'Armor',
  'Entities',
  'Particles',
  'Environment',
  'Sounds',
  'CIT',
  'Models',
  'Other',
];

/**
 * Which side of the 1.13 "Flattening" a pack sits on.
 * `legacy`  = 1.12.2 and below: textures/items/, textures/blocks/, pre-registry names
 * `modern`  = 1.13+:            textures/item/,  textures/block/,  registry names
 */
export type Era = 'legacy' | 'modern';

export interface ImportedPack {
  id: string;
  /** Filename of the imported zip, minus extension. */
  name: string;
  /** `description` from pack.mcmeta, if present. */
  description: string;
  packFormat: number | null;
  era: Era;
  /** pack.png as a data URL, small enough to keep in metadata. */
  iconDataUrl: string | null;
  fileCount: number;
  bytes: number;
  importedAt: number;
  /** Stable colour used for this pack's pip in the grid. */
  color: string;
}

/** One physical file kept from a pack. Blob lives in IndexedDB. */
export interface PackFileMeta {
  packId: string;
  path: string;
  size: number;
  width?: number;
  height?: number;
}

export interface Candidate {
  packId: string;
  /** The path exactly as it appears inside that pack. */
  primaryPath: string;
  /** Sibling files that must travel with the primary (.mcmeta, model json, ...). */
  companions: string[];
  size: number;
  width?: number;
  height?: number;
  /** Hash of file bytes, used by the "only differing" filter. */
  hash: string;
}

/** A version-independent thing you can pick a source for. */
export interface AssetSlot {
  key: string;
  category: Category;
  displayName: string;
  /** True when the basename was not found in the rename table. */
  unmapped: boolean;
  candidates: Candidate[];
}

export interface Project {
  id: string;
  name: string;
  targetVersion: string;
  /** Priority order; index 0 wins ties. */
  packOrder: string[];
  /** Explicit per-slot overrides: canonical key -> packId. */
  picks: Record<string, string>;
  packMeta: {
    description: string;
    iconFromPackId: string | null;
  };
  updatedAt: number;
}

export interface CanonicalResult {
  key: string;
  category: Category;
  displayName: string;
  unmapped: boolean;
}
