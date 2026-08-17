import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../state/store';
import { CATEGORIES, type AssetSlot, type Candidate, type Category } from '../core/types';
import { differsAcrossPacks, isOverridden, orderCandidates, resolveSlot } from '../core/resolve';
import { MCButton, MCCheckbox, MCPanel } from './mc/MCPrimitives';
import { ConfirmDialog } from './mc/ConfirmDialog';
import { useTexture } from '../lib/useTexture';
import { useGridKeys } from '../lib/useGridKeys';
import { playPop, playThud } from '../lib/sfx';

// 20 design px cell, 4px gutter - Minecraft slot proportions at 2x scale.
const CELL = 40;
const GAP = 4;

/** Above this many slots, a bulk action asks first. */
const BULK_CONFIRM_THRESHOLD = 25;

function SlotCell({
  slot,
  winner,
  overridden,
  selected,
  color,
  onSelect,
}: {
  slot: AssetSlot;
  winner: Candidate | null;
  overridden: boolean;
  selected: boolean;
  color: string;
  onSelect: () => void;
}) {
  const isImage = slot.key.startsWith('texture:');
  const url = useTexture(isImage && winner ? winner.packId : null, winner?.primaryPath ?? null);

  return (
    <button
      className={`mc-slot ${selected ? 'mc-slot-selected' : ''}`}
      style={{ width: CELL, height: CELL, flex: 'none' }}
      onClick={onSelect}
      title={`${slot.displayName}\n${slot.key}\n${slot.candidates.length} pack${slot.candidates.length === 1 ? '' : 's'}`}
    >
      {isImage ? (
        url ? (
          <img src={url} alt={slot.displayName} />
        ) : (
          <span style={{ fontSize: 16, color: '#4b4b4b' }} />
        )
      ) : (
        <span style={{ fontSize: 24, color: '#3f3f3f' }}>
          {slot.category === 'Sounds' ? '♪' : slot.category === 'CIT' ? '§' : '{}'}
        </span>
      )}
      {overridden && <span className="mc-star" />}
      {winner && <span className="mc-pip" style={{ background: color }} />}
      {slot.unmapped && (
        <span
          style={{
            position: 'absolute', left: 2, bottom: 1, fontSize: 16,
            color: 'var(--mc-gold)', textShadow: '1px 1px 0 #000', lineHeight: 1,
          }}
          title="No cross-version name mapping for this asset"
        >
          !
        </span>
      )}
    </button>
  );
}

export function SlotGrid() {
  const {
    slots, packs, packOrder, picks, category, setCategory,
    search, setSearch, filters, toggleFilter, selectedKey, select, clearAllPicks,
    pickMany, clearMany, openEditor, editingKey,
  } = useStore(
    useShallow((s) => ({
      slots: s.slots, packs: s.packs, packOrder: s.packOrder, picks: s.picks,
      category: s.category, setCategory: s.setCategory, search: s.search, setSearch: s.setSearch,
      filters: s.filters, toggleFilter: s.toggleFilter, selectedKey: s.selectedKey,
      select: s.select, clearAllPicks: s.clearAllPicks, pickMany: s.pickMany,
      clearMany: s.clearMany, openEditor: s.openEditor, editingKey: s.editingKey,
    })),
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [columns, setColumns] = useState(8);
  const [confirming, setConfirming] = useState<
    { kind: 'clearAll' } | { kind: 'bulk'; packId: string } | { kind: 'clearShown' } | null
  >(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const width = el.clientWidth - 16;
      setColumns(Math.max(1, Math.floor((width + GAP) / (CELL + GAP))));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const colorByPack = useMemo(
    () => new Map(packs.map((p) => [p.id, p.color])),
    [packs],
  );

  const countsByCategory = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of slots) counts.set(s.category, (counts.get(s.category) ?? 0) + 1);
    return counts;
  }, [slots]);

  /**
   * Everything matching the search and filters, split by category.
   *
   * The category test comes last on purpose: applying it first meant searching
   * "wool" from the Items tab showed an empty grid with no sign that the
   * matches were one tab over.
   */
  const { visible, elsewhere } = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const out: Array<{ slot: AssetSlot; winner: Candidate | null; overridden: boolean }> = [];
    const others = new Map<Category, number>();

    for (const slot of slots) {
      if (needle && !slot.displayName.toLowerCase().includes(needle) &&
          !slot.key.toLowerCase().includes(needle)) continue;
      if (filters.onlyDiffering && !differsAcrossPacks(slot)) continue;
      if (filters.onlyUnmapped && !slot.unmapped) continue;

      const overridden = isOverridden(slot, packOrder, picks);
      if (filters.onlyOverridden && !overridden) continue;

      if (slot.category !== category) {
        others.set(slot.category, (others.get(slot.category) ?? 0) + 1);
        continue;
      }

      out.push({ slot, winner: resolveSlot(slot, packOrder, picks), overridden });
    }

    out.sort((a, b) => a.slot.displayName.localeCompare(b.slot.displayName));
    return { visible: out, elsewhere: [...others.entries()].sort((a, b) => b[1] - a[1]) };
  }, [slots, category, search, filters, packOrder, picks]);

  const visibleKeys = useMemo(() => visible.map((v) => v.slot.key), [visible]);

  const rowCount = Math.ceil(visible.length / columns);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => CELL + GAP,
    overscan: 4,
  });

  const pickCount = Object.keys(picks).length;

  // ---- Bulk actions ------------------------------------------------------

  const applyPack = useCallback((packId: string) => {
    const applied = pickMany(packId, visibleKeys);
    const name = packs.find((p) => p.id === packId)?.name ?? 'that pack';
    if (applied === 0) {
      setNote(`Nothing to do - ${name} supplies none of the ${visibleKeys.length} shown.`);
      playThud();
      return;
    }
    playPop();
    setNote(
      applied === visibleKeys.length
        ? `${name} now supplies all ${applied} shown.`
        : `${name} now supplies ${applied} of ${visibleKeys.length} shown - the rest do not exist in it.`,
    );
  }, [pickMany, visibleKeys, packs]);

  const clearShown = useCallback(() => {
    const held = visibleKeys.filter((k) => k in picks).length;
    clearMany(visibleKeys);
    playThud();
    setNote(held === 0 ? 'No picks to clear here.' : `Cleared ${held} pick${held === 1 ? '' : 's'}.`);
  }, [clearMany, visibleKeys, picks]);

  const requestBulk = (packId: string) => {
    if (visibleKeys.length > BULK_CONFIRM_THRESHOLD) setConfirming({ kind: 'bulk', packId });
    else applyPack(packId);
  };

  const requestClearShown = () => {
    const held = visibleKeys.filter((k) => k in picks).length;
    if (held > BULK_CONFIRM_THRESHOLD) setConfirming({ kind: 'clearShown' });
    else clearShown();
  };

  // The note is about the last action; a new filter makes it stale.
  useEffect(() => setNote(null), [category, search, filters]);

  // ---- Keyboard ----------------------------------------------------------

  const selectedIndex = useMemo(
    () => (selectedKey ? visible.findIndex((v) => v.slot.key === selectedKey) : -1),
    [visible, selectedKey],
  );

  const goTo = useCallback((index: number) => {
    if (visible.length === 0) return;
    const clamped = Math.max(0, Math.min(visible.length - 1, index));
    select(visible[clamped].slot.key);
    virtualizer.scrollToIndex(Math.floor(clamped / columns), { align: 'auto' });
  }, [visible, select, virtualizer, columns]);

  useGridKeys({
    move: (delta) => goTo(selectedIndex === -1 ? 0 : selectedIndex + delta),
    moveToEdge: (edge) => goTo(edge === 'start' ? 0 : visible.length - 1),
    pickNth: (n) => {
      const entry = visible[selectedIndex];
      if (!entry) return;
      const candidate = orderCandidates(entry.slot, packOrder)[n - 1];
      if (!candidate) return;
      useStore.getState().pick(entry.slot.key, candidate.packId);
      playPop();
    },
    clearPick: () => {
      const entry = visible[selectedIndex];
      if (!entry || !(entry.slot.key in picks)) return;
      useStore.getState().clearPick(entry.slot.key);
      playThud();
    },
    openEditor: () => {
      const entry = visible[selectedIndex];
      if (entry?.slot.key.startsWith('texture:')) openEditor(entry.slot.key);
    },
    focusSearch: () => searchRef.current?.focus(),
    deselect: () => select(null),
    undo: () => useStore.getState().undo(),
    redo: () => useStore.getState().redo(),
  }, editingKey === null, columns);

  return (
    <MCPanel className="col" style={{ padding: 0 }}>
      {/* Category tabs */}
      <div
        style={{
          display: 'flex', flexWrap: 'wrap', gap: 8, padding: 10,
          borderBottom: '2px solid #101010',
        }}
      >
        {CATEGORIES.map((c) => {
          const count = countsByCategory.get(c) ?? 0;
          return (
            <MCButton
              key={c}
              small
              onClick={() => setCategory(c)}
              disabled={count === 0}
              style={
                category === c
                  ? { background: '#3a7d3a', color: '#fff', borderColor: '#fff #2b2b2b #2b2b2b #fff' }
                  : undefined
              }
            >
              {c} <span style={{ opacity: 0.7 }}>{count}</span>
            </MCButton>
          );
        })}
      </div>

      {/* Search + filters */}
      <div style={{ padding: 8, borderBottom: '2px solid #101010' }}>
        <div className="row" style={{ gap: 6 }}>
          <input
            ref={searchRef}
            className="mc-input"
            placeholder="search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') e.currentTarget.blur();
            }}
            spellCheck={false}
            aria-label="Search assets"
          />
          {pickCount > 0 && (
            <MCButton
              small
              variant="danger"
              onClick={() => setConfirming({ kind: 'clearAll' })}
              title="Remove all manual picks"
            >
              clear {pickCount}
            </MCButton>
          )}
        </div>
        <div className="row" style={{ gap: 14, marginTop: 8, flexWrap: 'wrap' }}>
          <MCCheckbox
            checked={filters.onlyDiffering}
            onChange={() => toggleFilter('onlyDiffering')}
            label="only differing"
            title="Hide assets that are identical in every pack - these are the ones worth choosing between"
          />
          <MCCheckbox
            checked={filters.onlyOverridden}
            onChange={() => toggleFilter('onlyOverridden')}
            label="only picked"
            title="Show only assets you have explicitly chosen a pack for"
          />
          <MCCheckbox
            checked={filters.onlyUnmapped}
            onChange={() => toggleFilter('onlyUnmapped')}
            label="only unmapped"
            title="Show only assets with no cross-version name mapping"
          />
          <span className="t-gray" style={{ fontSize: 16, marginLeft: 'auto' }}>
            {visible.length} shown
          </span>
        </div>

        {/* Matches hiding in other tabs. Without this an empty grid looks like
            no match at all, when the search simply landed on the wrong tab. */}
        {search.trim() !== '' && elsewhere.length > 0 && (
          <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <span className="t-gray" style={{ fontSize: 16 }}>also matches in</span>
            {elsewhere.slice(0, 4).map(([cat, count]) => (
              <MCButton
                key={cat}
                small
                onClick={() => setCategory(cat)}
                title={`Show the ${count} match${count === 1 ? '' : 'es'} in ${cat}`}
              >
                {cat} <span style={{ opacity: 0.7 }}>{count}</span>
              </MCButton>
            ))}
          </div>
        )}

        {/* Bulk picks: the filtered view is the selection, so these follow the
            category, search and filters above rather than hitting everything. */}
        {packs.length > 1 && visible.length > 0 && (
          <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <span className="t-gray" style={{ fontSize: 16 }}>
              use for all {visible.length}
            </span>
            {packOrder.map((id) => {
              const pack = packs.find((p) => p.id === id);
              if (!pack) return null;
              return (
                <MCButton
                  key={id}
                  small
                  onClick={() => requestBulk(id)}
                  title={`Point every one of the ${visible.length} shown assets at ${pack.name}, where it has them`}
                  style={{ borderLeft: `4px solid ${pack.color}`, maxWidth: 150 }}
                >
                  <span
                    style={{
                      overflow: 'hidden', textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap', maxWidth: 110, display: 'block',
                    }}
                  >
                    {pack.name}
                  </span>
                </MCButton>
              );
            })}
            <MCButton
              small
              variant="danger"
              onClick={requestClearShown}
              title="Drop manual picks for the assets shown, falling back to the priority order"
            >
              clear shown
            </MCButton>
          </div>
        )}

        {note && (
          <div className="t-green" style={{ fontSize: 16, marginTop: 8, lineHeight: 'var(--lh-body)' }}>
            {note}
          </div>
        )}
      </div>

      {/* Inventory grid */}
      <div ref={scrollRef} className="scroll" style={{ padding: 8 }}>
        {slots.length === 0 ? (
          <div className="empty-hint">
            No packs imported yet.
            <br />
            <span style={{ fontSize: 16 }}>Add some on the left to start mixing.</span>
          </div>
        ) : visible.length === 0 ? (
          <div className="empty-hint">
            Nothing matches these filters.
            <br />
            <span style={{ fontSize: 16 }}>
              {filters.onlyDiffering && packs.length < 2
                ? 'Import a second pack, or untick "only differing".'
                : 'Try clearing the search or a filter.'}
            </span>
          </div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((row) => {
              const start = row.index * columns;
              const cells = visible.slice(start, start + columns);
              return (
                <div
                  key={row.key}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    transform: `translateY(${row.start}px)`,
                    display: 'flex',
                    gap: GAP,
                  }}
                >
                  {cells.map(({ slot, winner, overridden }) => (
                    <SlotCell
                      key={slot.key}
                      slot={slot}
                      winner={winner}
                      overridden={overridden}
                      selected={selectedKey === slot.key}
                      color={winner ? colorByPack.get(winner.packId) ?? '#fff' : '#fff'}
                      onSelect={() => select(slot.key)}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Keys are only worth having if they are discoverable. */}
      {visible.length > 0 && (
        <div
          className="t-gray"
          style={{
            fontSize: 16, padding: '6px 10px', borderTop: '2px solid #101010',
            lineHeight: 'var(--lh-body)',
          }}
        >
          arrows move · 1-9 pick a pack · 0 resets · enter edits · / searches · ctrl+z undoes
        </div>
      )}

      {confirming?.kind === 'clearAll' && (
        <ConfirmDialog
          title="Clear every pick"
          confirmLabel="Clear all"
          danger
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            clearAllPicks();
            setConfirming(null);
            playThud();
          }}
        >
          Discard all {pickCount} manual picks? Every asset goes back to whichever pack
          wins on priority order. This can be undone with ctrl+z.
        </ConfirmDialog>
      )}

      {confirming?.kind === 'bulk' && (
        <ConfirmDialog
          title="Apply to everything shown"
          confirmLabel="Apply"
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            applyPack(confirming.packId);
            setConfirming(null);
          }}
        >
          Point all {visible.length} shown assets at{' '}
          {packs.find((p) => p.id === confirming.packId)?.name ?? 'this pack'}? Assets it does
          not contain keep what they have. This can be undone with ctrl+z.
        </ConfirmDialog>
      )}

      {confirming?.kind === 'clearShown' && (
        <ConfirmDialog
          title="Clear the picks shown"
          confirmLabel="Clear"
          danger
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            clearShown();
            setConfirming(null);
          }}
        >
          Drop the manual picks on all {visible.length} shown assets? They fall back to the
          priority order. This can be undone with ctrl+z.
        </ConfirmDialog>
      )}
    </MCPanel>
  );
}
