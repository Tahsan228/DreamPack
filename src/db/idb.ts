import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ImportedPack, Project } from '../core/types';
import type { IndexedFile } from '../core/resolve';

interface FileRecord {
  packId: string;
  path: string;
  bytes: Uint8Array;
}

/** One record per pack holding its whole file listing, so the grid builds in a single read. */
interface FileIndexRecord {
  packId: string;
  files: IndexedFile[];
}

interface DreamPackDB extends DBSchema {
  packs: { key: string; value: ImportedPack };
  files: { key: [string, string]; value: FileRecord };
  fileIndex: { key: string; value: FileIndexRecord };
  projects: { key: string; value: Project };
}

let dbPromise: Promise<IDBPDatabase<DreamPackDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<DreamPackDB>> {
  if (!dbPromise) {
    dbPromise = openDB<DreamPackDB>('dreampack', 1, {
      upgrade(db) {
        db.createObjectStore('packs', { keyPath: 'id' });
        db.createObjectStore('files', { keyPath: ['packId', 'path'] });
        db.createObjectStore('fileIndex', { keyPath: 'packId' });
        db.createObjectStore('projects', { keyPath: 'id' });
      },
    });
  }
  return dbPromise;
}

export async function listPacks(): Promise<ImportedPack[]> {
  const db = await getDb();
  return db.getAll('packs');
}

export async function getFileIndex(packId: string): Promise<IndexedFile[]> {
  const db = await getDb();
  const rec = await db.get('fileIndex', packId);
  return rec?.files ?? [];
}

export async function getFileBytes(packId: string, path: string): Promise<Uint8Array | null> {
  const db = await getDb();
  const rec = await db.get('files', [packId, path]);
  return rec?.bytes ?? null;
}

/** Writes a freshly imported pack in one transaction so a failed import leaves nothing behind. */
export async function storePack(
  pack: ImportedPack,
  files: Array<{ path: string; bytes: Uint8Array }>,
  index: IndexedFile[],
): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['packs', 'files', 'fileIndex'], 'readwrite');
  const fileStore = tx.objectStore('files');
  for (const f of files) {
    void fileStore.put({ packId: pack.id, path: f.path, bytes: f.bytes });
  }
  void tx.objectStore('packs').put(pack);
  void tx.objectStore('fileIndex').put({ packId: pack.id, files: index });
  await tx.done;
}

/**
 * Write one file into an existing pack, updating its index in the same
 * transaction. Used by the texture editor, which adds files one at a time
 * rather than importing a whole zip.
 */
export async function putPackFile(
  pack: ImportedPack,
  file: { path: string; bytes: Uint8Array },
  entry: IndexedFile,
): Promise<IndexedFile[]> {
  const db = await getDb();
  const tx = db.transaction(['packs', 'files', 'fileIndex'], 'readwrite');
  const indexStore = tx.objectStore('fileIndex');

  const existing = (await indexStore.get(pack.id))?.files ?? [];
  const next = existing.filter((f) => f.path !== file.path);
  next.push(entry);

  void tx.objectStore('files').put({ packId: pack.id, path: file.path, bytes: file.bytes });
  void indexStore.put({ packId: pack.id, files: next });
  void tx.objectStore('packs').put({
    ...pack,
    fileCount: next.length,
    bytes: next.reduce((sum, f) => sum + f.size, 0),
  });
  await tx.done;

  return next;
}

export async function deletePack(packId: string): Promise<void> {
  const db = await getDb();
  const index = await getFileIndex(packId);
  const tx = db.transaction(['packs', 'files', 'fileIndex'], 'readwrite');
  const fileStore = tx.objectStore('files');
  for (const f of index) void fileStore.delete([packId, f.path]);
  void tx.objectStore('packs').delete(packId);
  void tx.objectStore('fileIndex').delete(packId);
  await tx.done;
}

export async function saveProject(project: Project): Promise<void> {
  const db = await getDb();
  await db.put('projects', project);
}

export async function listProjects(): Promise<Project[]> {
  const db = await getDb();
  const all = await db.getAll('projects');
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteProject(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('projects', id);
}
