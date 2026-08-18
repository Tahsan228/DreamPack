// @vitest-environment jsdom
import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest';
import { act, cleanup, render, waitFor, within } from '@testing-library/react';
import { App } from '../src/App';
import { useStore } from '../src/state/store';
import { buildSlotIndex } from '../src/core/resolve';
import type { ImportedPack } from '../src/core/types';

const pack = (id: string, color: string): ImportedPack => ({
  id,
  name: `Pack ${id.toUpperCase()}`,
  description: 'test',
  packFormat: 1,
  era: 'legacy',
  iconDataUrl: null,
  fileCount: 3,
  bytes: 900,
  importedAt: Date.now(),
  color,
});

const items = (names: Record<string, string>) =>
  Object.entries(names).map(([name, hash]) => ({
    path: `assets/minecraft/textures/items/${name}.png`,
    size: 300,
    hash,
  }));

/**
 * Mount the app, wait out its boot sequence, and wait for the loading screen to
 * leave the tree before returning queries scoped to this render's container.
 *
 * Both waits matter. `ready` flips as soon as IndexedDB is read, but the loading
 * screen lingers through its fade - and while it does, its own phase text ("Reading
 * resource packs") collides with assertions about the app underneath.
 */
async function mount() {
  const view = render(<App />);
  const scoped = within(view.container);
  await waitFor(() => expect(useStore.getState().ready).toBe(true), { timeout: 5000 });
  await waitFor(() => expect(scoped.queryByRole('status')).toBeNull(), { timeout: 5000 });
  return scoped;
}

describe('App renders', () => {
  beforeEach(() => {
    useStore.setState({
      ready: false, packs: [], indexes: {}, slots: [],
      packOrder: [], picks: {}, selectedKey: null, category: 'Items',
      search: '', imports: [], exportStatus: null, savedProjects: [], editingKey: null,
    });
  });

  afterEach(cleanup);

  it('boots through the loading screen and reaches the empty state', async () => {
    const view = await mount();

    expect(view.getByRole('img', { name: 'DreamPack' })).toBeTruthy();
    expect(view.getByText(/Resource Packs/i)).toBeTruthy();
    expect(view.getByText(/No packs imported yet/i)).toBeTruthy();
    expect(view.getByText(/Select an asset to preview it/i)).toBeTruthy();
  });

  it('reports boot progress while loading', async () => {
    const view = render(<App />);
    // The status region is what a screen reader announces during boot.
    expect(within(view.container).getByRole('status')).toBeTruthy();
    await waitFor(() => expect(useStore.getState().ready).toBe(true), { timeout: 5000 });
  });

  it('shows the grid, and picking a candidate updates the store', async () => {
    const view = await mount();

    const a = pack('a', '#55FF55');
    const b = pack('b', '#55FFFF');
    const indexes = {
      a: items({ diamond_sword: 'h1', apple_golden: 'h2' }),
      b: items({ diamond_sword: 'h3' }),
    };

    act(() => {
      useStore.setState({
        packs: [a, b],
        indexes,
        packOrder: ['a', 'b'],
        slots: buildSlotIndex([
          { id: 'a', era: 'legacy', files: indexes.a },
          { id: 'b', era: 'legacy', files: indexes.b },
        ]),
      });
    });

    // Both packs appear in the priority rail. Scoped to the cards, because the
    // bulk-apply buttons carry the same names.
    expect(view.getByTitle(/^Pack A .*Drag to change priority/)).toBeTruthy();
    expect(view.getByTitle(/^Pack B .*Drag to change priority/)).toBeTruthy();

    // "only differing" is on by default, so only the sword shows: the two packs
    // ship different bytes for it, and only pack A has the apple.
    expect((await view.findAllByTitle(/Diamond Sword/)).length).toBeGreaterThan(0);

    act(() => useStore.getState().select('texture:item/diamond_sword'));
    expect(view.getByText('Diamond Sword')).toBeTruthy();

    act(() => useStore.getState().pick('texture:item/diamond_sword', 'b'));
    expect(useStore.getState().picks['texture:item/diamond_sword']).toBe('b');

    // Clearing the pick falls back to the priority order.
    act(() => useStore.getState().clearPick('texture:item/diamond_sword'));
    expect(useStore.getState().picks['texture:item/diamond_sword']).toBeUndefined();
  });

  /**
   * App installs a drop-anywhere handler on window, and React delegates from
   * the root container below it - so a drop on the rail used to be seen twice
   * and imported the same zip twice.
   */
  it('imports a zip dropped on the rail exactly once', async () => {
    const view = await mount();

    const calls: File[][] = [];
    act(() => {
      useStore.setState({
        importFiles: async (files: File[]) => {
          calls.push(files);
        },
      });
    });

    const file = new File([new Uint8Array([1, 2, 3])], 'MyPack.zip', { type: 'application/zip' });
    const target = view.getByText(/Drop/i).closest('.scroll');
    expect(target).toBeTruthy();

    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', {
      value: { files: [file], types: ['Files'] },
    });

    await act(async () => {
      target!.dispatchEvent(drop);
    });

    expect(calls).toHaveLength(1);
    expect(calls[0][0].name).toBe('MyPack.zip');
  });

  /**
   * A pack covering several game versions ships an asset under both spellings.
   * Both used to become candidates, so the strip grew a second chip for the same
   * pack that could never win the slot: clicking it picked the pack, and the
   * pack's first file answered. It had to stop being a chip at all.
   */
  it('shows one chip per pack when a pack ships an asset twice', async () => {
    const warnings: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    });

    const view = await mount();

    const a = pack('a', '#55FF55');
    const b = pack('b', '#55FFFF');
    const indexes = {
      a: [
        { path: 'assets/minecraft/textures/blocks/cobblestone_mossy.png', size: 300, hash: 'h1' },
        { path: 'assets/minecraft/textures/block/mossy_cobblestone.png', size: 300, hash: 'h2' },
      ],
      b: [
        { path: 'assets/minecraft/textures/blocks/cobblestone_mossy.png', size: 300, hash: 'h3' },
      ],
    };

    act(() => {
      useStore.setState({
        packs: [a, b],
        indexes,
        packOrder: ['a', 'b'],
        category: 'Blocks',
        slots: buildSlotIndex([
          { id: 'a', era: 'legacy', files: indexes.a },
          { id: 'b', era: 'legacy', files: indexes.b },
        ]),
      });
    });
    act(() => useStore.getState().select('texture:block/mossy_cobblestone'));

    expect(view.getByText(/From which pack \(2\)/)).toBeTruthy();
    expect(warnings.filter((w) => w.includes('two children with the same key'))).toEqual([]);

    spy.mockRestore();
  });

  it('reorders pack priority', async () => {
    await mount();

    act(() => {
      useStore.setState({ packs: [pack('a', '#0f0'), pack('b', '#0ff')], packOrder: ['a', 'b'] });
    });

    act(() => useStore.getState().movePack('b', -1));
    expect(useStore.getState().packOrder).toEqual(['b', 'a']);

    act(() => useStore.getState().reorderPack(0, 1));
    expect(useStore.getState().packOrder).toEqual(['a', 'b']);
  });
});
