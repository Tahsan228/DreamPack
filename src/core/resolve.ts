import type { AssetSlot, Candidate, Era } from './types';
import { canonicalize, companionTarget } from './canonical';

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

/**
 * Fold every pack's file list into one union of slots.
 *
 * Two packs land on the same slot when their paths canonicalise to the same key,
 * which is what lets a 1.8.9 `apple_golden.png` and a 1.20 `golden_apple.png`
 * compete for a single pick.
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

    for (const f of pack.files) {
      const canon = canonicalize(f.path, pack.era);
      if (!canon) continue;

      let slot = slots.get(canon.key);
      if (!slot) {
        slot = {
          key: canon.key,
          category: canon.category,
          displayName: canon.displayName,
          unmapped: canon.unmapped,
          candidates: [],
        };
        slots.set(canon.key, slot);
      } else if (canon.unmapped) {
        slot.unmapped = true;
      }

      const candidate: Candidate = {
        packId: pack.id,
        primaryPath: f.path,
        companions: companionsByTarget.get(f.path) ?? [],
        size: f.size,
        hash: f.hash,
      };
      if (f.width !== undefined) candidate.width = f.width;
      if (f.height !== undefined) candidate.height = f.height;

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
