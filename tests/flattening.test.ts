import { describe, expect, it } from 'vitest';
import {
  BLOCK_ALIASES,
  BLOCK_LEGACY_TO_MODERN,
  BLOCK_MODERN_TO_LEGACY,
  ITEM_ALIASES,
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
    expect(ITEM_LEGACY_TO_MODERN['wood_sword']).toBe('wooden_sword');
    expect(ITEM_LEGACY_TO_MODERN['gold_pickaxe']).toBe('golden_pickaxe');
    expect(ITEM_LEGACY_TO_MODERN['gold_chestplate']).toBe('golden_chestplate');
    expect(ITEM_LEGACY_TO_MODERN['apple_golden']).toBe('golden_apple');
    expect(ITEM_LEGACY_TO_MODERN['bow_standby']).toBe('bow');
    expect(ITEM_LEGACY_TO_MODERN['potion_bottle_splash']).toBe('splash_potion');
  });

  /**
   * A path's identity does not depend on which era its pack was detected as, so
   * the pre-Flattening spelling is always folded. A legacy name that is also some
   * *other* asset's modern name would therefore redirect a correct modern file
   * into the wrong slot. Names spelled the same on both sides (end_stone) are the
   * only overlap allowed.
   */
  it("never uses one asset's modern name as another's legacy name", () => {
    const tables: Array<[Readonly<Record<string, string>>, Readonly<Record<string, string>>, string]> = [
      [ITEM_LEGACY_TO_MODERN, ITEM_ALIASES, 'items'],
      [BLOCK_LEGACY_TO_MODERN, BLOCK_ALIASES, 'blocks'],
    ];

    for (const [main, aliases, label] of tables) {
      const modernNames = new Set(Object.values(main));
      for (const [legacy, modern] of Object.entries(main)) {
        if (!modernNames.has(legacy)) continue;
        expect(modern, `${label}: "${legacy}" is also a modern name, but maps to "${modern}"`)
          .toBe(legacy);
      }
      for (const legacy of Object.keys(aliases)) {
        expect(modernNames.has(legacy), `${label}: alias "${legacy}" is also a modern name`)
          .toBe(false);
      }
    }
  });

  it('leaves already-modern armor names out of the table', () => {
    // diamond_helmet is spelled the same on both sides, so it must not be listed.
    expect(ITEM_LEGACY_TO_MODERN['diamond_helmet']).toBeUndefined();
    expect(ITEM_LEGACY_TO_MODERN['iron_boots']).toBeUndefined();
  });

  /**
   * 1.8.9 spells a tool material-first, exactly as 1.13 does. Only the material
   * word changed.
   *
   * Four real 1.8.9 packs - Divine 32x, VENOM, Whut and Smoke - ship all 25 tool
   * textures as `<material>_<tool>.png`, and between them not one file named
   * `sword_diamond.png` or `wooden_sword.png`. Inventing a rename for stone, iron
   * and diamond renamed those textures on the way out to names 1.8.9 does not
   * read: the sword you picked simply was not in the exported pack.
   */
  it('renames only the tool material, never the word order', () => {
    for (const tool of ['sword', 'pickaxe', 'axe', 'shovel', 'hoe']) {
      expect(ITEM_LEGACY_TO_MODERN[`wood_${tool}`]).toBe(`wooden_${tool}`);
      expect(ITEM_LEGACY_TO_MODERN[`gold_${tool}`]).toBe(`golden_${tool}`);

      // These three are spelled the same on both sides and must pass through.
      for (const material of ['stone', 'iron', 'diamond']) {
        expect(ITEM_LEGACY_TO_MODERN[`${material}_${tool}`]).toBeUndefined();
        expect(ITEM_MODERN_TO_LEGACY[`${material}_${tool}`]).toBeUndefined();
      }

      // The invented spelling must not come back.
      for (const material of ['wood', 'gold', 'stone', 'iron', 'diamond']) {
        expect(ITEM_LEGACY_TO_MODERN[`${tool}_${material}`]).toBeUndefined();
      }
    }
  });
});
