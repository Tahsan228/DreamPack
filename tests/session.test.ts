// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../src/state/store';
import { flushSession, reconcile, saveSession } from '../src/state/session';
import { readSession, storePack } from '../src/db/idb';
import type { ImportedPack } from '../src/core/types';

const pack = (id: string, importedAt: number): ImportedPack => ({
  id,
  name: `Pack ${id.toUpperCase()}`,
  description: '',
  packFormat: 1,
  era: 'legacy',
  iconDataUrl: null,
  fileCount: 1,
  bytes: 300,
  importedAt,
  color: '#55FF55',
});

const fileFor = (id: string) => ({
  path: `assets/minecraft/textures/items/sword_diamond.png`,
  bytes: new Uint8Array([1, 2, 3, id.charCodeAt(0)]),
});

const indexFor = () => [
  { path: 'assets/minecraft/textures/items/sword_diamond.png', size: 4, hash: 'h' },
];

describe('reconcile', () => {
  it('keeps the saved order and appends packs it has never seen', () => {
    const out = reconcile(['b', 'a'], {}, ['a', 'b', 'c']);
    expect(out.packOrder).toEqual(['b', 'a', 'c']);
  });

  it('drops packs that are no longer imported', () => {
    const out = reconcile(['gone', 'a'], {}, ['a']);
    expect(out.packOrder).toEqual(['a']);
  });

  it('drops picks pointing at a pack that is gone, and keeps the rest', () => {
    const out = reconcile(
      ['a'],
      { 'texture:item/apple': 'a', 'texture:item/bow': 'gone' },
      ['a'],
    );
    expect(out.picks).toEqual({ 'texture:item/apple': 'a' });
  });

  it('does not duplicate a pack listed twice in the saved order', () => {
    expect(reconcile(['a', 'a'], {}, ['a']).packOrder).toEqual(['a']);
  });
});

describe('session persistence', () => {
  beforeEach(() => {
    useStore.setState({
      ready: false, packs: [], indexes: {}, slots: [], packOrder: [], picks: {},
      past: [], future: [], selectedKey: null, pendingDuplicates: [],
    });
  });

  it('round-trips a snapshot through IndexedDB', async () => {
    saveSession({
      packOrder: ['b', 'a'],
      picks: { 'texture:item/diamond_sword': 'b' },
      targetVersion: '1.16.5',
      projectName: 'bedwars',
      description: 'mine',
      iconFromPackId: 'a',
      category: 'Blocks',
      filters: { onlyDiffering: false, onlyOverridden: true, onlyUnmapped: false },
    });
    await flushSession();

    const stored = await readSession();
    expect(stored?.targetVersion).toBe('1.16.5');
    expect(stored?.projectName).toBe('bedwars');
    expect(stored?.picks).toEqual({ 'texture:item/diamond_sword': 'b' });
    expect(stored?.category).toBe('Blocks');
    expect(stored?.filters.onlyOverridden).toBe(true);
  });

  /**
   * The regression that matters: packs always came back from IndexedDB, so the
   * app looked like it had remembered while the priority order and every pick
   * had quietly reset.
   */
  it('restores the saved order, picks and version on hydrate', async () => {
    await storePack(pack('a', 1), [fileFor('a')], indexFor());
    await storePack(pack('b', 2), [fileFor('b')], indexFor());

    saveSession({
      // Deliberately the reverse of import order, which is what hydrate used to
      // impose unconditionally.
      packOrder: ['b', 'a'],
      picks: { 'texture:item/diamond_sword': 'b' },
      targetVersion: '1.20.1',
      projectName: 'restored',
      description: 'desc',
      iconFromPackId: 'b',
      category: 'Items',
      filters: { onlyDiffering: true, onlyOverridden: false, onlyUnmapped: false },
    });
    await flushSession();

    await useStore.getState().hydrate();
    const s = useStore.getState();

    expect(s.packOrder).toEqual(['b', 'a']);
    expect(s.picks).toEqual({ 'texture:item/diamond_sword': 'b' });
    expect(s.targetVersion).toBe('1.20.1');
    expect(s.projectName).toBe('restored');
    expect(s.iconFromPackId).toBe('b');
  });

  it('drops a restored pick whose pack is no longer in the database', async () => {
    await storePack(pack('a', 1), [fileFor('a')], indexFor());

    saveSession({
      packOrder: ['deleted', 'a'],
      picks: { 'texture:item/diamond_sword': 'deleted' },
      targetVersion: '1.8.9',
      projectName: 'my_pack',
      description: '',
      iconFromPackId: 'deleted',
      category: 'Items',
      filters: { onlyDiffering: true, onlyOverridden: false, onlyUnmapped: false },
    });
    await flushSession();

    await useStore.getState().hydrate();
    const s = useStore.getState();

    expect(s.packOrder).not.toContain('deleted');
    expect(s.picks).toEqual({});
  });
});
