import { useRef, useState } from 'react';
import { useStore } from '../state/store';
import { MCButton, MCPanel, MCProgress } from './mc/MCPrimitives';
import { AdSlot } from './AdSlot';
import type { ImportedPack } from '../core/types';

function PackCard({
  pack,
  index,
  total,
  onDragStart,
  onDragOver,
  onDrop,
  dragging,
}: {
  pack: ImportedPack;
  index: number;
  total: number;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
  dragging: boolean;
}) {
  const { movePack, removePack, iconFromPackId, setIconPack } = useStore();
  const isIcon = iconFromPackId === pack.id;

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className="mc-panel"
      style={{
        padding: 6,
        marginBottom: 6,
        display: 'flex',
        gap: 8,
        alignItems: 'flex-start',
        cursor: 'grab',
        opacity: dragging ? 0.4 : 1,
        borderLeft: `4px solid ${pack.color}`,
      }}
      title={`${pack.name}\n${pack.fileCount} files · ${(pack.bytes / 1048576).toFixed(1)} MB\nDrag to change priority`}
    >
      <div
        className="mc-inset"
        style={{ width: 34, height: 34, flex: 'none', display: 'grid', placeItems: 'center' }}
      >
        {pack.iconDataUrl ? (
          <img src={pack.iconDataUrl} alt="" style={{ width: '100%', height: '100%' }} />
        ) : (
          <span style={{ fontSize: 16, color: '#3f3f3f' }}>?</span>
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0, color: '#1c1c1c' }}>
        <div
          style={{
            fontSize: 16,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ color: '#4b4b4b' }}>#{index + 1}</span> {pack.name}
        </div>
        <div style={{ fontSize: 16, color: '#4b4b4b' }}>
          {pack.era === 'legacy' ? 'pre-1.13' : '1.13+'}
          {pack.packFormat !== null ? ` · fmt ${pack.packFormat}` : ''} · {pack.fileCount} files
        </div>

        <div className="row" style={{ marginTop: 8, gap: 8 }}>
          <MCButton small onClick={() => movePack(pack.id, -1)} disabled={index === 0} title="Higher priority">
            ↑
          </MCButton>
          <MCButton
            small
            onClick={() => movePack(pack.id, 1)}
            disabled={index === total - 1}
            title="Lower priority"
          >
            ↓
          </MCButton>
          <MCButton
            small
            onClick={() => setIconPack(isIcon ? null : pack.id)}
            title="Use this pack's pack.png as the exported pack icon"
            style={isIcon ? { background: '#3a7d3a', color: '#fff' } : undefined}
          >
            icon
          </MCButton>
          <MCButton
            small
            variant="danger"
            onClick={() => void removePack(pack.id)}
            title="Remove pack"
            style={{ marginLeft: 'auto' }}
          >
            ×
          </MCButton>
        </div>
      </div>
    </div>
  );
}

export function PackRail() {
  const { packs, packOrder, imports, importFiles, reorderPack } = useStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [hovering, setHovering] = useState(false);

  const ordered = packOrder
    .map((id) => packs.find((p) => p.id === id))
    .filter((p): p is ImportedPack => Boolean(p));

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setHovering(false);
    const files = [...e.dataTransfer.files];
    if (files.length > 0) void importFiles(files);
  };

  return (
    <MCPanel
      className="col"
      style={{ padding: 0, outline: hovering ? '2px dashed var(--mc-green)' : 'none' }}
    >
      <div className="section-title">Resource Packs</div>

      <div
        className="scroll"
        style={{ padding: '0 8px' }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            setHovering(true);
          }
        }}
        onDragLeave={() => setHovering(false)}
        onDrop={handleFileDrop}
      >
        {ordered.length === 0 && imports.length === 0 && (
          <div className="empty-hint">
            Drop <span style={{ color: 'var(--mc-yellow)' }}>.zip</span> texture packs here
            <br />
            <span style={{ fontSize: 16 }}>or use the button below</span>
          </div>
        )}

        {ordered.map((pack, i) => (
          <PackCard
            key={pack.id}
            pack={pack}
            index={i}
            total={ordered.length}
            dragging={dragIndex === i}
            onDragStart={() => setDragIndex(i)}
            onDragOver={(e) => {
              if (dragIndex !== null) e.preventDefault();
            }}
            onDrop={() => {
              if (dragIndex !== null) reorderPack(dragIndex, i);
              setDragIndex(null);
            }}
          />
        ))}

        {imports.map((im) => (
          <div key={im.id} className="mc-panel" style={{ padding: 6, marginBottom: 6 }}>
            <div style={{ fontSize: 16, color: '#1c1c1c' }}>{im.name}</div>
            {im.error ? (
              <div style={{ fontSize: 16, color: '#9c1c1c' }}>{im.error}</div>
            ) : (
              <>
                <div style={{ fontSize: 16, color: '#4b4b4b', marginBottom: 3 }}>{im.phase}…</div>
                <MCProgress ratio={im.ratio} />
              </>
            )}
          </div>
        ))}
      </div>

      <div style={{ padding: 8, borderTop: '2px solid #101010' }}>
        <input
          ref={inputRef}
          type="file"
          accept=".zip"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            if (files.length > 0) void importFiles(files);
            e.target.value = '';
          }}
        />
        <MCButton style={{ width: '100%' }} onClick={() => inputRef.current?.click()}>
          + Import Packs
        </MCButton>
        {ordered.length > 1 && (
          <div
            className="mc-text-shadow"
            style={{ fontSize: 16, color: 'var(--mc-text-dim)', marginTop: 6, lineHeight: 'var(--lh-body)' }}
          >
            #1 wins by default. Drag to reorder.
          </div>
        )}
      </div>

      {/* The rail runs full height whatever is in it, so the space under the
          import button is already spare. */}
      <AdSlot id="rail" variant="inset" />
    </MCPanel>
  );
}
