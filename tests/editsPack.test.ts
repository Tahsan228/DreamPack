import { describe, expect, it } from 'vitest';
import { createEditsPack, editStoragePath, EDITS_PACK_ID, isEditsPack } from '../src/core/editsPack';
import { canonicalize, denormalize } from '../src/core/canonical';
import { buildSlotIndex, resolveSlot } from '../src/core/resolve';
import { getVersion } from '../src/core/versions';

describe('edits pack storage paths', () => {
  /**
   * The whole design rests on this: an edit saved for a slot must canonicalise
   * back to that exact slot, or the edit would land on the wrong texture.
   */
  const keys = [
    'texture:item/golden_apple',
    'texture:item/diamond_sword',
    'texture:block/red_wool',
    'texture:block/light_gray_wool',
    'texture:gui/icons',
    'texture:models/armor/diamond_layer_1',
    'texture:entity/creeper/creeper',
    'texture:@mypack/item/thing',
  ];

  it('round-trips every kind of key back to itself', () => {
    for (const key of keys) {
      const path = editStoragePath(key);
      expect(path, key).not.toBeNull();
      expect(canonicalize(path!, 'modern')?.key, key).toBe(key);
    }
  });

  it('stores under modern names regardless of the export target', () => {
    expect(editStoragePath('texture:item/golden_apple'))
      .toBe('assets/minecraft/textures/item/golden_apple.png');
    expect(editStoragePath('texture:block/red_wool'))
      .toBe('assets/minecraft/textures/block/red_wool.png');
  });

  it('is a modern-era pack, so its own paths canonicalise correctly', () => {
    expect(createEditsPack().era).toBe('modern');
    expect(isEditsPack(EDITS_PACK_ID)).toBe(true);
    expect(isEditsPack('something-else')).toBe(false);
  });
});

describe('an edit flowing through resolve and export', () => {
  const editPath = editStoragePath('texture:item/diamond_sword')!;

  const slots = buildSlotIndex([
    {
      id: 'pack-a',
      era: 'legacy',
      files: [{ path: 'assets/minecraft/textures/items/sword_diamond.png', size: 300, hash: 'h1' }],
    },
    {
      id: EDITS_PACK_ID,
      era: 'modern',
      files: [{ path: editPath, size: 320, hash: 'edited' }],
    },
  ]);

  it('competes for the same slot as the pack it was painted over', () => {
    expect(slots).toHaveLength(1);
    expect(slots[0].key).toBe('texture:item/diamond_sword');
    expect(slots[0].candidates.map((c) => c.packId)).toEqual(['pack-a', EDITS_PACK_ID]);
  });

  it('wins once the edit pins the slot', () => {
    const winner = resolveSlot(slots[0], ['pack-a', EDITS_PACK_ID], {
      'texture:item/diamond_sword': EDITS_PACK_ID,
    });
    expect(winner?.packId).toBe(EDITS_PACK_ID);
    expect(winner?.primaryPath).toBe(editPath);
  });

  it('exports a modern-stored edit under the 1.8.9 filename', () => {
    expect(denormalize(slots[0].key, getVersion('1.8.9')))
      .toBe('assets/minecraft/textures/items/sword_diamond.png');
  });

  it('exports the same edit under the modern filename for a 1.20 target', () => {
    expect(denormalize(slots[0].key, getVersion('1.20.1')))
      .toBe('assets/minecraft/textures/item/diamond_sword.png');
  });
});
