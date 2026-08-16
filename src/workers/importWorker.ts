/// <reference lib="webworker" />
import { unzip } from 'fflate';
import { readPackEntries, shouldKeep } from '../core/packRead';
import { storePack } from '../db/idb';
import type { ImportedPack } from '../core/types';
import type { IndexedFile } from '../core/resolve';

export interface ImportRequest {
  type: 'import';
  id: string;
  name: string;
  bytes: ArrayBuffer;
  color: string;
}

export type ImportResponse =
  | { type: 'progress'; id: string; phase: string; ratio: number }
  | { type: 'done'; id: string; pack: ImportedPack; index: IndexedFile[] }
  | { type: 'error'; id: string; message: string };

const post = (msg: ImportResponse) => (self as unknown as Worker).postMessage(msg);

function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

async function handleImport(req: ImportRequest): Promise<void> {
  post({ type: 'progress', id: req.id, phase: 'Unzipping', ratio: 0.05 });

  const raw = new Uint8Array(req.bytes);
  const entries = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    // Filtering before decompression keeps big packs cheap to import.
    unzip(raw, { filter: (f) => shouldKeep(f.name) }, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });

  if (Object.keys(entries).length === 0) {
    throw new Error('No resource pack files found in this zip.');
  }

  post({ type: 'progress', id: req.id, phase: 'Indexing', ratio: 0.45 });
  const read = readPackEntries(entries);

  post({ type: 'progress', id: req.id, phase: 'Saving', ratio: 0.75 });

  const pack: ImportedPack = {
    id: req.id,
    name: req.name,
    description: read.meta.description,
    packFormat: read.meta.packFormat,
    era: read.era,
    iconDataUrl: read.packPng ? bytesToDataUrl(read.packPng, 'image/png') : null,
    fileCount: read.files.length,
    bytes: read.totalBytes,
    importedAt: Date.now(),
    color: req.color,
  };

  await storePack(pack, read.files, read.index);
  post({ type: 'progress', id: req.id, phase: 'Done', ratio: 1 });
  post({ type: 'done', id: req.id, pack, index: read.index });
}

self.onmessage = (e: MessageEvent<ImportRequest>) => {
  const req = e.data;
  if (req.type !== 'import') return;
  handleImport(req).catch((err: unknown) => {
    post({
      type: 'error',
      id: req.id,
      message: err instanceof Error ? err.message : String(err),
    });
  });
};
