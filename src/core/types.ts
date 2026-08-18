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
  /**
   * Other copies of this asset in the same pack, under a different version's
   * spelling. Packs that cover several game versions ship both; only one of them
   * is this pack's answer for the slot, and the rest are recorded here so the
   * duplicate is visible rather than silently dropped.
   */
  alternates?: Array<{ path: string; companions: string[] }>;
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
  /**
   * packId -> pack name at the time of saving.
   *
   * Ids are regenerated on every import, so without names a project became
   * unloadable the moment one of its packs was re-imported. Optional because
   * projects saved before this was recorded do not have it.
   */
  packNames?: Record<string, string>;
  packMeta: {
    description: string;
    iconFromPackId: string | null;
  };
  updatedAt: number;
}

/** Which slots the grid shows. Part of the session, so it survives a reload. */
export interface Filters {
  onlyDiffering: boolean;
  onlyOverridden: boolean;
  onlyUnmapped: boolean;
}

/**
 * The working state, saved continuously and restored on boot.
 *
 * Imported packs already survive a reload in IndexedDB; without this the work
 * done *with* them - the priority order, every pick, the target version - did
 * not, which made the app look like it had remembered when it had not.
 */
export interface SessionSnapshot {
  /** Bumped if the shape ever changes; an unknown version is ignored. */
  v: 1;
  packOrder: string[];
  picks: Record<string, string>;
  targetVersion: string;
  projectName: string;
  description: string;
  iconFromPackId: string | null;
  category: Category;
  filters: Filters;
  updatedAt: number;
}

export interface CanonicalResult {
  key: string;
  category: Category;
  displayName: string;
  unmapped: boolean;
}
