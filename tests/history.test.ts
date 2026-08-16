// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../src/state/store';
import { buildSlotIndex } from '../src/core/resolve';
import type { ImportedPack } from '../src/core/types';

const SWORD = 'texture:item/diamond_sword';
const APPLE = 'texture:item/golden_apple';

const pack = (id: string): ImportedPack => ({
  id,
  name: `Pack ${id.toUpperCase()}`,
  description: '',
  packFormat: 1,
  era: 'legacy',
  iconDataUrl: null,
  fileCount: 2,
  bytes: 600,
  importedAt: 1,
  color: '#55FF55',
});

const files = (names: string[]) =>
  names.map((name) => ({
    path: `assets/minecraft/textures/items/${name}.png`,
    size: 300,
    hash: `${name}-hash`,
  }));

// Pack A has both assets; pack B only the sword. Bulk actions have to cope with
// that asymmetry, which is the whole point of the "where it has them" rule.
const indexes = {
  a: files(['sword_diamond', 'apple_golden']),
  b: files(['sword_diamond']),
};

describe('pick history and bulk actions', () => {
  beforeEach(() => {
    useStore.setState({
      ready: true,
      packs: [pack('a'), pack('b')],
      indexes,
      slots: buildSlotIndex([
        { id: 'a', era: 'legacy', files: indexes.a },
        { id: 'b', era: 'legacy', files: indexes.b },
      ]),
      packOrder: ['a', 'b'],
      picks: {},
      past: [],
      future: [],
    });
  });

  it('steps back and forward through picks', () => {
    const { pick } = useStore.getState();
    pick(SWORD, 'b');
    pick(APPLE, 'a');
    expect(Object.keys(useStore.getState().picks)).toHaveLength(2);

    useStore.getState().undo();
    expect(useStore.getState().picks).toEqual({ [SWORD]: 'b' });

    useStore.getState().undo();
    expect(useStore.getState().picks).toEqual({});

    useStore.getState().redo();
    expect(useStore.getState().picks).toEqual({ [SWORD]: 'b' });
  });

  it('undoes a pack reorder', () => {
    useStore.getState().movePack('b', -1);
    expect(useStore.getState().packOrder).toEqual(['b', 'a']);
    useStore.getState().undo();
    expect(useStore.getState().packOrder).toEqual(['a', 'b']);
  });

  it('does nothing when there is nothing to undo', () => {
    useStore.getState().undo();
    useStore.getState().redo();
    expect(useStore.getState().picks).toEqual({});
  });

  it('drops the redo branch once a new pick is made', () => {
    useStore.getState().pick(SWORD, 'b');
    useStore.getState().undo();
    useStore.getState().pick(APPLE, 'a');
    useStore.getState().redo();
    expect(useStore.getState().picks).toEqual({ [APPLE]: 'a' });
  });

  it('restores every pick that a clear-all discarded', () => {
    useStore.getState().pick(SWORD, 'b');
    useStore.getState().pick(APPLE, 'a');
    useStore.getState().clearAllPicks();
    expect(useStore.getState().picks).toEqual({});

    useStore.getState().undo();
    expect(useStore.getState().picks).toEqual({ [SWORD]: 'b', [APPLE]: 'a' });
  });

  it('assigns a pack only to the slots it actually supplies', () => {
    const applied = useStore.getState().pickMany('b', [SWORD, APPLE]);
    // Pack B has no golden apple, so that slot is left alone rather than
    // pointed at a file that does not exist.
    expect(applied).toBe(1);
    expect(useStore.getState().picks).toEqual({ [SWORD]: 'b' });
  });

  it('reports nothing applied when the pack supplies none of them', () => {
    expect(useStore.getState().pickMany('b', [APPLE])).toBe(0);
    expect(useStore.getState().past).toHaveLength(0);
  });

  it('clears only the given keys', () => {
    useStore.getState().pick(SWORD, 'b');
    useStore.getState().pick(APPLE, 'a');
    useStore.getState().clearMany([SWORD]);
    expect(useStore.getState().picks).toEqual({ [APPLE]: 'a' });
  });

  it('makes a bulk apply one undo step, not hundreds', () => {
    useStore.getState().pickMany('a', [SWORD, APPLE]);
    expect(useStore.getState().picks).toEqual({ [SWORD]: 'a', [APPLE]: 'a' });
    useStore.getState().undo();
    expect(useStore.getState().picks).toEqual({});
  });

  it('forgets its history when a pack is removed', async () => {
    useStore.getState().pick(SWORD, 'b');
    expect(useStore.getState().past).toHaveLength(1);

    // The bytes leave IndexedDB, so no earlier state could be restored safely.
    await useStore.getState().removePack('b');
    expect(useStore.getState().past).toEqual([]);
    expect(useStore.getState().future).toEqual([]);
    expect(useStore.getState().picks).toEqual({});
  });
});
