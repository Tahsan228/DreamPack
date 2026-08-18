import { describe, expect, it } from 'vitest';
import { canonicalize, denormalize, humanize, parseKey } from '../src/core/canonical';
import { getVersion } from '../src/core/versions';

const v189 = getVersion('1.8.9');
const v1201 = getVersion('1.20.1');

describe('canonicalize', () => {
  it('collapses a legacy and a modern path for the same item onto one key', () => {
    const legacy = canonicalize('assets/minecraft/textures/items/apple_golden.png');
    const modern = canonicalize('assets/minecraft/textures/item/golden_apple.png');

    expect(legacy?.key).toBe('texture:item/golden_apple');
    expect(modern?.key).toBe('texture:item/golden_apple');
    expect(legacy?.category).toBe('Items');
    expect(legacy?.displayName).toBe('Golden Apple');
  });

  it('collapses legacy and modern block paths onto one key', () => {
    expect(canonicalize('assets/minecraft/textures/blocks/wool_colored_red.png')?.key)
      .toBe('texture:block/red_wool');
    expect(canonicalize('assets/minecraft/textures/block/red_wool.png')?.key)
      .toBe('texture:block/red_wool');
  });

  it('maps 1.8 silver to modern light_gray', () => {
    expect(canonicalize('assets/minecraft/textures/blocks/wool_colored_silver.png')?.key)
      .toBe('texture:block/light_gray_wool');
  });

  /**
   * 1.8.9 already puts the material first, so only `wood` and `gold` move. Real
   * 1.8.9 packs ship `diamond_sword.png`; treating that as a modern-only name
   * meant exporting it as `sword_diamond.png`, which the game does not read.
   */
  it('renames only the tool material', () => {
    expect(canonicalize('assets/minecraft/textures/items/diamond_sword.png')?.key)
      .toBe('texture:item/diamond_sword');
    expect(canonicalize('assets/minecraft/textures/items/wood_pickaxe.png')?.key)
      .toBe('texture:item/wooden_pickaxe');
    expect(canonicalize('assets/minecraft/textures/items/gold_axe.png')?.key)
      .toBe('texture:item/golden_axe');
    expect(canonicalize('assets/minecraft/textures/items/stone_shovel.png')?.key)
      .toBe('texture:item/stone_shovel');
  });

  it('categorises non-item paths without renaming them', () => {
    expect(canonicalize('assets/minecraft/textures/gui/icons.png')).toMatchObject({
      key: 'texture:gui/icons',
      category: 'GUI',
    });
    expect(canonicalize('assets/minecraft/textures/models/armor/diamond_layer_1.png'))
      .toMatchObject({ key: 'texture:models/armor/diamond_layer_1', category: 'Armor' });
    expect(canonicalize('assets/minecraft/textures/entity/creeper/creeper.png'))
      .toMatchObject({ category: 'Entities' });
    expect(canonicalize('assets/minecraft/textures/particle/particles.png'))
      .toMatchObject({ category: 'Particles' });
    expect(canonicalize('assets/minecraft/textures/environment/sun.png'))
      .toMatchObject({ category: 'Environment' });
  });

  it('handles sounds, models and CIT', () => {
    expect(canonicalize('assets/minecraft/sounds/random/click.ogg')).toMatchObject({
      key: 'sound:random/click',
      category: 'Sounds',
    });
    expect(canonicalize('assets/minecraft/models/item/diamond_sword.json')).toMatchObject({
      key: 'model:item/diamond_sword',
      category: 'Models',
    });
    expect(canonicalize('assets/minecraft/optifine/cit/swords/gen.properties'))
      .toMatchObject({ key: 'cit:swords/gen', category: 'CIT' });
  });

  it('folds the old mcpatcher directory into optifine so CIT files stay together', () => {
    expect(canonicalize('assets/minecraft/mcpatcher/cit/gen.properties')?.key)
      .toBe('cit:gen');
    expect(canonicalize('assets/minecraft/mcpatcher/cit/gen.png')?.key)
      .toBe('other:optifine/cit/gen.png');
  });

  it('rejects things that are not pickable assets', () => {
    expect(canonicalize('pack.mcmeta')).toBeNull();
    expect(canonicalize('pack.png')).toBeNull();
    expect(canonicalize('assets/minecraft/sounds.json')).toBeNull();
    expect(canonicalize('assets/minecraft/textures/items/apple.png.mcmeta')).toBeNull();
    expect(canonicalize('README.txt')).toBeNull();
    expect(canonicalize('assets/minecraft/textures/items/')).toBeNull();
  });

  it('keeps non-minecraft namespaces distinct', () => {
    const result = canonicalize('assets/mypack/textures/item/thing.png');
    expect(result?.key).toBe('texture:@mypack/item/thing');
    expect(parseKey(result!.key)).toMatchObject({ namespace: 'mypack', sub: 'item/thing' });
  });
});

describe('denormalize', () => {
  it('writes 1.8.9 paths with legacy directories and names', () => {
    expect(denormalize('texture:item/golden_apple', v189))
      .toBe('assets/minecraft/textures/items/apple_golden.png');
    // The sword keeps its name across the Flattening; only the directory moves.
    expect(denormalize('texture:item/diamond_sword', v189))
      .toBe('assets/minecraft/textures/items/diamond_sword.png');
    expect(denormalize('texture:item/wooden_sword', v189))
      .toBe('assets/minecraft/textures/items/wood_sword.png');
    expect(denormalize('texture:block/red_wool', v189))
      .toBe('assets/minecraft/textures/blocks/wool_colored_red.png');
    expect(denormalize('texture:block/light_gray_wool', v189))
      .toBe('assets/minecraft/textures/blocks/wool_colored_silver.png');
  });

  it('writes modern paths unchanged', () => {
    expect(denormalize('texture:item/golden_apple', v1201))
      .toBe('assets/minecraft/textures/item/golden_apple.png');
    expect(denormalize('texture:block/red_wool', v1201))
      .toBe('assets/minecraft/textures/block/red_wool.png');
  });

  it('leaves stable paths alone in both eras', () => {
    expect(denormalize('texture:gui/icons', v189)).toBe('assets/minecraft/textures/gui/icons.png');
    expect(denormalize('texture:gui/icons', v1201)).toBe('assets/minecraft/textures/gui/icons.png');
  });

  it('restores sounds, models, CIT and passthrough files', () => {
    expect(denormalize('sound:random/click', v189)).toBe('assets/minecraft/sounds/random/click.ogg');
    expect(denormalize('model:item/diamond_sword', v189))
      .toBe('assets/minecraft/models/item/diamond_sword.json');
    expect(denormalize('cit:swords/gen', v189))
      .toBe('assets/minecraft/optifine/cit/swords/gen.properties');
    expect(denormalize('other:optifine/cit/gen.png', v189))
      .toBe('assets/minecraft/optifine/cit/gen.png');
  });

  it('restores namespaced keys', () => {
    expect(denormalize('texture:@mypack/item/thing', v1201))
      .toBe('assets/mypack/textures/item/thing.png');
  });
});

describe('round trip', () => {
  const paths = [
    'assets/minecraft/textures/items/apple_golden.png',
    'assets/minecraft/textures/items/diamond_sword.png',
    'assets/minecraft/textures/items/wood_sword.png',
    'assets/minecraft/textures/items/gold_pickaxe.png',
    'assets/minecraft/textures/items/bow_standby.png',
    'assets/minecraft/textures/blocks/wool_colored_silver.png',
    'assets/minecraft/textures/blocks/hardened_clay_stained_blue.png',
    'assets/minecraft/textures/blocks/planks_big_oak.png',
    'assets/minecraft/textures/gui/widgets.png',
    'assets/minecraft/textures/entity/creeper/creeper.png',
    'assets/minecraft/sounds/mob/enderman/portal.ogg',
  ];

  it('legacy path -> key -> legacy path is identity', () => {
    for (const path of paths) {
      const canon = canonicalize(path);
      expect(canon, path).not.toBeNull();
      expect(denormalize(canon!.key, v189), path).toBe(path);
    }
  });
});

describe('humanize', () => {
  it('turns file names into readable labels', () => {
    expect(humanize('golden_apple')).toBe('Golden Apple');
    expect(humanize('bow_pulling_0')).toBe('Bow Pulling 0');
    expect(humanize('models/armor/diamond_layer_1')).toBe('Diamond Layer 1');
  });
});
