/// <reference lib="webworker" />
import { zip, type AsyncZipOptions } from 'fflate';
import { parseKey } from '../core/canonical';
import { citReferences } from '../core/citParse';
import { mergeSoundsJson, type SoundsJson } from '../core/soundsMerge';
import { buildSlotIndex, planExportPaths, resolveAll, type IndexablePack } from '../core/resolve';
import { getVersion } from '../core/versions';
import { getFileBytes, getFileIndex } from '../db/idb';
import type { Era } from '../core/types';

export interface ExportRequest {
  type: 'export';
  packs: Array<{ id: string; era: Era; name: string }>;
  /** Priority order; index 0 wins. */
  packOrder: string[];
  picks: Record<string, string>;
  targetVersion: string;
  description: string;
  iconFromPackId: string | null;
}

export type ExportResponse =
  | { type: 'progress'; phase: string; ratio: number }
  | { type: 'done'; bytes: Uint8Array; warnings: string[]; fileCount: number }
  | { type: 'error'; message: string };

const post = (msg: ExportResponse, transfer?: Transferable[]) =>
  (self as unknown as Worker).postMessage(msg, transfer ?? []);

/** PNG and OGG are already compressed; re-deflating them costs time for nothing. */
function levelFor(path: string): 0 | 6 {
  const lower = path.toLowerCase();
  return lower.endsWith('.png') || lower.endsWith('.ogg') ? 0 : 6;
}

async function handleExport(req: ExportRequest): Promise<void> {
  const version = getVersion(req.targetVersion);
  const warnings: string[] = [];

  post({ type: 'progress', phase: 'Reading packs', ratio: 0.05 });

  const indexable: IndexablePack[] = [];
  const eraById = new Map<string, Era>();
  const nameById = new Map<string, string>();
  for (const p of req.packs) {
    eraById.set(p.id, p.era);
    nameById.set(p.id, p.name);
    indexable.push({ id: p.id, era: p.era, files: await getFileIndex(p.id) });
  }

  post({ type: 'progress', phase: 'Resolving picks', ratio: 0.15 });

  const slots = buildSlotIndex(indexable);
  const slotByKey = new Map(slots.map((s) => [s.key, s]));
  const resolved = resolveAll(slots, req.packOrder, req.picks);

  const out: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
  const add = (path: string, bytes: Uint8Array) => {
    out[path] = [bytes, { level: levelFor(path) }];
  };

  // --- Copy every resolved asset ------------------------------------------
  const total = resolved.size || 1;
  let done = 0;
  const availableSounds = new Set<string>();
  const nameOf = (key: string) => slotByKey.get(key)?.displayName ?? key;

  // Settle which slot gets which file before writing any of them, so a texture
  // cannot land on another block by being written second.
  const { plan, conflicts } = planExportPaths(resolved.keys(), version);
  for (const c of conflicts) {
    warnings.push(
      `${nameOf(c.dropped)} and ${nameOf(c.kept)} both export to ${c.outPath.split('/').pop()} - kept ${nameOf(c.kept)}`,
    );
  }

  for (const [key, candidate] of resolved) {
    done++;
    if (done % 250 === 0) {
      post({ type: 'progress', phase: 'Building pack', ratio: 0.15 + 0.6 * (done / total) });
    }

    const outPath = plan.get(key);
    if (!outPath) continue;

    const bytes = await getFileBytes(candidate.packId, candidate.primaryPath);
    if (!bytes) {
      warnings.push(`Missing file for ${key} in ${nameById.get(candidate.packId) ?? candidate.packId}`);
      continue;
    }
    add(outPath, bytes);

    const parsed = parseKey(key);
    if (parsed?.kind === 'sound') availableSounds.add(key);

    // Flag assets whose name has no cross-era mapping when the eras differ.
    const slotEra = eraById.get(candidate.packId);
    if (slotEra && slotEra !== version.era) {
      const slot = slotByKey.get(key);
      if (slot?.unmapped) {
        warnings.push(
          `${slot.displayName}: no ${slotEra} ↔ ${version.era} name mapping, exported as "${outPath.split('/').pop()}"`,
        );
      }
    }

    // Companions (.mcmeta) follow the primary to its new path.
    for (const companion of candidate.companions) {
      const cBytes = await getFileBytes(candidate.packId, companion);
      if (cBytes) add(`${outPath}.mcmeta`, cBytes);
    }

    // A CIT rule is useless without the files it points at.
    if (parsed?.kind === 'cit') {
      const refs = citReferences(new TextDecoder().decode(bytes), candidate.primaryPath);
      for (const ref of refs) {
        const refBytes = await getFileBytes(candidate.packId, ref);
        if (refBytes) {
          add(ref.replace(/^assets\/([^/]+)\/mcpatcher\//, 'assets/$1/optifine/'), refBytes);
        } else {
          warnings.push(`CIT "${key.slice(4)}" references a missing file: ${ref.split('/').pop()}`);
        }
      }
    }
  }

  // --- Merge sounds.json ---------------------------------------------------
  post({ type: 'progress', phase: 'Merging sounds', ratio: 0.8 });

  const perPack: Array<{ packId: string; json: SoundsJson }> = [];
  for (const packId of req.packOrder) {
    const bytes = await getFileBytes(packId, 'assets/minecraft/sounds.json');
    if (!bytes) continue;
    try {
      perPack.push({ packId, json: JSON.parse(new TextDecoder().decode(bytes)) as SoundsJson });
    } catch {
      warnings.push(`${nameById.get(packId) ?? packId}: sounds.json is not valid JSON, skipped`);
    }
  }
  if (perPack.length > 0) {
    const merged = mergeSoundsJson(perPack, availableSounds);
    if (Object.keys(merged).length > 0) {
      add('assets/minecraft/sounds.json', new TextEncoder().encode(JSON.stringify(merged, null, 2)));
    }
  }

  // --- Pack metadata -------------------------------------------------------
  const mcmeta = {
    pack: {
      pack_format: version.packFormat,
      description: req.description || 'Made with DreamPack',
    },
  };
  add('pack.mcmeta', new TextEncoder().encode(JSON.stringify(mcmeta, null, 2)));

  const iconPackId = req.iconFromPackId ?? req.packOrder[0];
  if (iconPackId) {
    const icon = await getFileBytes(iconPackId, 'pack.png');
    if (icon) add('pack.png', icon);
  }

  // --- Zip -----------------------------------------------------------------
  post({ type: 'progress', phase: 'Compressing', ratio: 0.88 });

  const options: AsyncZipOptions = { level: 6 };
  const bytes = await new Promise<Uint8Array>((resolve, reject) => {
    zip(out, options, (err, data) => (err ? reject(err) : resolve(data)));
  });

  post({ type: 'progress', phase: 'Done', ratio: 1 });
  post({ type: 'done', bytes, warnings, fileCount: Object.keys(out).length }, [
    bytes.buffer as ArrayBuffer,
  ]);
}

self.onmessage = (e: MessageEvent<ExportRequest>) => {
  const req = e.data;
  if (req.type !== 'export') return;
  handleExport(req).catch((err: unknown) => {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  });
};
