import { describe, expect, it } from 'vitest';
import { canPreview3D, SHAPES, shapeForKey } from '../src/core/blockShapes';

const block = (name: string) => shapeForKey(`texture:block/${name}`, 'Blocks');

describe('shapeForKey', () => {
  it('puts an ordinary block on a cube', () => {
    expect(block('stone')).toBe('cube');
    expect(block('wool_colored_red')).toBe('cube');
    expect(block('obsidian')).toBe('cube');
    expect(block('end_stone')).toBe('cube');
  });

  /**
   * The case that prompted this: a bed is nine sixteenths tall, so wrapping its
   * texture around a full cube showed something that does not exist in game.
   */
  it('recognises a bed in either era', () => {
    for (const name of ['bed_feet_top', 'bed_feet_side', 'bed_head_end', 'red_bed', 'bed']) {
      expect(block(name)).toBe('bed');
    }
    expect(SHAPES.bed.size[1]).toBeCloseTo(9 / 16);
    expect(SHAPES.bed.grounded).toBe(true);
  });

  it('crosses plants rather than boxing them', () => {
    for (const name of [
      'sapling_oak', 'oak_sapling', 'flower_rose', 'poppy', 'dandelion',
      'deadbush', 'dead_bush', 'tallgrass', 'short_grass', 'fern',
      'mushroom_red', 'brown_mushroom', 'wheat_stage_3', 'carrots_stage0',
      'reeds', 'sugar_cane', 'vine', 'nether_wart', 'double_plant_fern',
    ]) {
      expect(block(name)).toBe('cross');
    }
  });

  it('flattens the blocks that are a single face', () => {
    for (const name of ['ladder', 'glass_pane_top', 'fire_layer_0']) {
      expect(block(name)).toBe('flat');
    }
  });

  it('thins out trapdoors, carpets, snow and rails', () => {
    for (const name of ['trapdoor', 'iron_trapdoor', 'red_carpet', 'snow', 'rail_normal']) {
      expect(block(name)).toBe('plate');
    }
  });

  it('stands doors up as a panel and torches as a post', () => {
    expect(block('door_wood_upper')).toBe('panel');
    expect(block('oak_door_top')).toBe('panel');
    expect(block('torch_on')).toBe('torch');
    expect(block('redstone_torch_off')).toBe('torch');
  });

  it('does not mistake a name that merely contains a shape word', () => {
    // "bedrock" starts with "bed" but is a full block.
    expect(block('bedrock')).toBe('cube');
    // "grass_side" is a cube face, not a plant.
    expect(block('grass_side')).toBe('cube');
  });

  it('extrudes items and flattens everything else', () => {
    expect(shapeForKey('texture:item/diamond_sword', 'Items')).toBe('sprite');
    expect(shapeForKey('texture:item/water_bucket', 'Items')).toBe('sprite');
    expect(shapeForKey('texture:gui/icons', 'GUI')).toBe('flat');
  });

  it('ignores a non-minecraft namespace when reading the name', () => {
    expect(shapeForKey('texture:@mypack/block/bed_head_top', 'Blocks')).toBe('bed');
  });
});

describe('canPreview3D', () => {
  it('offers 3D for block and item textures only', () => {
    expect(canPreview3D('texture:block/stone', 'Blocks')).toBe(true);
    expect(canPreview3D('texture:item/apple', 'Items')).toBe(true);
    expect(canPreview3D('texture:gui/icons', 'GUI')).toBe(false);
    expect(canPreview3D('sound:random/click', 'Sounds')).toBe(false);
  });
});

describe('SHAPES', () => {
  it('describes every shape the detector can return', () => {
    const returned = new Set(
      ['stone', 'bed_feet_top', 'oak_sapling', 'ladder', 'snow', 'door_wood_upper', 'torch_on']
        .map((name) => shapeForKey(`texture:block/${name}`, 'Blocks')),
    );
    for (const shape of returned) expect(SHAPES[shape]).toBeDefined();
    expect(SHAPES[shapeForKey('texture:item/apple', 'Items')]).toBeDefined();
  });

  it('keeps every solid within a block', () => {
    for (const spec of Object.values(SHAPES)) {
      for (const extent of spec.size) {
        expect(extent).toBeGreaterThanOrEqual(0);
        expect(extent).toBeLessThanOrEqual(1);
      }
    }
  });
});
