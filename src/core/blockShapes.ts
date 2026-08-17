/**
 * What solid to wrap a texture around in the 3D preview.
 *
 * Most block textures belong on a cube, but plenty do not: a bed is nine
 * sixteenths tall, a sapling is two crossed sheets, a door is a thin panel. Put
 * those on a full cube and the preview is actively misleading.
 *
 * Detection runs on the canonical name, so it works the same for a 1.8.9 pack
 * (`bed_feet_side`) and a modern one (`red_bed`). It is chosen automatically and
 * never asked about: a preview that needs configuring is not a preview.
 */

export type Shape3D =
  | 'cube'
  | 'slab'
  | 'bed'
  | 'plate'
  | 'cross'
  | 'torch'
  | 'panel'
  | 'flat'
  | 'sprite';

export interface ShapeSpec {
  /** Extent along x, y, z as a fraction of a block. Unused by cross and sprite. */
  size: [number, number, number];
  /** Sat on the floor rather than centred, the way a slab or carpet is. */
  grounded: boolean;
}

export const SHAPES: Record<Shape3D, ShapeSpec> = {
  cube: { size: [1, 1, 1], grounded: false },
  slab: { size: [1, 0.5, 1], grounded: true },
  bed: { size: [1, 0.5625, 1], grounded: true },
  plate: { size: [1, 0.1875, 1], grounded: true },
  cross: { size: [1, 1, 1], grounded: false },
  torch: { size: [0.125, 0.625, 0.125], grounded: true },
  panel: { size: [1, 1, 0.1875], grounded: false },
  flat: { size: [1, 1, 0], grounded: false },
  sprite: { size: [1, 1, 0.0625], grounded: false },
};

/*
 * Matched against the canonical name in order, first hit wins. Both eras are
 * covered because DreamPack folds them onto one key: a legacy pack's
 * `sapling_oak` and a modern pack's `oak_sapling` land on the same slot.
 */
const BLOCK_RULES: Array<[RegExp, Shape3D]> = [
  [/(^|_)bed(_|$)/, 'bed'],
  [/torch/, 'torch'],
  // Anchored on a word boundary so "trapdoor", which is horizontal, falls
  // through to the thin-slice rule below instead.
  [/(^|_)door(_|$)/, 'panel'],
  [
    /sapling|(^|_)(rose|dandelion|poppy|allium|azure_bluet|oxeye_daisy|cornflower|lily_of_the_valley|blue_orchid)(_|$)|flower_|(^|_)fern(_|$)|tallgrass|short_grass|grass_plant|deadbush|dead_bush|mushroom_(red|brown)$|(red|brown)_mushroom$|_stage_?\d|reeds|sugar_cane|(^|_)vine(_|$)|nether_wart|netherwart|double_plant|(^|_)crops?(_|$)|sweet_berry|cobweb|web$/,
    'cross',
  ],
  [/trapdoor|(^|_)carpet(_|$)|_carpet$|(^|_)snow$|pressure_plate|(^|_)rail|lily_pad|waterlily/, 'plate'],
  [/(^|_)slab(_|$)|_slab$/, 'slab'],
  [/ladder|(^|_)pane(_|$)|_pane$|(^|_)fire(_|$)|^fire_|(^|_)banner(_|$)/, 'flat'],
];

/**
 * Best guess at the solid a texture belongs on.
 *
 * `category` decides the default: an item sprite is extruded, a block is a cube,
 * and anything else is flat, because there is no sensible solid for a GUI sheet.
 */
export function shapeForKey(key: string, category: string): Shape3D {
  const body = key.startsWith('texture:') ? key.slice('texture:'.length) : key;
  // Drop a namespace prefix and the directory, leaving the bare name.
  const name = (body.split('/').pop() ?? body).toLowerCase();

  if (category === 'Items') return 'sprite';
  if (category !== 'Blocks') return 'flat';

  for (const [pattern, shape] of BLOCK_RULES) {
    if (pattern.test(name)) return shape;
  }
  return 'cube';
}

/** True when a texture is worth showing in 3D at all. */
export function canPreview3D(key: string, category: string): boolean {
  return key.startsWith('texture:') && (category === 'Blocks' || category === 'Items');
}
