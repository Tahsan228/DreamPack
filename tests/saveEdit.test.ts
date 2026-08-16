// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../src/state/store';
import { EDITS_PACK_ID, editStoragePath } from '../src/core/editsPack';
import { getFileBytes, getFileIndex } from '../src/db/idb';
import { resolveSlot } from '../src/core/resolve';
import type { ImportedPack } from '../src/core/types';

const SWORD_KEY = 'texture:item/diamond_sword';

const sourcePack: ImportedPack = {
  id: 'pack-a',
  name: 'Pack A',
  description: '',
  packFormat: 1,
  era: 'legacy',
  iconDataUrl: null,
  fileCount: 1,
  bytes: 300,
  importedAt: 1,
  color: '#55FF55',
};

const sourceIndex = [
  { path: 'assets/minecraft/textures/items/sword_diamond.png', size: 300, hash: 'original' },
];

/** Stands in for the PNG bytes the editor's canvas would produce. */
const editedBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

describe('saveEdit', () => {
  beforeEach(async () => {
    const { buildSlotIndex } = await import('../src/core/resolve');
    useStore.setState({
      ready: true,
      packs: [sourcePack],
      indexes: { 'pack-a': sourceIndex },
      slots: buildSlotIndex([{ id: 'pack-a', era: 'legacy', files: sourceIndex }]),
      packOrder: ['pack-a'],
      picks: {},
      editingKey: SWORD_KEY,
    });
  });

  it('creates the edits pack, stores the file and pins the slot', async () => {
    await useStore.getState().saveEdit(SWORD_KEY, editedBytes, 16, 16);
    const state = useStore.getState();

    // A new pack appears, ranked above the imported one.
    expect(state.packs.map((p) => p.id)).toContain(EDITS_PACK_ID);
    expect(state.packOrder[0]).toBe(EDITS_PACK_ID);

    // The slot is pinned to the edit, and the editor closed.
    expect(state.picks[SWORD_KEY]).toBe(EDITS_PACK_ID);
    expect(state.editingKey).toBeNull();

    // The bytes really landed in IndexedDB under the canonical modern path.
    const path = editStoragePath(SWORD_KEY)!;
    expect(path).toBe('assets/minecraft/textures/item/diamond_sword.png');
    // Spread both sides: fake-indexeddb returns the array from another realm,
    // so a prototype-sensitive deep-equal would fail on identical bytes.
    expect([...(await getFileBytes(EDITS_PACK_ID, path))!]).toEqual([...editedBytes]);
    expect((await getFileIndex(EDITS_PACK_ID)).map((f) => f.path)).toEqual([path]);
  });

  it('makes the edit win the slot it was painted over', async () => {
    await useStore.getState().saveEdit(SWORD_KEY, editedBytes, 16, 16);
    const state = useStore.getState();

    const slot = state.slots.find((s) => s.key === SWORD_KEY);
    expect(slot?.candidates).toHaveLength(2);

    const winner = resolveSlot(slot!, state.packOrder, state.picks);
    expect(winner?.packId).toBe(EDITS_PACK_ID);
  });

  it('overwrites rather than duplicating when the same slot is edited twice', async () => {
    await useStore.getState().saveEdit(SWORD_KEY, editedBytes, 16, 16);
    const second = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 9, 9, 9]);
    await useStore.getState().saveEdit(SWORD_KEY, second, 16, 16);

    const path = editStoragePath(SWORD_KEY)!;
    expect(await getFileIndex(EDITS_PACK_ID)).toHaveLength(1);
    expect([...(await getFileBytes(EDITS_PACK_ID, path))!]).toEqual([...second]);

    const slot = useStore.getState().slots.find((s) => s.key === SWORD_KEY);
    expect(slot?.candidates.filter((c) => c.packId === EDITS_PACK_ID)).toHaveLength(1);
  });

  it('keeps edits for different slots side by side', async () => {
    await useStore.getState().saveEdit(SWORD_KEY, editedBytes, 16, 16);
    await useStore.getState().saveEdit('texture:block/red_wool', editedBytes, 16, 16);

    expect(await getFileIndex(EDITS_PACK_ID)).toHaveLength(2);
    expect(Object.keys(useStore.getState().picks).sort()).toEqual([
      'texture:block/red_wool',
      SWORD_KEY,
    ]);
  });
});
