import { KEPT_EXTENSIONS } from './canonical';
import { hashBytes } from './hash';
import { detectEra } from './versions';
import type { Era } from './types';
import type { IndexedFile } from './resolve';

/** Junk, directories and file types a resource pack never needs. */
export function shouldKeep(path: string): boolean {
  if (path.endsWith('/')) return false;
  if (path.includes('__MACOSX/')) return false;
  const name = path.split('/').pop() ?? '';
  if (name.startsWith('.')) return false;
  const lower = path.toLowerCase();
  return KEPT_EXTENSIONS.some((e) => lower.endsWith(e));
}

/**
 * Packs are often zipped with a wrapper folder (`MyPack/assets/...`) or double-
 * wrapped by a download site. Find that prefix so paths come out pack-relative
 * no matter how the zip was made.
 */
export function findRootPrefix(paths: string[]): string {
  const meta = paths.find((p) => p === 'pack.mcmeta' || p.endsWith('/pack.mcmeta'));
  if (meta) return meta.slice(0, meta.length - 'pack.mcmeta'.length);

  let best: string | null = null;
  for (const p of paths) {
    const i = p.indexOf('assets/');
    if (i === -1) continue;
    if (i === 0) return '';
    const prefix = p.slice(0, i);
    if (best === null || prefix.length < best.length) best = prefix;
  }
  return best ?? '';
}

/** PNG dimensions live in the IHDR chunk at a fixed offset — no decoding needed. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

export interface PackMeta {
  description: string;
  packFormat: number | null;
}

export function parsePackMeta(bytes: Uint8Array | null): PackMeta {
  if (!bytes) return { description: '', packFormat: null };
  try {
    const meta = JSON.parse(new TextDecoder().decode(bytes)) as {
      pack?: { pack_format?: unknown; description?: unknown };
    };
    const pack = meta?.pack;
    if (!pack) return { description: '', packFormat: null };

    let description = '';
    if (typeof pack.description === 'string') description = pack.description;
    else if (Array.isArray(pack.description)) {
      description = pack.description
        .map((d) => (typeof d === 'string' ? d : (d as { text?: string })?.text ?? ''))
        .join('');
    }

    return {
      // Strip Minecraft's §-prefixed colour codes so the UI shows plain text.
      description: description.replace(/§[0-9a-fk-or]/gi, '').trim(),
      packFormat: typeof pack.pack_format === 'number' ? pack.pack_format : null,
    };
  } catch {
    // A malformed pack.mcmeta is common and not worth failing the import over.
    return { description: '', packFormat: null };
  }
}

export interface ReadPack {
  files: Array<{ path: string; bytes: Uint8Array }>;
  index: IndexedFile[];
  meta: PackMeta;
  era: Era;
  totalBytes: number;
  packPng: Uint8Array | null;
}

/** Turn raw zip entries into pack-relative files plus everything the UI needs. */
export function readPackEntries(entries: Record<string, Uint8Array>): ReadPack {
  const rawPaths = Object.keys(entries);
  const prefix = findRootPrefix(rawPaths);

  const files: Array<{ path: string; bytes: Uint8Array }> = [];
  const index: IndexedFile[] = [];
  let totalBytes = 0;
  let packMcmeta: Uint8Array | null = null;
  let packPng: Uint8Array | null = null;

  for (const rawPath of rawPaths) {
    const bytes = entries[rawPath];
    const path = prefix && rawPath.startsWith(prefix) ? rawPath.slice(prefix.length) : rawPath;
    if (!path) continue;

    if (path === 'pack.mcmeta') packMcmeta = bytes;
    if (path === 'pack.png') packPng = bytes;

    const entry: IndexedFile = { path, size: bytes.length, hash: hashBytes(bytes) };
    if (path.toLowerCase().endsWith('.png')) {
      const dims = pngSize(bytes);
      if (dims) {
        entry.width = dims.width;
        entry.height = dims.height;
      }
    }

    files.push({ path, bytes });
    index.push(entry);
    totalBytes += bytes.length;
  }

  const meta = parsePackMeta(packMcmeta);
  return {
    files,
    index,
    meta,
    era: detectEra(meta.packFormat, index.map((f) => f.path)),
    totalBytes,
    packPng,
  };
}
