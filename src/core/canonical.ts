import type { Category, CanonicalResult, Era } from './types';
import type { VersionSpec } from './versions';
import {
  BLOCK_ALIASES,
  BLOCK_LEGACY_TO_MODERN,
  BLOCK_MODERN_TO_LEGACY,
  ITEM_ALIASES,
  ITEM_LEGACY_TO_MODERN,
  ITEM_MODERN_TO_LEGACY,
} from '../data/flattening';

/**
 * Canonical keys look like:
 *   texture:item/golden_apple
 *   texture:block/red_wool
 *   texture:gui/icons
 *   sound:random/click
 *   cit:my_sword
 *   model:item/diamond_sword
 *   other:shaders/post/blur.json
 *
 * Non-`minecraft` namespaces are marked with a leading `@`:
 *   texture:@mypack/item/thing
 */
export type Kind = 'texture' | 'sound' | 'model' | 'cit' | 'other';

/** File extensions worth keeping out of an imported pack. */
export const KEPT_EXTENSIONS = [
  '.png', '.mcmeta', '.json', '.properties', '.ogg', '.txt', '.fsh', '.vsh', '.lang', '.bin',
];

const EXT_BY_KIND: Record<Kind, string> = {
  texture: '.png',
  sound: '.ogg',
  model: '.json',
  cit: '.properties',
  other: '',
};

export function isCompanionPath(path: string): boolean {
  return path.endsWith('.mcmeta') && !path.endsWith('pack.mcmeta');
}

/** `foo.png.mcmeta` -> `foo.png`. Returns null when the path is not a companion. */
export function companionTarget(path: string): string | null {
  if (!isCompanionPath(path)) return null;
  return path.slice(0, -'.mcmeta'.length);
}

interface SplitPath {
  namespace: string;
  rest: string;
}

/** `assets/minecraft/textures/items/apple.png` -> { namespace, rest: 'textures/items/apple.png' } */
function splitAssetPath(path: string): SplitPath | null {
  const parts = path.split('/').filter(Boolean);
  if (parts.length < 3 || parts[0] !== 'assets') return null;
  return { namespace: parts[1], rest: parts.slice(2).join('/') };
}

function stripExt(name: string): string {
  const i = name.lastIndexOf('.');
  return i === -1 ? name : name.slice(0, i);
}

function nsPrefix(namespace: string): string {
  return namespace === 'minecraft' ? '' : `@${namespace}/`;
}

/** `golden_apple` -> `Golden Apple`; `bow_pulling_0` -> `Bow Pulling 0`. */
export function humanize(name: string): string {
  const last = name.split('/').pop() ?? name;
  return last
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Fold a texture basename to its modern registry name.
 *
 * `unmapped` marks names with no cross-era counterpart at all. Those still merge
 * fine between packs of the same era — they just cannot be renamed if the export
 * target sits on the other side of the Flattening, so the UI flags them.
 */
function mapName(
  name: string,
  era: Era,
  forward: Readonly<Record<string, string>>,
  aliases: Readonly<Record<string, string>>,
  reverse: Readonly<Record<string, string>>,
): { name: string; unmapped: boolean } {
  if (name.includes('/')) return { name, unmapped: false };

  if (era === 'legacy') {
    const modern = forward[name] ?? aliases[name];
    if (modern) return { name: modern, unmapped: false };
    // Already-modern spellings (diamond_helmet, obsidian) are correct as-is.
    return { name, unmapped: !(name in reverse) };
  }

  return { name, unmapped: !(name in reverse) && !(name in forward) };
}

const mapItemName = (name: string, era: Era) =>
  mapName(name, era, ITEM_LEGACY_TO_MODERN, ITEM_ALIASES, ITEM_MODERN_TO_LEGACY);

const mapBlockName = (name: string, era: Era) =>
  mapName(name, era, BLOCK_LEGACY_TO_MODERN, BLOCK_ALIASES, BLOCK_MODERN_TO_LEGACY);

/**
 * Turn a pack-relative file path into a version-independent slot identity.
 * Returns null for files that are not pickable assets (pack.mcmeta, companions,
 * directory entries, unknown junk).
 */
export function canonicalize(path: string, era: Era): CanonicalResult | null {
  const clean = path.replace(/\\/g, '/').replace(/^\.?\//, '');
  if (clean.endsWith('/')) return null;
  if (clean === 'pack.mcmeta' || clean === 'pack.png') return null;
  if (isCompanionPath(clean)) return null;

  const split = splitAssetPath(clean);
  if (!split) return null;

  const { namespace } = split;
  // Very old packs put Optifine config under `mcpatcher/`. Fold both spellings
  // together so a CIT rule and the textures it references stay in one directory.
  const rest = split.rest.replace(/^mcpatcher\//, 'optifine/');
  const ns = nsPrefix(namespace);

  // sounds.json is merged across packs rather than picked, so it is not a slot.
  if (rest === 'sounds.json') return null;

  // --- Optifine custom item textures -------------------------------------
  const citMatch = rest.match(/^optifine\/cit\/(.+)\.properties$/);
  if (citMatch) {
    const sub = citMatch[1];
    return {
      key: `cit:${ns}${sub}`,
      category: 'CIT',
      displayName: humanize(sub),
      unmapped: false,
    };
  }

  // --- Sounds -------------------------------------------------------------
  if (rest.startsWith('sounds/') && rest.endsWith('.ogg')) {
    const sub = stripExt(rest.slice('sounds/'.length));
    return {
      key: `sound:${ns}${sub}`,
      category: 'Sounds',
      displayName: humanize(sub),
      unmapped: false,
    };
  }

  // --- Models -------------------------------------------------------------
  if (rest.startsWith('models/') && rest.endsWith('.json')) {
    const sub = stripExt(rest.slice('models/'.length));
    return {
      key: `model:${ns}${sub}`,
      category: 'Models',
      displayName: humanize(sub),
      unmapped: false,
    };
  }

  // --- Textures -----------------------------------------------------------
  if (rest.startsWith('textures/') && rest.endsWith('.png')) {
    const sub = stripExt(rest.slice('textures/'.length));
    const slash = sub.indexOf('/');
    const dir = slash === -1 ? '' : sub.slice(0, slash);
    const tail = slash === -1 ? sub : sub.slice(slash + 1);

    if (dir === 'items' || dir === 'item') {
      const { name, unmapped } = mapItemName(tail, era);
      return { key: `texture:${ns}item/${name}`, category: 'Items', displayName: humanize(name), unmapped };
    }
    if (dir === 'blocks' || dir === 'block') {
      const { name, unmapped } = mapBlockName(tail, era);
      return { key: `texture:${ns}block/${name}`, category: 'Blocks', displayName: humanize(name), unmapped };
    }

    // Paths outside item/block are stable across the Flattening, so they pass
    // through untouched and just need a category.
    let category: Category = 'Other';
    if (dir === 'gui') category = 'GUI';
    else if (sub.startsWith('models/armor/')) category = 'Armor';
    else if (dir === 'entity') category = 'Entities';
    else if (dir === 'particle') category = 'Particles';
    else if (dir === 'environment') category = 'Environment';

    return { key: `texture:${ns}${sub}`, category, displayName: humanize(sub), unmapped: false };
  }

  // --- Everything else we chose to keep ------------------------------------
  if (KEPT_EXTENSIONS.some((e) => rest.endsWith(e))) {
    return {
      key: `other:${ns}${rest}`,
      category: 'Other',
      displayName: rest.split('/').pop() ?? rest,
      unmapped: false,
    };
  }

  return null;
}

interface ParsedKey {
  kind: Kind;
  namespace: string;
  sub: string;
}

export function parseKey(key: string): ParsedKey | null {
  const colon = key.indexOf(':');
  if (colon === -1) return null;
  const kind = key.slice(0, colon) as Kind;
  if (!(kind in EXT_BY_KIND)) return null;

  let body = key.slice(colon + 1);
  let namespace = 'minecraft';
  if (body.startsWith('@')) {
    const slash = body.indexOf('/');
    if (slash === -1) return null;
    namespace = body.slice(1, slash);
    body = body.slice(slash + 1);
  }
  return { kind, namespace, sub: body };
}

/**
 * The inverse of {@link canonicalize}: where this asset must be written for a
 * given target version.
 */
export function denormalize(key: string, version: VersionSpec): string | null {
  const parsed = parseKey(key);
  if (!parsed) return null;
  const { kind, namespace, sub } = parsed;
  const base = `assets/${namespace}`;

  switch (kind) {
    case 'cit':
      return `${base}/${version.optifineDir}/cit/${sub}.properties`;
    case 'sound':
      return `${base}/sounds/${sub}.ogg`;
    case 'model':
      return `${base}/models/${sub}.json`;
    case 'other':
      return `${base}/${sub}`;
    case 'texture': {
      const slash = sub.indexOf('/');
      const dir = slash === -1 ? '' : sub.slice(0, slash);
      const tail = slash === -1 ? sub : sub.slice(slash + 1);

      if (dir === 'item') {
        const name =
          version.era === 'legacy' && !tail.includes('/')
            ? ITEM_MODERN_TO_LEGACY[tail] ?? tail
            : tail;
        return `${base}/textures/${version.itemDir}/${name}.png`;
      }
      if (dir === 'block') {
        const name =
          version.era === 'legacy' && !tail.includes('/')
            ? BLOCK_MODERN_TO_LEGACY[tail] ?? tail
            : tail;
        return `${base}/textures/${version.blockDir}/${name}.png`;
      }
      return `${base}/textures/${sub}.png`;
    }
  }
}
