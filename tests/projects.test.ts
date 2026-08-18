// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../src/state/store';
import { buildSlotIndex } from '../src/core/resolve';
import * as db from '../src/db/idb';
import type { ImportedPack } from '../src/core/types';

const SWORD = 'texture:item/diamond_sword';
const APPLE = 'texture:item/golden_apple';

const pack = (id: string, name: string): ImportedPack => ({
  id,
  name,
  description: '',
  packFormat: 1,
  era: 'legacy',
  iconDataUrl: null,
  fileCount: 2,
  bytes: 600,
  importedAt: 1,
  color: '#55FF55',
});

const files = ['diamond_sword', 'apple_golden'].map((name) => ({
  path: `assets/minecraft/textures/items/${name}.png`,
  size: 300,
  hash: `${name}-hash`,
}));

/** Put the store into a state with two packs imported under given ids. */
const install = (aId: string, bId: string) => {
  useStore.setState({
    ready: true,
    packs: [pack(aId, 'Pack A'), pack(bId, 'Pack B')],
    indexes: { [aId]: files, [bId]: files },
    slots: buildSlotIndex([
      { id: aId, era: 'legacy', files },
      { id: bId, era: 'legacy', files },
    ]),
    packOrder: [aId, bId],
    picks: {},
    past: [],
    future: [],
    projectName: 'mix',
  });
};

describe('saving and loading a project', () => {
  beforeEach(async () => {
    for (const p of await db.listProjects()) await db.deleteProject(p.id);
    install('a1', 'b1');
  });

  it('restores the picks it saved', async () => {
    useStore.getState().pick(SWORD, 'b1');
    useStore.getState().pick(APPLE, 'a1');
    await useStore.getState().saveProject();

    useStore.getState().clearAllPicks();
    expect(useStore.getState().picks).toEqual({});

    const result = await useStore.getState().loadProject('mix');
    expect(result.ok).toBe(true);
    expect(useStore.getState().picks).toEqual({ [SWORD]: 'b1', [APPLE]: 'a1' });
  });

  /**
   * The bug this covers: a pack gets a new id every time it is imported, so a
   * project saved before a re-import matched nothing and loaded silently empty.
   */
  it('still matches after its packs have been re-imported under new ids', async () => {
    useStore.getState().pick(SWORD, 'b1');
    useStore.getState().pick(APPLE, 'a1');
    await useStore.getState().saveProject();

    // Same packs by name, entirely different ids.
    install('a2', 'b2');

    const result = await useStore.getState().loadProject('mix');
    expect(result.ok).toBe(true);
    expect(useStore.getState().picks).toEqual({ [SWORD]: 'b2', [APPLE]: 'a2' });
    expect(useStore.getState().packOrder).toEqual(['a2', 'b2']);
  });

  it('says which packs are missing rather than loading nothing quietly', async () => {
    useStore.getState().pick(SWORD, 'b1');
    await useStore.getState().saveProject();

    // Pack B is gone entirely.
    useStore.setState({
      packs: [pack('a2', 'Pack A')],
      indexes: { a2: files },
      slots: buildSlotIndex([{ id: 'a2', era: 'legacy', files }]),
      packOrder: ['a2'],
      picks: {},
    });

    const result = await useStore.getState().loadProject('mix');
    expect(result.ok).toBe(false);
    expect(result.message).toContain('Pack B');
    expect(useStore.getState().picks).toEqual({});
  });

  it('warns that a project saved without names can only match exact ids', async () => {
    // A project as written before pack names were recorded.
    await db.saveProject({
      id: 'old', name: 'old', targetVersion: '1.8.9',
      packOrder: ['long-gone'], picks: { [SWORD]: 'long-gone' },
      packMeta: { description: '', iconFromPackId: null },
      updatedAt: 1,
    });

    const result = await useStore.getState().loadProject('old');
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/re-save/i);
  });

  it('reports a project that is no longer there', async () => {
    const result = await useStore.getState().loadProject('nothing');
    expect(result.ok).toBe(false);
  });
});

describe('importing a .dreampack', () => {
  beforeEach(() => install('a1', 'b1'));

  const asFile = (body: unknown, name = 'mix.dreampack') =>
    new File([typeof body === 'string' ? body : JSON.stringify(body)], name);

  it('rewrites picks onto packs matched by name', async () => {
    const result = await useStore.getState().importProjectFile(asFile({
      dreampack: 1,
      name: 'shared',
      targetVersion: '1.8.9',
      packs: [{ id: 'their-a', name: 'Pack A' }, { id: 'their-b', name: 'Pack B' }],
      picks: { [SWORD]: 'their-b' },
    }));

    expect(result.ok).toBe(true);
    expect(useStore.getState().picks).toEqual({ [SWORD]: 'b1' });
    expect(useStore.getState().projectName).toBe('shared');
  });

  it('explains a file it cannot parse instead of doing nothing', async () => {
    const result = await useStore.getState().importProjectFile(asFile('not json at all'));
    expect(result.ok).toBe(false);
    expect(result.message).toContain('mix.dreampack');
    // The current picks must survive a failed import.
    expect(useStore.getState().picks).toEqual({});
  });

  it('rejects valid JSON that is not a dreampack', async () => {
    const result = await useStore.getState().importProjectFile(asFile({ hello: 'world' }));
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/does not look like/i);
  });

  it('names the packs the file needs that are not imported', async () => {
    const result = await useStore.getState().importProjectFile(asFile({
      dreampack: 1,
      packs: [{ id: 'x', name: 'Somebody Elses Pack' }],
      picks: { [SWORD]: 'x' },
    }));

    expect(result.ok).toBe(false);
    expect(result.message).toContain('Somebody Elses Pack');
  });
});
