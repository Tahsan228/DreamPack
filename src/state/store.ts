import { create } from 'zustand';
import type { AssetSlot, Category, ImportedPack, Project } from '../core/types';
import { buildSlotIndex, type IndexedFile } from '../core/resolve';
import { DEFAULT_VERSION } from '../core/versions';
import { createEditsPack, editStoragePath, EDITS_PACK_ID } from '../core/editsPack';
import { hashBytes } from '../core/hash';
import * as db from '../db/idb';
import { dropPack, dropFile } from '../lib/textureCache';
import { playSuccess } from '../lib/sfx';
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

interface Filters {
  onlyDiffering: boolean;
  onlyOverridden: boolean;
  onlyUnmapped: boolean;
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

  hydrate: () => Promise<void>;
  importFiles: (files: File[]) => Promise<void>;
  removePack: (packId: string) => Promise<void>;
  movePack: (packId: string, delta: number) => void;
  reorderPack: (fromIndex: number, toIndex: number) => void;

  pick: (key: string, packId: string) => void;
  clearPick: (key: string) => void;
  clearAllPicks: () => void;

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
  loadProject: (id: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  exportProjectFile: () => void;
  importProjectFile: (file: File) => Promise<void>;
}

const rebuild = (packs: ImportedPack[], indexes: Record<string, IndexedFile[]>): AssetSlot[] =>
  buildSlotIndex(
    packs.map((p) => ({ id: p.id, era: p.era, files: indexes[p.id] ?? [] })),
  );

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

  async hydrate() {
    const packs = await db.listPacks();
    const indexes: Record<string, IndexedFile[]> = {};
    for (const p of packs) indexes[p.id] = await db.getFileIndex(p.id);

    const ordered = [...packs].sort((a, b) => a.importedAt - b.importedAt);
    set({
      ready: true,
      packs: ordered,
      indexes,
      slots: rebuild(ordered, indexes),
      packOrder: ordered.map((p) => p.id),
      savedProjects: await db.listProjects(),
    });
  },

  async importFiles(files) {
    const zips = files.filter((f) => f.name.toLowerCase().endsWith('.zip'));
    if (zips.length === 0) return;

    await Promise.all(zips.map((file, i) => new Promise<void>((resolve) => {
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const name = file.name.replace(/\.zip$/i, '');
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
      };
    });
  },

  movePack(packId, delta) {
    const order = [...get().packOrder];
    const i = order.indexOf(packId);
    const j = i + delta;
    if (i === -1 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    set({ packOrder: order });
  },

  reorderPack(fromIndex, toIndex) {
    const order = [...get().packOrder];
    if (fromIndex === toIndex || fromIndex < 0 || fromIndex >= order.length) return;
    const [moved] = order.splice(fromIndex, 1);
    order.splice(Math.max(0, Math.min(order.length, toIndex)), 0, moved);
    set({ packOrder: order });
  },

  pick(key, packId) {
    set((s) => ({ picks: { ...s.picks, [key]: packId } }));
  },

  clearPick(key) {
    set((s) => {
      const picks = { ...s.picks };
      delete picks[key];
      return { picks };
    });
  },

  clearAllPicks() {
    set({ picks: {} });
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

    const index = await db.putPackFile(pack, { path, bytes }, entry);
    // The cached object URL points at the pre-edit bytes.
    dropFile(EDITS_PACK_ID, path);

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
    const project: Project = {
      id: slug(s.projectName),
      name: s.projectName,
      targetVersion: s.targetVersion,
      packOrder: s.packOrder,
      picks: s.picks,
      packMeta: { description: s.description, iconFromPackId: s.iconFromPackId },
      updatedAt: Date.now(),
    };
    await db.saveProject(project);
    set({ savedProjects: await db.listProjects() });
  },

  async loadProject(id) {
    const project = (await db.listProjects()).find((p) => p.id === id);
    if (!project) return;
    const known = new Set(get().packs.map((p) => p.id));
    set({
      projectName: project.name,
      targetVersion: project.targetVersion,
      // Drop references to packs that are no longer imported, keep any new ones at the end.
      packOrder: [
        ...project.packOrder.filter((p) => known.has(p)),
        ...[...known].filter((p) => !project.packOrder.includes(p)),
      ],
      picks: project.picks,
      description: project.packMeta.description,
      iconFromPackId: project.packMeta.iconFromPackId,
      selectedKey: null,
    });
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
      // Names travel with ids so a shared project can explain which packs it needs.
      packs: s.packOrder.map((id) => ({ id, name: s.packs.find((p) => p.id === id)?.name ?? id })),
      picks: s.picks,
    };
    download(JSON.stringify(payload, null, 2), `${slug(s.projectName)}.dreampack`, 'application/json');
  },

  async importProjectFile(file) {
    const text = await file.text();
    const data = JSON.parse(text) as {
      name?: string;
      targetVersion?: string;
      description?: string;
      packs?: Array<{ id: string; name: string }>;
      picks?: Record<string, string>;
    };

    const byName = new Map(get().packs.map((p) => [p.name, p.id]));
    const known = new Set(get().packs.map((p) => p.id));

    // Re-importing a pack gives it a fresh id, so fall back to matching on name.
    const remap = new Map<string, string>();
    for (const p of data.packs ?? []) {
      if (known.has(p.id)) remap.set(p.id, p.id);
      else {
        const match = byName.get(p.name);
        if (match) remap.set(p.id, match);
      }
    }

    const picks: Record<string, string> = {};
    for (const [key, packId] of Object.entries(data.picks ?? {})) {
      const mapped = remap.get(packId);
      if (mapped) picks[key] = mapped;
    }

    const order = (data.packs ?? [])
      .map((p) => remap.get(p.id))
      .filter((id): id is string => Boolean(id));

    set((s) => ({
      projectName: data.name ?? s.projectName,
      targetVersion: data.targetVersion ?? s.targetVersion,
      description: data.description ?? s.description,
      picks,
      packOrder: [...order, ...s.packOrder.filter((id) => !order.includes(id))],
      selectedKey: null,
    }));
  },
}));
