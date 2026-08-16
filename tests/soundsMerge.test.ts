import { describe, expect, it } from 'vitest';
import { mergeSoundsJson, soundRefToKey, type SoundsJson } from '../src/core/soundsMerge';

describe('soundRefToKey', () => {
  it('handles bare and namespaced references', () => {
    expect(soundRefToKey('random/click')).toBe('sound:random/click');
    expect(soundRefToKey('minecraft:random/click')).toBe('sound:random/click');
    expect(soundRefToKey('mypack:custom/boom')).toBe('sound:@mypack/custom/boom');
  });
});

describe('mergeSoundsJson', () => {
  const available = new Set(['sound:random/click', 'sound:mob/enderman/portal']);

  it('gives the first pack in priority order ownership of an event', () => {
    const a: SoundsJson = { 'ui.click': { sounds: ['random/click'], category: 'master' } };
    const b: SoundsJson = { 'ui.click': { sounds: ['random/click'], category: 'player' } };

    const merged = mergeSoundsJson([{ packId: 'a', json: a }, { packId: 'b', json: b }], available);
    expect(merged['ui.click'].category).toBe('master');
  });

  it('unions events across packs', () => {
    const merged = mergeSoundsJson(
      [
        { packId: 'a', json: { 'ui.click': { sounds: ['random/click'] } } },
        { packId: 'b', json: { 'mob.portal': { sounds: ['mob/enderman/portal'] } } },
      ],
      available,
    );
    expect(Object.keys(merged).sort()).toEqual(['mob.portal', 'ui.click']);
  });

  it('drops entries whose file did not make it into the export', () => {
    const merged = mergeSoundsJson(
      [{ packId: 'a', json: { 'ui.click': { sounds: ['random/click', 'random/missing'] } } }],
      available,
    );
    expect(merged['ui.click'].sounds).toEqual(['random/click']);
  });

  it('drops an event left with no playable sounds', () => {
    const merged = mergeSoundsJson(
      [{ packId: 'a', json: { 'ui.click': { sounds: ['random/gone'] } } }],
      available,
    );
    expect(merged['ui.click']).toBeUndefined();
  });

  it('understands object-form entries', () => {
    const merged = mergeSoundsJson(
      [{
        packId: 'a',
        json: {
          'ui.click': {
            sounds: [{ name: 'random/click', volume: 0.5 }, { name: 'random/gone' }],
          },
        },
      }],
      available,
    );
    expect(merged['ui.click'].sounds).toEqual([{ name: 'random/click', volume: 0.5 }]);
  });

  it('keeps event redirects, which point at other events rather than files', () => {
    const merged = mergeSoundsJson(
      [{ packId: 'a', json: { 'ui.alias': { sounds: [{ name: 'ui.click', type: 'event' }] } } }],
      available,
    );
    expect(merged['ui.alias'].sounds).toHaveLength(1);
  });

  it('preserves events that carry no sounds array', () => {
    const merged = mergeSoundsJson(
      [{ packId: 'a', json: { 'ui.click': { replace: true } } }],
      available,
    );
    expect(merged['ui.click']).toEqual({ replace: true });
  });
});
