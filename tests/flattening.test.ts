import { describe, expect, it } from 'vitest';
import {
  BLOCK_LEGACY_TO_MODERN,
  BLOCK_MODERN_TO_LEGACY,
  ITEM_LEGACY_TO_MODERN,
  ITEM_MODERN_TO_LEGACY,
} from '../src/data/flattening';

/**
 * The table must be a bijection. If two legacy names collapsed onto one modern
 * name, export could not decide which file to write for a 1.8.9 target.
 */
function expectBijection(map: Readonly<Record<string, string>>, label: string) {
  const seen = new Map<string, string>();
  for (const [legacy, modern] of Object.entries(map)) {
    const previous = seen.get(modern);
    expect(previous, `${label}: "${previous}" and "${legacy}" both map to "${modern}"`).toBeUndefined();
    seen.set(modern, legacy);
  }
}

describe('flattening table', () => {
  it('maps each item name to a unique modern name', () => {
    expectBijection(ITEM_LEGACY_TO_MODERN, 'items');
  });

  it('maps each block name to a unique modern name', () => {
    expectBijection(BLOCK_LEGACY_TO_MODERN, 'blocks');
  });

  it('inverts exactly for items', () => {
    for (const [legacy, modern] of Object.entries(ITEM_LEGACY_TO_MODERN)) {
      expect(ITEM_MODERN_TO_LEGACY[modern], `${legacy} -> ${modern}`).toBe(legacy);
    }
  });

  it('inverts exactly for blocks', () => {
    for (const [legacy, modern] of Object.entries(BLOCK_LEGACY_TO_MODERN)) {
      expect(BLOCK_MODERN_TO_LEGACY[modern], `${legacy} -> ${modern}`).toBe(legacy);
    }
  });

  it('covers the bedwars staples', () => {
    // Wool and clay in every colour — the blocks bedwars packs reskin most.
    for (const color of ['white', 'red', 'blue', 'green', 'yellow', 'pink', 'cyan', 'black']) {
      expect(BLOCK_LEGACY_TO_MODERN[`wool_colored_${color}`]).toBe(`${color}_wool`);
      expect(BLOCK_LEGACY_TO_MODERN[`hardened_clay_stained_${color}`]).toBe(`${color}_terracotta`);
      expect(BLOCK_LEGACY_TO_MODERN[`glass_${color}`]).toBe(`${color}_stained_glass`);
    }

    expect(BLOCK_LEGACY_TO_MODERN['end_stone']).toBe('end_stone');
    expect(BLOCK_LEGACY_TO_MODERN['planks_oak']).toBe('oak_planks');
    expect(BLOCK_LEGACY_TO_MODERN['ladder']).toBeUndefined(); // unchanged, passes through

    // Weapons, armor and the shop items.
    expect(ITEM_LEGACY_TO_MODERN['sword_diamond']).toBe('diamond_sword');
    expect(ITEM_LEGACY_TO_MODERN['sword_wood']).toBe('wooden_sword');
    expect(ITEM_LEGACY_TO_MODERN['pickaxe_gold']).toBe('golden_pickaxe');
    expect(ITEM_LEGACY_TO_MODERN['gold_chestplate']).toBe('golden_chestplate');
    expect(ITEM_LEGACY_TO_MODERN['apple_golden']).toBe('golden_apple');
    expect(ITEM_LEGACY_TO_MODERN['bow_standby']).toBe('bow');
    expect(ITEM_LEGACY_TO_MODERN['potion_bottle_splash']).toBe('splash_potion');
  });

  it('leaves already-modern armor names out of the table', () => {
    // diamond_helmet is spelled the same on both sides, so it must not be listed.
    expect(ITEM_LEGACY_TO_MODERN['diamond_helmet']).toBeUndefined();
    expect(ITEM_LEGACY_TO_MODERN['iron_boots']).toBeUndefined();
  });
});
