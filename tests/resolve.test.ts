import { describe, expect, it } from 'vitest';
import {
  buildSlotIndex,
  differsAcrossPacks,
  isOverridden,
  orderCandidates,
  planExportPaths,
  resolveAll,
  resolveSlot,
  type IndexablePack,
} from '../src/core/resolve';
import { getVersion } from '../src/core/versions';

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
      legacyPack('a', { diamond_sword: 'h1', apple: 'h2' }),
      legacyPack('b', { diamond_sword: 'h3' }),
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

  /**
   * Era is a guess from the majority of a pack's paths. When it decided whether
   * to fold a name, a legacy-named file inside a pack read as modern became a
   * slot of its own - which then exported over the top of the real one.
   */
  it('folds a legacy name in a pack detected as modern onto the same slot', () => {
    const slots = buildSlotIndex([
      { id: 'old', era: 'legacy', files: [file('assets/minecraft/textures/blocks/wool_colored_red.png', 'h1')] },
      { id: 'new', era: 'modern', files: [file('assets/minecraft/textures/blocks/wool_colored_red.png', 'h2')] },
    ]);

    expect(slots).toHaveLength(1);
    expect(slots[0].key).toBe('texture:block/red_wool');
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

/**
 * Packs that support several game versions ship the same asset twice, under both
 * the pre- and post-Flattening spelling. Both files canonicalise to one slot, and
 * a candidate is identified by its pack everywhere downstream - so two candidates
 * from one pack means a chip that cannot be picked, a preview that ignores the
 * click, and a "differs across packs" flag raised by a pack differing from itself.
 */
describe('a pack that ships one asset twice', () => {
  const dualPack = (id: string, era: 'legacy' | 'modern', paths: string[]): IndexablePack => ({
    id,
    era,
    files: paths.map((p, i) => file(p, `h${i}`)),
  });

  const legacyPaths = [
    'assets/minecraft/textures/block/mossy_cobblestone.png',
    'assets/minecraft/textures/blocks/cobblestone_mossy.png',
  ];

  it('contributes one candidate, not one per file', () => {
    const [slot] = buildSlotIndex([dualPack('a', 'legacy', legacyPaths)]);

    expect(slot.key).toBe('texture:block/mossy_cobblestone');
    expect(slot.candidates).toHaveLength(1);
  });

  it('uses the spelling the pack\'s own game version reads', () => {
    // Listed modern-name-first, so first-seen order cannot be what picks it.
    const [legacy] = buildSlotIndex([dualPack('a', 'legacy', legacyPaths)]);
    expect(legacy.candidates[0].primaryPath)
      .toBe('assets/minecraft/textures/blocks/cobblestone_mossy.png');

    const [modern] = buildSlotIndex([dualPack('a', 'modern', legacyPaths)]);
    expect(modern.candidates[0].primaryPath)
      .toBe('assets/minecraft/textures/block/mossy_cobblestone.png');
  });

  it('records the copy it did not use', () => {
    const [slot] = buildSlotIndex([dualPack('a', 'legacy', legacyPaths)]);
    expect(slot.candidates[0].alternates?.map((a) => a.path))
      .toEqual(['assets/minecraft/textures/block/mossy_cobblestone.png']);
  });

  it('keeps each copy\'s .mcmeta with the copy it belongs to', () => {
    const [slot] = buildSlotIndex([{
      id: 'a',
      era: 'legacy',
      files: [
        file('assets/minecraft/textures/block/lava_still.png', 'h1'),
        file('assets/minecraft/textures/block/lava_still.png.mcmeta', 'h2'),
        file('assets/minecraft/textures/blocks/lava_still.png', 'h3'),
        file('assets/minecraft/textures/blocks/lava_still.png.mcmeta', 'h4'),
      ],
    }]);

    expect(slot.candidates[0].companions)
      .toEqual(['assets/minecraft/textures/blocks/lava_still.png.mcmeta']);
    expect(slot.candidates[0].alternates?.[0].companions)
      .toEqual(['assets/minecraft/textures/block/lava_still.png.mcmeta']);
  });

  it('is not counted as differing across packs', () => {
    const [slot] = buildSlotIndex([dualPack('a', 'legacy', legacyPaths)]);
    expect(differsAcrossPacks(slot)).toBe(false);
  });

  it('stays pickable: one chip per pack, and the pick is what resolves', () => {
    const slots = buildSlotIndex([
      dualPack('a', 'legacy', legacyPaths),
      dualPack('b', 'legacy', ['assets/minecraft/textures/blocks/cobblestone_mossy.png']),
    ]);
    const slot = slots[0];

    expect(slot.candidates.map((c) => c.packId)).toEqual(['a', 'b']);
    // The strip renders this list and the number keys index into it, so a pack
    // appearing twice there is a chip whose number picks the other one's file.
    expect(orderCandidates(slot, ['b', 'a']).map((c) => c.packId)).toEqual(['b', 'a']);
    expect(resolveSlot(slot, ['a', 'b'], { [slot.key]: 'b' })?.packId).toBe('b');
  });

  it('falls back to the first copy when neither spelling is the native one', () => {
    const [slot] = buildSlotIndex([dualPack('a', 'legacy', [
      // A legacy pack holding two modern-named copies: nothing matches 1.8's
      // spelling, so the file order in the zip decides.
      'assets/minecraft/textures/block/mossy_cobblestone.png',
      'assets/minecraft/textures/blocks/mossy_cobblestone.png',
    ])]);

    expect(slot.candidates).toHaveLength(1);
    expect(slot.candidates[0].primaryPath)
      .toBe('assets/minecraft/textures/block/mossy_cobblestone.png');
  });
});

describe('resolveSlot', () => {
  const slots = buildSlotIndex([
    legacyPack('a', { diamond_sword: 'h1' }),
    legacyPack('b', { diamond_sword: 'h2', apple: 'h3' }),
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
    legacyPack('a', { diamond_sword: 'h1' }),
    legacyPack('b', { diamond_sword: 'h2' }),
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

describe('planExportPaths', () => {
  const v189 = getVersion('1.8.9');

  it('gives every slot its own file when nothing clashes', () => {
    const { plan, conflicts } = planExportPaths(
      ['texture:item/golden_apple', 'texture:block/red_wool'],
      v189,
    );

    expect(conflicts).toEqual([]);
    expect(plan.get('texture:item/golden_apple'))
      .toBe('assets/minecraft/textures/items/apple_golden.png');
    expect(plan.get('texture:block/red_wool'))
      .toBe('assets/minecraft/textures/blocks/wool_colored_red.png');
  });

  it('gives a contested file to the asset whose name it is on that version', () => {
    // `smooth_stone_slab_side` is written as 1.8's `stone_slab_side`, which is
    // also what an unmapped slot of that name writes to.
    const keys = ['texture:block/stone_slab_side', 'texture:block/smooth_stone_slab_side'];
    const { plan, conflicts } = planExportPaths(keys, v189);

    expect(plan.get('texture:block/smooth_stone_slab_side'))
      .toBe('assets/minecraft/textures/blocks/stone_slab_side.png');
    expect(plan.has('texture:block/stone_slab_side')).toBe(false);
    expect(conflicts).toEqual([{
      outPath: 'assets/minecraft/textures/blocks/stone_slab_side.png',
      kept: 'texture:block/smooth_stone_slab_side',
      dropped: 'texture:block/stone_slab_side',
    }]);
  });

  it('settles it the same way whichever slot is seen first', () => {
    const forwards = planExportPaths(
      ['texture:block/stone_slab_side', 'texture:block/smooth_stone_slab_side'], v189,
    );
    const backwards = planExportPaths(
      ['texture:block/smooth_stone_slab_side', 'texture:block/stone_slab_side'], v189,
    );

    expect(backwards.plan).toEqual(forwards.plan);
    expect(backwards.conflicts[0].kept).toBe(forwards.conflicts[0].kept);
  });

  it('leaves both alone on a version where the names do not collide', () => {
    const { conflicts } = planExportPaths(
      ['texture:block/stone_slab_side', 'texture:block/smooth_stone_slab_side'],
      getVersion('1.20.1'),
    );
    expect(conflicts).toEqual([]);
  });
});

describe('resolveAll', () => {
  it('produces one winner per slot', () => {
    const slots = buildSlotIndex([
      legacyPack('a', { diamond_sword: 'h1', apple: 'h2' }),
      legacyPack('b', { diamond_sword: 'h3', bread: 'h4' }),
    ]);
    const resolved = resolveAll(slots, ['b', 'a'], { 'texture:item/diamond_sword': 'a' });

    expect(resolved.size).toBe(3);
    expect(resolved.get('texture:item/diamond_sword')?.packId).toBe('a');
    expect(resolved.get('texture:item/apple')?.packId).toBe('a');
    expect(resolved.get('texture:item/bread')?.packId).toBe('b');
  });
});
