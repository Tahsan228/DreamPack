import type { AssetSlot, CanonicalResult, Candidate, Era } from './types';
import { canonicalize, companionTarget, denormalize } from './canonical';
import { getVersion, type VersionSpec } from './versions';

export interface IndexedFile {
  path: string;
  size: number;
  /** Cheap content hash; drives the "only assets that differ" filter. */
  hash: string;
  width?: number;
  height?: number;
}

export interface IndexablePack {
  id: string;
  era: Era;
  files: IndexedFile[];
}

/** The version whose spelling a pack of each era uses natively. */
const ERA_VERSION = {
  legacy: getVersion('1.8.9'),
  modern: getVersion('1.20.1'),
} as const;

/**
 * Which of a pack's several copies of one asset is that pack's answer for the slot.
 *
 * A pack covering more than one game version ships the asset under both
 * spellings — `textures/blocks/cobblestone_mossy.png` beside
 * `textures/block/mossy_cobblestone.png`. The one the pack's own version reads
 * is its real artwork; the other is there for players on the far side of the
 * Flattening. Nothing else distinguishes them, so file order decides when
 * neither matches.
 */
function choosePrimary(files: IndexedFile[], key: string, era: Era): IndexedFile {
  if (files.length === 1) return files[0];
  const native = denormalize(key, ERA_VERSION[era]);
  return files.find((f) => f.path === native) ?? files[0];
}

/**
 * Fold every pack's file list into one union of slots.
 *
 * Two packs land on the same slot when their paths canonicalise to the same key,
 * which is what lets a 1.8.9 `apple_golden.png` and a 1.20 `golden_apple.png`
 * compete for a single pick.
 *
 * Each pack contributes at most one candidate per slot. A candidate is addressed
 * by its pack everywhere downstream — picks, the candidate strip, export — so a
 * pack appearing twice in one slot produced a chip that could not be picked, a
 * preview that ignored the click, and a slot that "differed across packs"
 * because a pack differed from itself.
 */
export function buildSlotIndex(packs: IndexablePack[]): AssetSlot[] {
  const slots = new Map<string, AssetSlot>();

  for (const pack of packs) {
    // `foo.png.mcmeta` must travel with `foo.png`, so collect companions first.
    const companionsByTarget = new Map<string, string[]>();
    for (const f of pack.files) {
      const target = companionTarget(f.path);
      if (target) {
        const list = companionsByTarget.get(target);
        if (list) list.push(f.path);
        else companionsByTarget.set(target, [f.path]);
      }
    }

    // Group this pack's files by the slot they land on before making candidates,
    // so the duplicates are visible at the point the choice has to be made.
    const byKey = new Map<string, { canon: CanonicalResult; files: IndexedFile[] }>();
    for (const f of pack.files) {
      const canon = canonicalize(f.path);
      if (!canon) continue;
      const group = byKey.get(canon.key);
      if (group) group.files.push(f);
      else byKey.set(canon.key, { canon, files: [f] });
    }

    for (const [key, { canon, files }] of byKey) {
      let slot = slots.get(key);
      if (!slot) {
        slot = {
          key,
          category: canon.category,
          displayName: canon.displayName,
          unmapped: canon.unmapped,
          candidates: [],
        };
        slots.set(key, slot);
      } else if (canon.unmapped) {
        slot.unmapped = true;
      }

      const primary = choosePrimary(files, key, pack.era);
      const candidate: Candidate = {
        packId: pack.id,
        primaryPath: primary.path,
        companions: companionsByTarget.get(primary.path) ?? [],
        size: primary.size,
        hash: primary.hash,
      };
      if (primary.width !== undefined) candidate.width = primary.width;
      if (primary.height !== undefined) candidate.height = primary.height;

      const rest = files.filter((f) => f !== primary);
      if (rest.length > 0) {
        candidate.alternates = rest.map((f) => ({
          path: f.path,
          companions: companionsByTarget.get(f.path) ?? [],
        }));
      }

      slot.candidates.push(candidate);
    }
  }

  return [...slots.values()];
}

/**
 * Which pack supplies this slot: an explicit pick if there is one, otherwise the
 * highest-priority pack that actually has the asset.
 */
export function resolveSlot(
  slot: AssetSlot,
  packOrder: string[],
  picks: Record<string, string>,
): Candidate | null {
  const picked = picks[slot.key];
  if (picked) {
    const match = slot.candidates.find((c) => c.packId === picked);
    if (match) return match;
    // Pick points at a pack that has since been removed; fall through to priority.
  }

  for (const packId of packOrder) {
    const match = slot.candidates.find((c) => c.packId === packId);
    if (match) return match;
  }
  return slot.candidates[0] ?? null;
}

/**
 * A slot's candidates in priority order.
 *
 * This is the order the candidate strip renders in, and therefore the order the
 * number keys pick from - the two must not drift apart.
 */
export function orderCandidates(slot: AssetSlot, packOrder: string[]): Candidate[] {
  const rank = new Map(packOrder.map((id, i) => [id, i]));
  return [...slot.candidates].sort(
    (a, b) => (rank.get(a.packId) ?? Number.MAX_SAFE_INTEGER)
      - (rank.get(b.packId) ?? Number.MAX_SAFE_INTEGER),
  );
}

/** True when a pick was made and it is not what the priority order would have chosen. */
export function isOverridden(
  slot: AssetSlot,
  packOrder: string[],
  picks: Record<string, string>,
): boolean {
  const picked = picks[slot.key];
  if (!picked) return false;
  if (!slot.candidates.some((c) => c.packId === picked)) return false;

  for (const packId of packOrder) {
    if (slot.candidates.some((c) => c.packId === packId)) return packId !== picked;
  }
  return false;
}

/** True when at least two packs supply this asset with different bytes. */
export function differsAcrossPacks(slot: AssetSlot): boolean {
  if (slot.candidates.length < 2) return false;
  const first = slot.candidates[0].hash;
  return slot.candidates.some((c) => c.hash !== first);
}

/** Two slots whose names spell out to one file on the target version. */
export interface PathConflict {
  outPath: string;
  /** The slot the filename belongs to there. */
  kept: string;
  dropped: string;
}

/**
 * Give every slot the file it will be written to, and settle the cases where two
 * of them want the same one.
 *
 * A name with no mapping of its own can land on the filename another asset's
 * mapped spelling writes to - `stone_slab_side` beside `smooth_stone_slab_side`
 * on a 1.8.9 export. Left alone, whichever was written last won, which put a
 * texture on the wrong block with nothing said about it. The file goes to the
 * asset whose name it actually is on that version, and the other is reported.
 */
export function planExportPaths(
  keys: Iterable<string>,
  version: VersionSpec,
): { plan: Map<string, string>; conflicts: PathConflict[] } {
  const holder = new Map<string, string>();
  const conflicts: PathConflict[] = [];

  for (const key of keys) {
    const outPath = denormalize(key, version);
    if (!outPath) continue;

    const held = holder.get(outPath);
    if (held === undefined) {
      holder.set(outPath, key);
      continue;
    }

    const owner = canonicalize(outPath)?.key;
    const kept = owner === key ? key : held;
    holder.set(outPath, kept);
    conflicts.push({ outPath, kept, dropped: kept === key ? held : key });
  }

  const plan = new Map<string, string>();
  for (const [outPath, key] of holder) plan.set(key, outPath);
  return { plan, conflicts };
}

/** Final key -> winning candidate map used by the exporter. */
export function resolveAll(
  slots: AssetSlot[],
  packOrder: string[],
  picks: Record<string, string>,
): Map<string, Candidate> {
  const out = new Map<string, Candidate>();
  for (const slot of slots) {
    const winner = resolveSlot(slot, packOrder, picks);
    if (winner) out.set(slot.key, winner);
  }
  return out;
}
