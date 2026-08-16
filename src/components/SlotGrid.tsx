import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useStore } from '../state/store';
import { CATEGORIES, type AssetSlot, type Candidate } from '../core/types';
import { differsAcrossPacks, isOverridden, resolveSlot } from '../core/resolve';
import { MCButton, MCCheckbox, MCPanel } from './mc/MCPrimitives';
import { useTexture } from '../lib/useTexture';

// 20 design px cell, 4px gutter - Minecraft slot proportions at 2x scale.
const CELL = 40;
const GAP = 4;

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
  } = useStore();

  const scrollRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(8);

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

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const out: Array<{ slot: AssetSlot; winner: Candidate | null; overridden: boolean }> = [];

    for (const slot of slots) {
      if (slot.category !== category) continue;
      if (needle && !slot.displayName.toLowerCase().includes(needle) &&
          !slot.key.toLowerCase().includes(needle)) continue;
      if (filters.onlyDiffering && !differsAcrossPacks(slot)) continue;
      if (filters.onlyUnmapped && !slot.unmapped) continue;

      const overridden = isOverridden(slot, packOrder, picks);
      if (filters.onlyOverridden && !overridden) continue;

      out.push({ slot, winner: resolveSlot(slot, packOrder, picks), overridden });
    }

    out.sort((a, b) => a.slot.displayName.localeCompare(b.slot.displayName));
    return out;
  }, [slots, category, search, filters, packOrder, picks]);

  const rowCount = Math.ceil(visible.length / columns);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => CELL + GAP,
    overscan: 4,
  });

  const pickCount = Object.keys(picks).length;

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
            className="mc-input"
            placeholder="search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            spellCheck={false}
            aria-label="Search assets"
          />
          {pickCount > 0 && (
            <MCButton small variant="danger" onClick={clearAllPicks} title="Remove all manual picks">
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
    </MCPanel>
  );
}
