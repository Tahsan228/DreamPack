import { describe, expect, it } from 'vitest';
import {
  buildSlotIndex,
  differsAcrossPacks,
  isOverridden,
  resolveAll,
  resolveSlot,
  type IndexablePack,
} from '../src/core/resolve';

const file = (path: string, hash: string, size = 300) => ({ path, size, hash });

const legacyPack = (id: string, hashes: Record<string, string>): IndexablePack => ({
  id,
  era: 'legacy',
  files: Object.entries(hashes).map(([name, hash]) =>
    file(`assets/minecraft/textures/items/${name}.png`, hash),
  ),
});

describe('buildSlotIndex', () => {
  it('unions packs onto shared slots', () => {
    const slots = buildSlotIndex([
      legacyPack('a', { sword_diamond: 'h1', apple: 'h2' }),
      legacyPack('b', { sword_diamond: 'h3' }),
    ]);

    const sword = slots.find((s) => s.key === 'texture:item/diamond_sword');
    expect(sword?.candidates.map((c) => c.packId)).toEqual(['a', 'b']);
    expect(slots.find((s) => s.key === 'texture:item/apple')?.candidates).toHaveLength(1);
  });

  it('matches a legacy asset against its modern counterpart', () => {
    const slots = buildSlotIndex([
      { id: 'old', era: 'legacy', files: [file('assets/minecraft/textures/items/apple_golden.png', 'h1')] },
      { id: 'new', era: 'modern', files: [file('assets/minecraft/textures/item/golden_apple.png', 'h2')] },
    ]);

    expect(slots).toHaveLength(1);
    expect(slots[0].key).toBe('texture:item/golden_apple');
    expect(slots[0].candidates.map((c) => c.packId)).toEqual(['old', 'new']);
  });

  it('attaches .mcmeta files to their texture as companions', () => {
    const slots = buildSlotIndex([
      {
        id: 'a',
        era: 'legacy',
        files: [
          file('assets/minecraft/textures/blocks/water_still.png', 'h1'),
          file('assets/minecraft/textures/blocks/water_still.png.mcmeta', 'h2'),
        ],
      },
    ]);

    expect(slots).toHaveLength(1);
    expect(slots[0].candidates[0].companions).toEqual([
      'assets/minecraft/textures/blocks/water_still.png.mcmeta',
    ]);
  });
});

describe('resolveSlot', () => {
  const slots = buildSlotIndex([
    legacyPack('a', { sword_diamond: 'h1' }),
    legacyPack('b', { sword_diamond: 'h2', apple: 'h3' }),
  ]);
  const sword = slots.find((s) => s.key === 'texture:item/diamond_sword')!;
  const apple = slots.find((s) => s.key === 'texture:item/apple')!;

  it('follows the priority order when nothing is picked', () => {
    expect(resolveSlot(sword, ['a', 'b'], {})?.packId).toBe('a');
    expect(resolveSlot(sword, ['b', 'a'], {})?.packId).toBe('b');
  });

  it('falls through the priority list for gaps', () => {
    expect(resolveSlot(apple, ['a', 'b'], {})?.packId).toBe('b');
  });

  it('lets an explicit pick beat the priority order', () => {
    expect(resolveSlot(sword, ['a', 'b'], { [sword.key]: 'b' })?.packId).toBe('b');
  });

  it('ignores a pick pointing at a pack that no longer has the asset', () => {
    expect(resolveSlot(apple, ['a', 'b'], { [apple.key]: 'a' })?.packId).toBe('b');
  });
});

describe('isOverridden', () => {
  const slots = buildSlotIndex([
    legacyPack('a', { sword_diamond: 'h1' }),
    legacyPack('b', { sword_diamond: 'h2' }),
  ]);
  const sword = slots[0];

  it('is false without a pick', () => {
    expect(isOverridden(sword, ['a', 'b'], {})).toBe(false);
  });

  it('is false when the pick agrees with priority', () => {
    expect(isOverridden(sword, ['a', 'b'], { [sword.key]: 'a' })).toBe(false);
  });

  it('is true when the pick differs from priority', () => {
    expect(isOverridden(sword, ['a', 'b'], { [sword.key]: 'b' })).toBe(true);
  });
});

describe('differsAcrossPacks', () => {
  it('is false for a single pack', () => {
    const [slot] = buildSlotIndex([legacyPack('a', { apple: 'h1' })]);
    expect(differsAcrossPacks(slot)).toBe(false);
  });

  it('is false when every pack ships identical bytes', () => {
    const [slot] = buildSlotIndex([
      legacyPack('a', { apple: 'same' }),
      legacyPack('b', { apple: 'same' }),
    ]);
    expect(differsAcrossPacks(slot)).toBe(false);
  });

  it('is true when the bytes differ', () => {
    const [slot] = buildSlotIndex([
      legacyPack('a', { apple: 'h1' }),
      legacyPack('b', { apple: 'h2' }),
    ]);
    expect(differsAcrossPacks(slot)).toBe(true);
  });
});

describe('resolveAll', () => {
  it('produces one winner per slot', () => {
    const slots = buildSlotIndex([
      legacyPack('a', { sword_diamond: 'h1', apple: 'h2' }),
      legacyPack('b', { sword_diamond: 'h3', bread: 'h4' }),
    ]);
    const resolved = resolveAll(slots, ['b', 'a'], { 'texture:item/diamond_sword': 'a' });

    expect(resolved.size).toBe(3);
    expect(resolved.get('texture:item/diamond_sword')?.packId).toBe('a');
    expect(resolved.get('texture:item/apple')?.packId).toBe('a');
    expect(resolved.get('texture:item/bread')?.packId).toBe('b');
  });
});
