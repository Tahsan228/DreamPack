import type { Filters, SessionSnapshot } from '../core/types';
import * as db from '../db/idb';

/**
 * Persistence for the working session.
 *
 * Packs live in IndexedDB and always survived a reload; the choices made about
 * them did not. This module keeps a single snapshot of those choices in step
 * with the store, and reconciles it back against whatever packs actually exist
 * when it is restored.
 */

/** Writes are debounced: picking runs in bursts, and each one is a whole record. */
const WRITE_DELAY_MS = 400;

let timer: ReturnType<typeof setTimeout> | null = null;
let queued: SessionSnapshot | null = null;
let inflight: Promise<void> = Promise.resolve();

export interface SessionState {
  packOrder: string[];
  picks: Record<string, string>;
  targetVersion: string;
  projectName: string;
  description: string;
  iconFromPackId: string | null;
  category: SessionSnapshot['category'];
  filters: Filters;
}

export function snapshot(state: SessionState): SessionSnapshot {
  return {
    v: 1,
    packOrder: state.packOrder,
    picks: state.picks,
    targetVersion: state.targetVersion,
    projectName: state.projectName,
    description: state.description,
    iconFromPackId: state.iconFromPackId,
    category: state.category,
    filters: state.filters,
    updatedAt: Date.now(),
  };
}

/** Queue a write, collapsing everything that arrives within the delay window. */
export function saveSession(state: SessionState): void {
  queued = snapshot(state);
  if (timer !== null) return;
  timer = setTimeout(() => {
    timer = null;
    const pending = queued;
    queued = null;
    if (pending) inflight = db.writeSession(pending).catch(() => {});
  }, WRITE_DELAY_MS);
}

/** Write anything queued immediately. Used by tests and by beforeunload. */
export async function flushSession(): Promise<void> {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  const pending = queued;
  queued = null;
  if (pending) inflight = db.writeSession(pending).catch(() => {});
  await inflight;
}

export async function loadSession(): Promise<SessionSnapshot | null> {
  try {
    const stored = await db.readSession();
    return stored?.v === 1 ? stored : null;
  } catch {
    // A refused or corrupt database should cost the session, not the boot.
    return null;
  }
}

export interface SavedPackRef {
  id: string;
  /** Absent in projects saved before names were recorded. */
  name?: string;
}

export interface RestoredPicks {
  packOrder: string[];
  picks: Record<string, string>;
  /** Saved pack id -> the id it corresponds to here. */
  remap: Map<string, string>;
  /** Packs the saved file wanted that are not imported here. */
  missing: string[];
  restored: number;
  /** Picks thrown away because the pack behind them could not be found. */
  dropped: number;
}

/**
 * Match the packs a saved project refers to against the ones imported now.
 *
 * A pack is given a fresh random id every time it is imported, so an id only
 * holds as long as that exact import survives. Clear the browser, move to
 * another machine, re-import a pack, or open someone else's project, and every
 * id in it is stale - which is why the name is the fallback and why saving one
 * without names, as this used to, made it unloadable the moment a pack was
 * re-imported.
 */
export function remapPacks(
  saved: SavedPackRef[],
  current: Array<{ id: string; name: string }>,
): { remap: Map<string, string>; missing: string[] } {
  const byId = new Set(current.map((p) => p.id));
  const byName = new Map<string, string>();
  for (const p of current) {
    // First wins, so a duplicate name cannot steal an earlier pack's picks.
    const key = p.name.toLowerCase();
    if (!byName.has(key)) byName.set(key, p.id);
  }

  const remap = new Map<string, string>();
  const claimed = new Set<string>();

  // Exact ids first, so a name collision can never displace a pack that is
  // genuinely still here.
  for (const ref of saved) {
    if (byId.has(ref.id)) {
      remap.set(ref.id, ref.id);
      claimed.add(ref.id);
    }
  }

  const missing: string[] = [];
  for (const ref of saved) {
    if (remap.has(ref.id)) continue;
    const match = ref.name ? byName.get(ref.name.toLowerCase()) : undefined;
    if (match && !claimed.has(match)) {
      remap.set(ref.id, match);
      claimed.add(match);
    } else {
      missing.push(ref.name ?? ref.id);
    }
  }

  return { remap, missing };
}

/** Apply a remap to a saved order and pick set, reporting what survived. */
export function restorePicks(
  saved: SavedPackRef[],
  savedOrder: string[],
  savedPicks: Record<string, string>,
  current: Array<{ id: string; name: string }>,
): RestoredPicks {
  const { remap, missing } = remapPacks(saved, current);

  const picks: Record<string, string> = {};
  let dropped = 0;
  for (const [key, packId] of Object.entries(savedPicks)) {
    const mapped = remap.get(packId);
    if (mapped) picks[key] = mapped;
    else dropped++;
  }

  const order: string[] = [];
  const seen = new Set<string>();
  for (const id of savedOrder) {
    const mapped = remap.get(id);
    if (mapped && !seen.has(mapped)) {
      seen.add(mapped);
      order.push(mapped);
    }
  }
  // Anything imported since goes to the back rather than silently outranking.
  for (const p of current) {
    if (!seen.has(p.id)) order.push(p.id);
  }

  return {
    packOrder: order,
    picks,
    remap,
    missing,
    restored: Object.keys(picks).length,
    dropped,
  };
}

/**
 * Fit a saved order and pick set to the packs that are actually present.
 *
 * Packs come and go independently of the choices made about them - a pack can
 * be removed, or imported after a project was saved - so both the order and the
 * picks are filtered down to what exists, and anything new is appended at the
 * end rather than silently outranking the saved order.
 */
export function reconcile(
  savedOrder: string[],
  savedPicks: Record<string, string>,
  knownPackIds: Iterable<string>,
): { packOrder: string[]; picks: Record<string, string> } {
  const known = new Set(knownPackIds);
  const seen = new Set<string>();

  const packOrder: string[] = [];
  for (const id of savedOrder) {
    if (known.has(id) && !seen.has(id)) {
      seen.add(id);
      packOrder.push(id);
    }
  }
  for (const id of known) {
    if (!seen.has(id)) packOrder.push(id);
  }

  const picks: Record<string, string> = {};
  for (const [key, packId] of Object.entries(savedPicks)) {
    if (known.has(packId)) picks[key] = packId;
  }

  return { packOrder, picks };
}
