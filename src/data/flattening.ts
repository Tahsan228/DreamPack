/**
 * The 1.13 "Flattening" rename table.
 *
 * Pre-1.13 packs name textures descriptively (`wool_colored_red`, `apple_golden`);
 * 1.13+ packs use registry names (`red_wool`, `golden_apple`). To let a 1.8.9 pack
 * and a 1.20 pack compete for the same slot, both sides normalise to the modern name.
 *
 * Every entry here is a rename that really happened. An invented one is worse than
 * a missing one: a missing entry leaves a texture under its own name, which is
 * always right for a same-era export, while an invented entry renames a texture on
 * the way out to something the game does not read, and it vanishes from the pack.
 * The tool entries were exactly that mistake - see the note on TOOL_MATERIALS.
 *
 * Coverage is complete for items and thorough for the blocks bedwars packs actually
 * touch. Anything absent falls through unchanged and gets flagged `unmapped` in the
 * UI — which is harmless for the common case of merging packs from the same era.
 *
 * Every entry must be a bijection: two legacy names may never map to one modern name,
 * or export would become ambiguous. `tests/flattening.test.ts` enforces this.
 */

/** 1.8 colour vocabulary. `silver` became `light_gray` in 1.13. */
const COLORS: Array<[legacy: string, modern: string]> = [
  ['white', 'white'],
  ['orange', 'orange'],
  ['magenta', 'magenta'],
  ['light_blue', 'light_blue'],
  ['yellow', 'yellow'],
  ['lime', 'lime'],
  ['pink', 'pink'],
  ['gray', 'gray'],
  ['silver', 'light_gray'],
  ['cyan', 'cyan'],
  ['purple', 'purple'],
  ['blue', 'blue'],
  ['brown', 'brown'],
  ['green', 'green'],
  ['red', 'red'],
  ['black', 'black'],
];

/**
 * 1.8 wood vocabulary for *block* textures, where dark oak is spelled `big_oak`.
 * Items and doors used other spellings (`darkoak`, `dark_oak`, `roofed_oak`) and
 * are listed out individually below rather than generated from this.
 */
const WOODS: Array<[legacy: string, modern: string]> = [
  ['oak', 'oak'],
  ['spruce', 'spruce'],
  ['birch', 'birch'],
  ['jungle', 'jungle'],
  ['acacia', 'acacia'],
  ['big_oak', 'dark_oak'],
];

/** Door textures, item and block alike, spell oak as `wood` and dark oak in full. */
const DOOR_WOODS: Array<[legacy: string, modern: string]> = [
  ['wood', 'oak'],
  ['spruce', 'spruce'],
  ['birch', 'birch'],
  ['jungle', 'jungle'],
  ['acacia', 'acacia'],
  ['dark_oak', 'dark_oak'],
];

/**
 * Tool materials. Only the words changed in 1.13: `wood` -> `wooden`,
 * `gold` -> `golden`. The order never did — 1.8.9 already spells these
 * `diamond_sword.png`, not `sword_diamond.png`.
 */
const TOOL_MATERIALS: Array<[legacy: string, modern: string]> = [
  ['wood', 'wooden'],
  ['stone', 'stone'],
  ['iron', 'iron'],
  ['gold', 'golden'],
  ['diamond', 'diamond'],
];

const TOOLS = ['sword', 'pickaxe', 'axe', 'shovel', 'hoe'];

const ARMOR_MATERIALS: Array<[legacy: string, modern: string]> = [
  ['leather', 'leather'],
  ['chainmail', 'chainmail'],
  ['iron', 'iron'],
  ['gold', 'golden'],
  ['diamond', 'diamond'],
];

const ARMOR_PIECES = ['helmet', 'chestplate', 'leggings', 'boots'];

function buildItemMap(): Record<string, string> {
  const m: Record<string, string> = {};

  /*
   * Tools: 1.8 `wood_sword` -> 1.13 `wooden_sword`.
   *
   * Only the material word moves. Four real 1.8.9 packs (Divine, VENOM, Whut,
   * Smoke) all ship `textures/items/diamond_sword.png`, `stone_axe.png`,
   * `gold_pickaxe.png` and so on, and not one of them contains a single
   * `sword_diamond.png`-style file. Listing a rename for stone, iron and diamond
   * renamed those textures on the way out to names the game never reads, so they
   * silently vanished from the exported pack.
   */
  for (const tool of TOOLS) {
    for (const [lm, mm] of TOOL_MATERIALS) {
      if (lm !== mm) m[`${lm}_${tool}`] = `${mm}_${tool}`;
    }
  }

  // Armor: only the gold -> golden rename actually moves.
  for (const piece of ARMOR_PIECES) {
    for (const [lm, mm] of ARMOR_MATERIALS) {
      if (lm !== mm) m[`${lm}_${piece}`] = `${mm}_${piece}`;
      if (lm === 'leather') m[`leather_${piece}_overlay`] = `leather_${piece}_overlay`;
    }
  }

  // 1.8.9 had a single `boat`; 1.9 split it per wood, spelling dark oak `darkoak`.
  m['boat'] = 'oak_boat';
  for (const [lw, mw] of [
    ['spruce', 'spruce'], ['birch', 'birch'], ['jungle', 'jungle'],
    ['acacia', 'acacia'], ['darkoak', 'dark_oak'],
  ] as const) {
    m[`boat_${lw}`] = `${mw}_boat`;
  }

  for (const [lw, mw] of DOOR_WOODS) {
    m[`door_${lw}`] = `${mw}_door`;
  }
  m['door_iron'] = 'iron_door';
  m['sign'] = 'oak_sign';

  // Raw/cooked foods flipped word order and dropped the `raw` marker.
  const FOODS: Array<[string, string, string]> = [
    ['beef', 'beef', 'cooked_beef'],
    ['chicken', 'chicken', 'cooked_chicken'],
    ['porkchop', 'porkchop', 'cooked_porkchop'],
    ['mutton', 'mutton', 'cooked_mutton'],
    ['rabbit', 'rabbit', 'cooked_rabbit'],
  ];
  for (const [base, rawName, cookedName] of FOODS) {
    m[`${base}_raw`] = rawName;
    m[`${base}_cooked`] = cookedName;
  }

  // Fish became individual items in 1.13.
  Object.assign(m, {
    fish_cod_raw: 'cod',
    fish_cod_cooked: 'cooked_cod',
    fish_salmon_raw: 'salmon',
    fish_salmon_cooked: 'cooked_salmon',
    fish_clownfish_raw: 'tropical_fish',
    fish_pufferfish_raw: 'pufferfish',
  });

  // Music discs.
  for (const disc of [
    '13', 'cat', 'blocks', 'chirp', 'far', 'mall',
    'mellohi', 'stal', 'strad', 'ward', '11', 'wait',
  ]) {
    m[`record_${disc}`] = `music_disc_${disc}`;
  }

  // Minecarts.
  Object.assign(m, {
    minecart_normal: 'minecart',
    minecart_chest: 'chest_minecart',
    minecart_furnace: 'furnace_minecart',
    minecart_tnt: 'tnt_minecart',
    minecart_hopper: 'hopper_minecart',
    minecart_command_block: 'command_block_minecart',
  });

  // Dyes split into separate items. Four are special-cased; the rest are `<color>_dye`.
  const DYE_SPECIAL: Record<string, string> = {
    black: 'ink_sac',
    white: 'bone_meal',
    blue: 'lapis_lazuli',
    brown: 'cocoa_beans',
  };
  for (const [lc, mc] of COLORS) {
    m[`dye_powder_${lc}`] = DYE_SPECIAL[lc] ?? `${mc}_dye`;
  }

  // Everything else that changed name, one by one.
  Object.assign(m, {
    apple_golden: 'golden_apple',
    carrot_golden: 'golden_carrot',
    potato_baked: 'baked_potato',
    potato_poisonous: 'poisonous_potato',
    melon: 'melon_slice',
    melon_speckled: 'glistering_melon_slice',
    book_normal: 'book',
    book_enchanted: 'enchanted_book',
    book_writable: 'writable_book',
    book_written: 'written_book',
    bow_standby: 'bow',
    bucket_empty: 'bucket',
    bucket_water: 'water_bucket',
    bucket_lava: 'lava_bucket',
    bucket_milk: 'milk_bucket',
    redstone_dust: 'redstone',
    spider_eye_fermented: 'fermented_spider_eye',
    seeds_wheat: 'wheat_seeds',
    seeds_melon: 'melon_seeds',
    seeds_pumpkin: 'pumpkin_seeds',
    seeds_beetroot: 'beetroot_seeds',
    reeds: 'sugar_cane',
    map_empty: 'map',
    map_filled: 'filled_map',
    fishing_rod_uncast: 'fishing_rod',
    netherbrick: 'nether_brick',
    gold_horse_armor: 'golden_horse_armor',
    potion_bottle_drinkable: 'potion',
    potion_bottle_splash: 'splash_potion',
    potion_bottle_lingering: 'lingering_potion',
    potion_bottle_empty: 'glass_bottle',
    fireworks: 'firework_rocket',
    fireworks_charge: 'firework_star',
    fireworks_charge_overlay: 'firework_star_overlay',
    bed: 'red_bed',
    ender_eye: 'ender_eye',
    dragon_breath: 'dragon_breath',
    chorus_fruit_popped: 'popped_chorus_fruit',
  });

  return m;
}

function buildBlockMap(): Record<string, string> {
  const m: Record<string, string> = {};

  for (const [lc, mc] of COLORS) {
    m[`wool_colored_${lc}`] = `${mc}_wool`;
    m[`hardened_clay_stained_${lc}`] = `${mc}_terracotta`;
    m[`glass_${lc}`] = `${mc}_stained_glass`;
    m[`glass_pane_top_${lc}`] = `${mc}_stained_glass_pane_top`;
  }

  for (const [lw, mw] of WOODS) {
    m[`planks_${lw}`] = `${mw}_planks`;
    m[`log_${lw}`] = `${mw}_log`;
    m[`log_${lw}_top`] = `${mw}_log_top`;
    m[`leaves_${lw}`] = `${mw}_leaves`;
  }

  // Saplings break the `big_oak` pattern: 1.8 calls the dark oak one `roofed_oak`.
  for (const [lw, mw] of [
    ['oak', 'oak'], ['spruce', 'spruce'], ['birch', 'birch'],
    ['jungle', 'jungle'], ['acacia', 'acacia'], ['roofed_oak', 'dark_oak'],
  ] as const) {
    m[`sapling_${lw}`] = `${mw}_sapling`;
  }

  for (const [lw, mw] of DOOR_WOODS) {
    m[`door_${lw}_lower`] = `${mw}_door_bottom`;
    m[`door_${lw}_upper`] = `${mw}_door_top`;
  }
  m['door_iron_lower'] = 'iron_door_bottom';
  m['door_iron_upper'] = 'iron_door_top';

  Object.assign(m, {
    // Bedwars staples.
    hardened_clay: 'terracotta',
    end_stone: 'end_stone',
    web: 'cobweb',
    ice_packed: 'packed_ice',

    // Sandstone family.
    sandstone_normal: 'sandstone',
    sandstone_carved: 'chiseled_sandstone',
    sandstone_smooth: 'cut_sandstone',
    red_sandstone_normal: 'red_sandstone',
    red_sandstone_carved: 'chiseled_red_sandstone',
    red_sandstone_smooth: 'cut_red_sandstone',

    // Stone family.
    stonebrick: 'stone_bricks',
    stonebrick_carved: 'chiseled_stone_bricks',
    stonebrick_cracked: 'cracked_stone_bricks',
    stonebrick_mossy: 'mossy_stone_bricks',
    cobblestone_mossy: 'mossy_cobblestone',
    brick: 'bricks',
    stone_andesite: 'andesite',
    stone_andesite_smooth: 'polished_andesite',
    stone_diorite: 'diorite',
    stone_diorite_smooth: 'polished_diorite',
    stone_granite: 'granite',
    stone_granite_smooth: 'polished_granite',
    stone_slab_side: 'smooth_stone_slab_side',
    stone_slab_top: 'smooth_stone',

    // Grass / dirt.
    grass_top: 'grass_block_top',
    grass_side: 'grass_block_side',
    grass_side_overlay: 'grass_block_side_overlay',
    grass_side_snowed: 'grass_block_snow',
    dirt_podzol_top: 'podzol_top',
    dirt_podzol_side: 'podzol_side',
    mycelium_top: 'mycelium_top',
    mycelium_side: 'mycelium_side',

    // Quartz.
    quartz_block_chiseled: 'chiseled_quartz_block',
    quartz_block_chiseled_top: 'chiseled_quartz_block_top',
    quartz_block_lines: 'quartz_pillar',
    quartz_block_lines_top: 'quartz_pillar_top',
    quartz_ore: 'nether_quartz_ore',

    // Machines and utility blocks.
    furnace_front_off: 'furnace_front',
    furnace_front_on: 'furnace_front_on',
    dispenser_front_horizontal: 'dispenser_front',
    dropper_front_horizontal: 'dropper_front',
    trapdoor: 'oak_trapdoor',
    anvil_base: 'anvil',
    anvil_top_damaged_0: 'anvil_top',
    enchanting_table_top: 'enchanting_table_top',
    noteblock: 'note_block',
    redstone_lamp_off: 'redstone_lamp',
    redstone_lamp_on: 'redstone_lamp_on',
    redstone_torch_off: 'redstone_torch_off',
    redstone_torch_on: 'redstone_torch',
    torch_on: 'torch',
    lever: 'lever',
    hopper_outside: 'hopper_outside',
    beacon: 'beacon',

    // Environment.
    portal: 'nether_portal',
    fire_layer_0: 'fire_0',
    fire_layer_1: 'fire_1',
    mushroom_brown: 'brown_mushroom',
    mushroom_red: 'red_mushroom',
    deadbush: 'dead_bush',
    tallgrass: 'grass',
    waterlily: 'lily_pad',
    pumpkin_face_off: 'carved_pumpkin',
    pumpkin_face_on: 'jack_o_lantern',
    melon_side: 'melon_side',
    snow: 'snow',
    lava_flow: 'lava_flow',
    lava_still: 'lava_still',
    water_flow: 'water_flow',
    water_still: 'water_still',

    // Ores kept their names, but the redstone/lit variants moved.
    redstone_ore: 'redstone_ore',
    lit_redstone_ore: 'redstone_ore_on',

    // Rails.
    rail_normal: 'rail',
    rail_normal_turned: 'rail_corner',
    rail_golden: 'powered_rail',
    rail_golden_powered: 'powered_rail_on',
    rail_detector: 'detector_rail',
    rail_activator: 'activator_rail',
  });

  return m;
}

export const ITEM_LEGACY_TO_MODERN: Readonly<Record<string, string>> = buildItemMap();
export const BLOCK_LEGACY_TO_MODERN: Readonly<Record<string, string>> = buildBlockMap();

/**
 * Alternative legacy spellings, recognised on import but never chosen on export.
 *
 * Some names changed *within* the legacy era — 1.8.9 has one `boat`, while 1.9
 * through 1.12 have `boat_oak`. Both should land on the same slot, but only one
 * can be written back out, and for a 1.8.9 target that is the name in the main
 * table above. Keeping these separate leaves that table a clean bijection.
 */
export const ITEM_ALIASES: Readonly<Record<string, string>> = {
  boat_oak: 'oak_boat',
  fish_raw: 'cod',
  fish_cooked: 'cooked_cod',
  speckled_melon: 'glistering_melon_slice',
};

export const BLOCK_ALIASES: Readonly<Record<string, string>> = {
  // 1.13 renamed the smooth-stone slab texture; 1.8's `stone_slab_side` is primary.
  stone_slab_side_smooth: 'smooth_stone_slab_side',
};

function invert(map: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [legacy, modern] of Object.entries(map)) {
    // First writer wins so the table order above defines the canonical inverse.
    if (!(modern in out)) out[modern] = legacy;
  }
  return out;
}

export const ITEM_MODERN_TO_LEGACY: Readonly<Record<string, string>> = invert(
  ITEM_LEGACY_TO_MODERN as Record<string, string>,
);
export const BLOCK_MODERN_TO_LEGACY: Readonly<Record<string, string>> = invert(
  BLOCK_LEGACY_TO_MODERN as Record<string, string>,
);
