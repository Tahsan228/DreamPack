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
