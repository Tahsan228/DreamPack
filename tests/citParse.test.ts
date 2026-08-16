import { describe, expect, it } from 'vitest';
import { citReferences, parseProperties, resolveCitRef } from '../src/core/citParse';

const PROPS_PATH = 'assets/minecraft/optifine/cit/swords/gen.properties';

describe('parseProperties', () => {
  it('reads key=value pairs and skips comments', () => {
    const props = parseProperties(
      ['# a comment', 'type=item', 'items=diamond_sword', '', '! also a comment', 'weight:10'].join('\n'),
    );
    expect(props).toEqual({ type: 'item', items: 'diamond_sword', weight: '10' });
  });
});

describe('resolveCitRef', () => {
  it('treats a bare name as a sibling of the properties file', () => {
    expect(resolveCitRef('gen', PROPS_PATH, '.png'))
      .toBe('assets/minecraft/optifine/cit/swords/gen.png');
  });

  it('keeps an existing extension', () => {
    expect(resolveCitRef('gen.png', PROPS_PATH, '.png'))
      .toBe('assets/minecraft/optifine/cit/swords/gen.png');
  });

  it('treats a leading slash as pack-absolute', () => {
    expect(resolveCitRef('/assets/minecraft/textures/item/x.png', PROPS_PATH, '.png'))
      .toBe('assets/minecraft/textures/item/x.png');
    expect(resolveCitRef('/textures/item/x.png', PROPS_PATH, '.png'))
      .toBe('assets/minecraft/textures/item/x.png');
  });

  it('accepts an already pack-relative assets path', () => {
    expect(resolveCitRef('assets/minecraft/textures/item/x.png', PROPS_PATH, '.png'))
      .toBe('assets/minecraft/textures/item/x.png');
  });
});

describe('citReferences', () => {
  it('collects textures and models a rule depends on', () => {
    const text = [
      'type=item',
      'items=diamond_sword',
      'texture=gen.png',
      'texture.overlay=glow',
      'model=custom_sword',
      'nbt.display.Name=ipattern:*Generator*',
      'weight=10',
    ].join('\n');

    expect(citReferences(text, PROPS_PATH).sort()).toEqual([
      'assets/minecraft/optifine/cit/swords/custom_sword.json',
      'assets/minecraft/optifine/cit/swords/gen.png',
      'assets/minecraft/optifine/cit/swords/glow.png',
    ]);
  });

  it('splits space-separated candidates', () => {
    expect(citReferences('tile=a b', PROPS_PATH).sort()).toEqual([
      'assets/minecraft/optifine/cit/swords/a.png',
      'assets/minecraft/optifine/cit/swords/b.png',
    ]);
  });

  it('ignores keys that are not file references', () => {
    expect(citReferences('items=diamond_sword\ndamage=1', PROPS_PATH)).toEqual([]);
  });
});
