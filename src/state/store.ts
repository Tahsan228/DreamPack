import { create } from 'zustand';
import type { AssetSlot, Category, Filters, ImportedPack, Project } from '../core/types';
import { buildSlotIndex, resolveSlot, type IndexedFile } from '../core/resolve';
import { DEFAULT_VERSION } from '../core/versions';
import { createEditsPack, editStoragePath, EDITS_PACK_ID } from '../core/editsPack';
import { hashBytes } from '../core/hash';
import * as db from '../db/idb';
import { dropPack, dropFile } from '../lib/textureCache';
import { playSuccess } from '../lib/sfx';
import {
  loadSession, reconcile, restorePicks, saveSession,
  type RestoredPicks, type SessionState,
} from './session';
import type { ImportRequest, ImportResponse } from '../workers/importWorker';
import type { ExportRequest, ExportResponse } from '../workers/exportWorker';

/** Distinct, readable-on-gray pip colours assigned to packs in import order. */
const PACK_COLORS = [
  '#55FF55', '#55FFFF', '#FFFF55', '#FF55FF',
  '#FFAA00', '#FF5555', '#AAAAFF', '#00AA88',
];

export interface ImportStatus {
  id: string;
  name: string;
  phase: string;
  ratio: number;
  error?: string;
}

export interface ExportStatus {
  phase: string;
  ratio: number;
  warnings: string[];
  error?: string;
  done?: boolean;
  fileCount?: number;
}

/**
 * One point on the undo stack.
 *
 * Only the choices are captured, never the packs themselves: importing or
 * removing a pack moves bytes in IndexedDB and cannot be undone, so those
 * actions clear the stack instead of pushing to it.
 */
interface HistoryEntry {
  picks: Record<string, string>;
  packOrder: string[];
}

const MAX_HISTORY = 50;

/** A zip whose name matches a pack that is already imported. */
export interface PendingDuplicate {
  file: File;
  name: string;
  existingPackId: string;
}

interface State {
  ready: boolean;
  packs: ImportedPack[];
  indexes: Record<string, IndexedFile[]>;
  slots: AssetSlot[];

  packOrder: string[];
  picks: Record<string, string>;
  targetVersion: string;
  projectName: string;
  description: string;
  iconFromPackId: string | null;

  category: Category;
  search: string;
  filters: Filters;
  selectedKey: string | null;
  /** Slot key currently open in the texture editor, if any. */
  editingKey: string | null;

  imports: ImportStatus[];
  exportStatus: ExportStatus | null;
  savedProjects: Project[];
  /** Zips held back because a pack of the same name is already imported. */
  pendingDuplicates: PendingDuplicate[];

  past: HistoryEntry[];
  future: HistoryEntry[];

  hydrate: () => Promise<void>;
  importFiles: (files: File[]) => Promise<void>;
  /** Import without the duplicate check; `nameOverride` renames the incoming pack. */
  runImports: (files: File[], nameOverride?: string) => Promise<void>;
  /** Import regardless of a name clash, optionally replacing the pack it clashes with. */
  resolveDuplicate: (name: string, action: 'replace' | 'keep' | 'skip') => Promise<void>;
  removePack: (packId: string) => Promise<void>;
  movePack: (packId: string, delta: number) => void;
  reorderPack: (fromIndex: number, toIndex: number) => void;

  pick: (key: string, packId: string) => void;
  clearPick: (key: string) => void;
  clearAllPicks: () => void;
  /** Point every given slot that this pack supplies at it; returns how many moved. */
  pickMany: (packId: string, keys: string[]) => number;
  clearMany: (keys: string[]) => void;
  undo: () => void;
  redo: () => void;

  setVersion: (v: string) => void;
  setCategory: (c: Category) => void;
  setSearch: (s: string) => void;
  toggleFilter: (f: keyof Filters) => void;
  select: (key: string | null) => void;
  openEditor: (key: string) => void;
  closeEditor: () => void;
  saveEdit: (key: string, bytes: Uint8Array, width: number, height: number) => Promise<void>;
  setProjectName: (n: string) => void;
  setDescription: (d: string) => void;
  setIconPack: (packId: string | null) => void;

  exportPack: () => void;
  dismissExport: () => void;

  saveProject: () => Promise<void>;
  loadProject: (id: string) => Promise<LoadResult>;
  deleteProject: (id: string) => Promise<void>;
  exportProjectFile: () => void;
  importProjectFile: (file: File) => Promise<LoadResult>;
}

const rebuild = (packs: ImportedPack[], indexes: Record<string, IndexedFile[]>): AssetSlot[] =>
  buildSlotIndex(
    packs.map((p) => ({ id: p.id, era: p.era, files: indexes[p.id] ?? [] })),
  );

/**
 * Push the current choices onto the undo stack.
 *
 * Spread into the `set` of any action that changes picks or priority, so one
 * misclick out of several hundred is recoverable without clearing everything.
 * Redo is dropped, as it always is once a new branch is taken.
 */
const remember = (s: State): Pick<State, 'past' | 'future'> => ({
  past: [...s.past, { picks: s.picks, packOrder: s.packOrder }].slice(-MAX_HISTORY),
  future: [],
});

function download(bytes: Uint8Array | string, filename: string, mime: string) {
  const blob = typeof bytes === 'string'
    ? new Blob([bytes], { type: mime })
    : new Blob([new Uint8Array(bytes)], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const slug = (s: string) => s.trim().replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'dreampack';

/**
 * What loading a project or a .dreampack actually achieved.
 *
 * Both used to apply what they could and say nothing, so a load that matched no
 * packs at all - the normal outcome once a pack has been re-imported - looked
 * exactly like a load that worked.
 */
export interface LoadResult {
  ok: boolean;
  message: string;
}

function summarise(result: RestoredPicks, legacyNoNames: boolean): LoadResult {
  if (result.missing.length === 0) {
    return {
      ok: true,
      message: result.restored > 0 ? `Restored ${result.restored} picks.` : 'Loaded.',
    };
  }

  const names = result.missing.slice(0, 3).join(', ');
  const more = result.missing.length > 3 ? ` and ${result.missing.length - 3} more` : '';
  const lost = result.dropped > 0
    ? ` ${result.dropped} pick${result.dropped === 1 ? '' : 's'} could not be restored.`
    : '';
  // A project saved before names were recorded cannot be matched by anything
  // but its ids, so say so rather than blaming the packs.
  const why = legacyNoNames
    ? ' It was saved before pack names were recorded, so it can only be matched to the exact packs it was saved with - re-save it to fix that.'
    : '';

  return {
    ok: false,
    message: `Could not find ${result.missing.length} pack${result.missing.length === 1 ? '' : 's'}: ${names}${more}.${lost}${why}`,
  };
}

export const useStore = create<State>((set, get) => ({
  ready: false,
  packs: [],
  indexes: {},
  slots: [],

  packOrder: [],
  picks: {},
  targetVersion: DEFAULT_VERSION,
  projectName: 'my_pack',
  description: 'Made with DreamPack',
  iconFromPackId: null,

  category: 'Items',
  search: '',
  filters: { onlyDiffering: true, onlyOverridden: false, onlyUnmapped: false },
  selectedKey: null,
  editingKey: null,

  imports: [],
  exportStatus: null,
  savedProjects: [],
  pendingDuplicates: [],

  past: [],
  future: [],

  async hydrate() {
    const packs = await db.listPacks();
    const indexes: Record<string, IndexedFile[]> = {};
    for (const p of packs) indexes[p.id] = await db.getFileIndex(p.id);

    const ordered = [...packs].sort((a, b) => a.importedAt - b.importedAt);
    const saved = await loadSession();

    // Restore the choices made last visit, fitted to the packs that are still
    // here. Without this the packs come back but the work done with them - the
    // priority order and every pick - silently reset to defaults.
    const restored = saved
      ? reconcile(saved.packOrder, saved.picks, ordered.map((p) => p.id))
      : { packOrder: ordered.map((p) => p.id), picks: {} };

    set({
      ready: true,
      packs: ordered,
      indexes,
      slots: rebuild(ordered, indexes),
      packOrder: restored.packOrder,
      picks: restored.picks,
      savedProjects: await db.listProjects(),
      ...(saved
        ? {
            targetVersion: saved.targetVersion,
            projectName: saved.projectName,
            description: saved.description,
            iconFromPackId: saved.iconFromPackId,
            category: saved.category,
            filters: saved.filters,
          }
        : {}),
    });
  },

  async importFiles(files) {
    const zips = files.filter((f) => f.name.toLowerCase().endsWith('.zip'));
    if (zips.length === 0) return;

    // Importing the same zip twice leaves two identically named packs, which
    // also makes .dreampack's name matching ambiguous. Hold those back and let
    // the user say what they meant.
    const existingByName = new Map(get().packs.map((p) => [p.name.toLowerCase(), p.id]));
    const duplicates: PendingDuplicate[] = [];
    const fresh: File[] = [];
    for (const file of zips) {
      const name = file.name.replace(/\.zip$/i, '');
      const existingPackId = existingByName.get(name.toLowerCase());
      if (existingPackId) duplicates.push({ file, name, existingPackId });
      else fresh.push(file);
    }

    if (duplicates.length > 0) {
      set((s) => ({ pendingDuplicates: [...s.pendingDuplicates, ...duplicates] }));
    }
    if (fresh.length === 0) return;

    await get().runImports(fresh);
  },

  async resolveDuplicate(name, action) {
    const entry = get().pendingDuplicates.find((d) => d.name === name);
    set((s) => ({ pendingDuplicates: s.pendingDuplicates.filter((d) => d.name !== name) }));
    if (!entry || action === 'skip') return;

    if (action === 'replace') {
      await get().removePack(entry.existingPackId);
      await get().runImports([entry.file]);
      return;
    }

    // Keep both: give the newcomer a free name so the two stay tellable apart.
    const taken = new Set(get().packs.map((p) => p.name.toLowerCase()));
    let suffix = 2;
    while (taken.has(`${entry.name} (${suffix})`.toLowerCase())) suffix++;
    await get().runImports([entry.file], `${entry.name} (${suffix})`);
  },

  async runImports(files, nameOverride) {
    const zips = files.filter((f) => f.name.toLowerCase().endsWith('.zip'));
    if (zips.length === 0) return;

    // The pack set is about to change, and history entries name packs by id.
    set({ past: [], future: [] });

    await Promise.all(zips.map((file, i) => new Promise<void>((resolve) => {
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const name = nameOverride ?? file.name.replace(/\.zip$/i, '');
      const color = PACK_COLORS[(get().packs.length + i) % PACK_COLORS.length];

      set((s) => ({ imports: [...s.imports, { id, name, phase: 'Reading', ratio: 0 }] }));

      const worker = new Worker(new URL('../workers/importWorker.ts', import.meta.url), {
        type: 'module',
      });

      const finish = () => {
        worker.terminate();
        set((s) => ({ imports: s.imports.filter((im) => im.id !== id) }));
        resolve();
      };

      worker.onmessage = (e: MessageEvent<ImportResponse>) => {
        const msg = e.data;
        if (msg.type === 'progress') {
          set((s) => ({
            imports: s.imports.map((im) =>
              im.id === id ? { ...im, phase: msg.phase, ratio: msg.ratio } : im),
          }));
        } else if (msg.type === 'done') {
          set((s) => {
            const packs = [...s.packs, msg.pack];
            const indexes = { ...s.indexes, [msg.pack.id]: msg.index };
            return {
              packs,
              indexes,
              slots: rebuild(packs, indexes),
              packOrder: [...s.packOrder, msg.pack.id],
              iconFromPackId: s.iconFromPackId ?? msg.pack.id,
            };
          });
          finish();
        } else {
          set((s) => ({
            imports: s.imports.map((im) => (im.id === id ? { ...im, error: msg.message } : im)),
          }));
          worker.terminate();
          // Leave the failed row visible for a moment so the user sees why.
          setTimeout(() => {
            set((s) => ({ imports: s.imports.filter((im) => im.id !== id) }));
            resolve();
          }, 6000);
        }
      };

      file.arrayBuffer().then((buffer) => {
        const req: ImportRequest = { type: 'import', id, name, bytes: buffer, color };
        worker.postMessage(req, [buffer]);
      });
    })));
  },

  async removePack(packId) {
    await db.deletePack(packId);
    dropPack(packId);
    set((s) => {
      const packs = s.packs.filter((p) => p.id !== packId);
      const indexes = { ...s.indexes };
      delete indexes[packId];
      const picks = Object.fromEntries(
        Object.entries(s.picks).filter(([, v]) => v !== packId),
      );
      return {
        packs,
        indexes,
        picks,
        slots: rebuild(packs, indexes),
        packOrder: s.packOrder.filter((id) => id !== packId),
        iconFromPackId: s.iconFromPackId === packId ? null : s.iconFromPackId,
        // The bytes have left IndexedDB, so no history entry naming this pack
        // could be restored. Drop the stack rather than leave it lying.
        past: [],
        future: [],
      };
    });
  },

  movePack(packId, delta) {
    const s = get();
    const order = [...s.packOrder];
    const i = order.indexOf(packId);
    const j = i + delta;
    if (i === -1 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    set({ ...remember(s), packOrder: order });
  },

  reorderPack(fromIndex, toIndex) {
    const s = get();
    const order = [...s.packOrder];
    if (fromIndex === toIndex || fromIndex < 0 || fromIndex >= order.length) return;
    const [moved] = order.splice(fromIndex, 1);
    order.splice(Math.max(0, Math.min(order.length, toIndex)), 0, moved);
    set({ ...remember(s), packOrder: order });
  },

  pick(key, packId) {
    set((s) => ({ ...remember(s), picks: { ...s.picks, [key]: packId } }));
  },

  clearPick(key) {
    set((s) => {
      const picks = { ...s.picks };
      delete picks[key];
      return { ...remember(s), picks };
    });
  },

  clearAllPicks() {
    set((s) => ({ ...remember(s), picks: {} }));
  },

  /**
   * Apply one pack across a set of slots - the filtered view, in practice.
   *
   * Only slots that pack actually supplies are touched; the rest keep whatever
   * they had, so "use Pack B for everything shown" cannot quietly blank the
   * assets Pack B does not contain.
   */
  pickMany(packId, keys) {
    const s = get();
    const byKey = new Map(s.slots.map((slot) => [slot.key, slot]));
    const picks = { ...s.picks };
    let applied = 0;

    for (const key of keys) {
      const slot = byKey.get(key);
      if (!slot?.candidates.some((c) => c.packId === packId)) continue;
      if (picks[key] === packId) continue;
      picks[key] = packId;
      applied++;
    }

    if (applied > 0) set({ ...remember(s), picks });
    return applied;
  },

  clearMany(keys) {
    const s = get();
    const picks = { ...s.picks };
    let removed = 0;
    for (const key of keys) {
      if (key in picks) {
        delete picks[key];
        removed++;
      }
    }
    if (removed > 0) set({ ...remember(s), picks });
  },

  undo() {
    const s = get();
    const previous = s.past[s.past.length - 1];
    if (!previous) return;
    set({
      past: s.past.slice(0, -1),
      future: [...s.future, { picks: s.picks, packOrder: s.packOrder }].slice(-MAX_HISTORY),
      picks: previous.picks,
      packOrder: previous.packOrder,
    });
  },

  redo() {
    const s = get();
    const next = s.future[s.future.length - 1];
    if (!next) return;
    set({
      future: s.future.slice(0, -1),
      past: [...s.past, { picks: s.picks, packOrder: s.packOrder }].slice(-MAX_HISTORY),
      picks: next.picks,
      packOrder: next.packOrder,
    });
  },

  setVersion: (v) => set({ targetVersion: v }),
  setCategory: (c) => set({ category: c, selectedKey: null }),
  setSearch: (search) => set({ search }),
  toggleFilter: (f) => set((s) => ({ filters: { ...s.filters, [f]: !s.filters[f] } })),
  select: (selectedKey) => set({ selectedKey }),
  openEditor: (editingKey) => set({ editingKey }),
  closeEditor: () => set({ editingKey: null }),

  /**
   * Store a painted texture in the synthetic "My Edits" pack and pin this slot
   * to it. Edits are stored under modern canonical paths so they round-trip back
   * to the same key, and export renames them for whatever version is targeted.
   */
  async saveEdit(key, bytes, width, height) {
    const path = editStoragePath(key);
    if (!path) return;

    const state = get();
    const pack = state.packs.find((p) => p.id === EDITS_PACK_ID) ?? createEditsPack();
    const entry: IndexedFile = { path, size: bytes.length, hash: hashBytes(bytes), width, height };

    let index = await db.putPackFile(pack, { path, bytes }, entry);
    // The cached object URL points at the pre-edit bytes.
    dropFile(EDITS_PACK_ID, path);

    /*
     * An animated texture is a filmstrip plus a .png.mcmeta saying how to play
     * it. The edit only replaces the strip, so the companion has to come along
     * or the export ships a filmstrip with no animation block and the game
     * squashes every frame onto one face.
     */
    const slot = state.slots.find((s) => s.key === key);
    const source = slot ? resolveSlot(slot, state.packOrder, state.picks) : null;
    const sourceMcmeta = source?.companions.find((c) => c.endsWith('.mcmeta'));
    if (source && sourceMcmeta && source.packId !== EDITS_PACK_ID) {
      const metaBytes = await db.getFileBytes(source.packId, sourceMcmeta);
      if (metaBytes) {
        const metaPath = `${path}.mcmeta`;
        index = await db.putPackFile(
          pack,
          { path: metaPath, bytes: metaBytes },
          { path: metaPath, size: metaBytes.length, hash: hashBytes(metaBytes) },
        );
        dropFile(EDITS_PACK_ID, metaPath);
      }
    }

    set((s) => {
      const packs = s.packs.some((p) => p.id === EDITS_PACK_ID)
        ? s.packs.map((p) =>
            p.id === EDITS_PACK_ID
              ? { ...p, fileCount: index.length, bytes: index.reduce((n, f) => n + f.size, 0) }
              : p)
        : [...s.packs, pack];
      const indexes = { ...s.indexes, [EDITS_PACK_ID]: index };

      return {
        packs,
        indexes,
        slots: rebuild(packs, indexes),
        // Your own edits outrank imported packs.
        packOrder: s.packOrder.includes(EDITS_PACK_ID)
          ? s.packOrder
          : [EDITS_PACK_ID, ...s.packOrder],
        picks: { ...s.picks, [key]: EDITS_PACK_ID },
        editingKey: null,
      };
    });
  },

  setProjectName: (projectName) => set({ projectName }),
  setDescription: (description) => set({ description }),
  setIconPack: (iconFromPackId) => set({ iconFromPackId }),

  exportPack() {
    const s = get();
    if (s.packs.length === 0) return;
    set({ exportStatus: { phase: 'Starting', ratio: 0, warnings: [] } });

    const worker = new Worker(new URL('../workers/exportWorker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = (e: MessageEvent<ExportResponse>) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        set((cur) => ({
          exportStatus: {
            phase: msg.phase,
            ratio: msg.ratio,
            warnings: cur.exportStatus?.warnings ?? [],
          },
        }));
      } else if (msg.type === 'done') {
        download(msg.bytes, `${slug(get().projectName)}.zip`, 'application/zip');
        playSuccess();
        set({
          exportStatus: {
            phase: 'Done', ratio: 1, warnings: msg.warnings, done: true, fileCount: msg.fileCount,
          },
        });
        worker.terminate();
      } else {
        set({ exportStatus: { phase: 'Failed', ratio: 1, warnings: [], error: msg.message } });
        worker.terminate();
      }
    };

    const req: ExportRequest = {
      type: 'export',
      packs: s.packs.map((p) => ({ id: p.id, era: p.era, name: p.name })),
      packOrder: s.packOrder,
      picks: s.picks,
      targetVersion: s.targetVersion,
      description: s.description,
      iconFromPackId: s.iconFromPackId,
    };
    worker.postMessage(req);
  },

  dismissExport: () => set({ exportStatus: null }),

  async saveProject() {
    const s = get();
    // Names travel with the ids: an id only survives as long as that exact
    // import does, so without them the project cannot be matched back up.
    const packNames: Record<string, string> = {};
    for (const p of s.packs) packNames[p.id] = p.name;

    const project: Project = {
      id: slug(s.projectName),
      name: s.projectName,
      targetVersion: s.targetVersion,
      packOrder: s.packOrder,
      picks: s.picks,
      packNames,
      packMeta: { description: s.description, iconFromPackId: s.iconFromPackId },
      updatedAt: Date.now(),
    };
    await db.saveProject(project);
    set({ savedProjects: await db.listProjects() });
  },

  async loadProject(id) {
    const project = (await db.listProjects()).find((p) => p.id === id);
    if (!project) return { ok: false, message: 'That project is no longer saved.' };

    const s = get();
    // Every pack the project mentions, whether or not it was in the priority
    // order, so a pick can still be matched up by name.
    const refs = new Set([...project.packOrder, ...Object.values(project.picks)]);
    const saved = [...refs].map((packId) => ({
      id: packId,
      name: project.packNames?.[packId],
    }));

    const result = restorePicks(
      saved,
      project.packOrder,
      project.picks,
      s.packs.map((p) => ({ id: p.id, name: p.name })),
    );

    set({
      projectName: project.name,
      targetVersion: project.targetVersion,
      packOrder: result.packOrder,
      picks: result.picks,
      description: project.packMeta.description,
      iconFromPackId: project.packMeta.iconFromPackId
        ? result.remap.get(project.packMeta.iconFromPackId) ?? null
        : null,
      selectedKey: null,
      past: [],
      future: [],
    });

    return summarise(result, project.packNames === undefined);
  },

  async deleteProject(id) {
    await db.deleteProject(id);
    set({ savedProjects: await db.listProjects() });
  },

  exportProjectFile() {
    const s = get();
    const payload = {
      dreampack: 1,
      name: s.projectName,
      targetVersion: s.targetVersion,
      description: s.description,
      iconFromPackId: s.iconFromPackId,
      // Names travel with ids so a shared project can explain which packs it needs.
      packs: s.packOrder.map((id) => ({ id, name: s.packs.find((p) => p.id === id)?.name ?? id })),
      picks: s.picks,
    };
    download(JSON.stringify(payload, null, 2), `${slug(s.projectName)}.dreampack`, 'application/json');
  },

  async importProjectFile(file) {
    interface DreamPackFile {
      dreampack?: number;
      name?: string;
      targetVersion?: string;
      description?: string;
      iconFromPackId?: string | null;
      packs?: Array<{ id: string; name: string }>;
      picks?: Record<string, string>;
    }

    let data: DreamPackFile;
    try {
      data = JSON.parse(await file.text()) as DreamPackFile;
    } catch {
      // Silence here read as "the button does nothing".
      return { ok: false, message: `${file.name} is not readable as a .dreampack file.` };
    }

    if (!data || typeof data !== 'object' || !data.picks || !Array.isArray(data.packs)) {
      return { ok: false, message: `${file.name} does not look like a .dreampack file.` };
    }

    const s = get();
    const result = restorePicks(
      data.packs,
      data.packs.map((p) => p.id),
      data.picks,
      s.packs.map((p) => ({ id: p.id, name: p.name })),
    );

    set({
      projectName: data.name ?? s.projectName,
      targetVersion: data.targetVersion ?? s.targetVersion,
      description: data.description ?? s.description,
      // The icon is a pack id like any other, so it goes through the same remap.
      iconFromPackId: data.iconFromPackId
        ? result.remap.get(data.iconFromPackId) ?? null
        : s.iconFromPackId,
      picks: result.picks,
      packOrder: result.packOrder,
      selectedKey: null,
      past: [],
      future: [],
    });

    return summarise(result, false);
  },
}));

/*
 * Keep the session on disk.
 *
 * One subscription rather than a write at the end of every action: picks,
 * priority, version and filters all change from a dozen places, and any one of
 * them forgotten would be a silent data loss of exactly the kind this fixes.
 * Writes are debounced in `session.ts`, and nothing is written before `hydrate`
 * has restored, or it would overwrite the saved session with the defaults.
 */
let lastSaved: SessionState | null = null;

useStore.subscribe((state) => {
  if (!state.ready) return;

  const next: SessionState = {
    packOrder: state.packOrder,
    picks: state.picks,
    targetVersion: state.targetVersion,
    projectName: state.projectName,
    description: state.description,
    iconFromPackId: state.iconFromPackId,
    category: state.category,
    filters: state.filters,
  };

  // Most state changes touch none of this - scrolling, selection, import
  // progress - so compare by reference before queueing a write.
  if (lastSaved && (Object.keys(next) as Array<keyof SessionState>).every(
    (k) => next[k] === lastSaved![k],
  )) {
    return;
  }

  lastSaved = next;
  saveSession(next);
});
