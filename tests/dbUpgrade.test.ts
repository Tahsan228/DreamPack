// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { openDB } from 'idb';

/**
 * Anyone who used DreamPack before the session store existed arrives here with
 * a version 1 database. The upgrade must add the new store *without* touching
 * the four that already hold their packs - an unguarded createObjectStore would
 * throw, and a failed open means an empty library.
 *
 * This file gets its own module registry, so `src/db/idb.ts` is imported fresh
 * and its cached connection promise starts unset.
 */
describe('IndexedDB upgrade from v1', () => {
  it('adds the session store and keeps existing packs', async () => {
    // Stand up exactly the version 1 schema, as shipped before this change.
    const v1 = await openDB('dreampack', 1, {
      upgrade(db) {
        db.createObjectStore('packs', { keyPath: 'id' });
        db.createObjectStore('files', { keyPath: ['packId', 'path'] });
        db.createObjectStore('fileIndex', { keyPath: 'packId' });
        db.createObjectStore('projects', { keyPath: 'id' });
      },
    });

    await v1.put('packs', {
      id: 'old-pack',
      name: 'Pack From Before',
      description: '',
      packFormat: 1,
      era: 'legacy',
      iconDataUrl: null,
      fileCount: 1,
      bytes: 10,
      importedAt: 1,
      color: '#55FF55',
    });
    await v1.put('fileIndex', { packId: 'old-pack', files: [{ path: 'a.png', size: 10, hash: 'h' }] });
    v1.close();

    const db = await import('../src/db/idb');
    const packs = await db.listPacks();

    expect(packs.map((p) => p.id)).toEqual(['old-pack']);
    expect(packs[0].name).toBe('Pack From Before');
    expect(await db.getFileIndex('old-pack')).toHaveLength(1);

    // And the store added by the upgrade is usable.
    expect(await db.readSession()).toBeNull();
    await db.writeSession({
      v: 1,
      packOrder: ['old-pack'],
      picks: {},
      targetVersion: '1.8.9',
      projectName: 'my_pack',
      description: '',
      iconFromPackId: null,
      category: 'Items',
      filters: { onlyDiffering: true, onlyOverridden: false, onlyUnmapped: false },
      updatedAt: Date.now(),
    });
    expect((await db.readSession())?.packOrder).toEqual(['old-pack']);
  });
});
