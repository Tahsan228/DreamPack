import { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../state/store';
import { orderCandidates, resolveSlot } from '../core/resolve';
import type { AssetSlot, Candidate, ImportedPack } from '../core/types';
import { MCButton, MCPanel, TexturePreview } from './mc/MCPrimitives';
import { Viewport3D } from './Viewport3D';
import { canPreview3D, shapeForKey } from '../core/blockShapes';
import { useAnimation, useImageSize, useTexture } from '../lib/useTexture';

const PREVIEW = 176;
// Wide enough for a pack name at 16px; narrower and every pack reads "Test...".
const CHIP = 88;

function SoundButton({ packId, path }: { packId: string; path: string }) {
  const url = useTexture(packId, path);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
      // Without this the button keeps reading "stop" after the sound behind it
      // has been torn down, and the next click only resets it.
      setPlaying(false);
    };
  }, [url]);

  const toggle = () => {
    if (!url) return;
    if (!audioRef.current) {
      audioRef.current = new Audio(url);
      audioRef.current.onended = () => setPlaying(false);
    }
    if (playing) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setPlaying(false);
    } else {
      void audioRef.current.play();
      setPlaying(true);
    }
  };

  return (
    <MCButton onClick={toggle} disabled={!url} title="Play this sound">
      {playing ? '■ stop' : '▶ play'}
    </MCButton>
  );
}

function CandidateChip({
  slot,
  candidate,
  pack,
  index,
  isWinner,
  isPicked,
  onPick,
}: {
  slot: AssetSlot;
  candidate: Candidate;
  pack: ImportedPack;
  /** Position in the strip; 1-9 are also the keyboard shortcuts for it. */
  index: number;
  isWinner: boolean;
  isPicked: boolean;
  onPick: () => void;
}) {
  const isImage = slot.key.startsWith('texture:');
  const url = useTexture(isImage ? candidate.packId : null, candidate.primaryPath);

  return (
    <button
      onClick={onPick}
      className="mc-slot"
      style={{
        width: CHIP,
        height: CHIP + 16,
        flex: 'none',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
        padding: 2,
        boxShadow: isPicked
          ? '0 0 0 2px var(--mc-yellow)'
          : isWinner
            ? '0 0 0 2px var(--mc-green)'
            : 'none',
      }}
      title={`${pack.name}\n${candidate.primaryPath}\n${candidate.width ?? '?'}×${candidate.height ?? '?'} · ${candidate.size} B${index <= 9 ? `\n\nPress ${index} to pick this` : ''}${isPicked ? '\n\nPicked' : isWinner ? '\n\nWinning by priority' : ''}`}
    >
      {index <= 9 && (
        <span
          aria-hidden="true"
          style={{ position: 'absolute', left: 3, top: 1, fontSize: 16, color: '#4b4b4b' }}
        >
          {index}
        </span>
      )}
      <div style={{ width: CHIP - 8, height: CHIP - 8, display: 'grid', placeItems: 'center' }}>
        {isImage && url ? (
          <img src={url} alt={pack.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        ) : (
          <span style={{ fontSize: 24, color: '#3f3f3f' }}>
            {slot.category === 'Sounds' ? '♪' : '{}'}
          </span>
        )}
      </div>
      <div
        style={{
          fontSize: 16,
          color: '#1c1c1c',
          maxWidth: CHIP - 6,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          lineHeight: 'var(--lh-body)',
        }}
      >
        {pack.name}
      </div>
      <span className="mc-pip" style={{ background: pack.color, bottom: 'auto', top: 2, right: 2 }} />
    </button>
  );
}

export function Viewport() {
  const { slots, packs, packOrder, picks, selectedKey, pick, clearPick, openEditor } = useStore(
    useShallow((s) => ({
      slots: s.slots, packs: s.packs, packOrder: s.packOrder, picks: s.picks,
      selectedKey: s.selectedKey, pick: s.pick, clearPick: s.clearPick,
      openEditor: s.openEditor,
    })),
  );
  const [mode, setMode] = useState<'2d' | '3d'>('2d');
  const [playing, setPlaying] = useState(true);
  const [frame, setFrame] = useState(0);

  const slot = useMemo(
    () => (selectedKey ? slots.find((s) => s.key === selectedKey) ?? null : null),
    [slots, selectedKey],
  );

  const winner = useMemo(
    () => (slot ? resolveSlot(slot, packOrder, picks) : null),
    [slot, packOrder, picks],
  );

  const isImage = Boolean(slot?.key.startsWith('texture:'));
  const url = useTexture(isImage && winner ? winner.packId : null, winner?.primaryPath ?? null);
  const size = useImageSize(url);

  const mcmetaPath = winner?.companions.find((c) => c.endsWith('.mcmeta')) ?? null;
  const animation = useAnimation(winner?.packId ?? null, mcmetaPath);

  // A filmstrip texture is N square frames stacked vertically.
  const frameCount = useMemo(() => {
    if (!animation || !size || size.width === 0) return 1;
    return Math.max(1, Math.floor(size.height / size.width));
  }, [animation, size]);

  /** Frame indices to cycle through; empty when the texture is still. */
  const sequence = useMemo(() => {
    if (!animation) return [];
    if (animation.frames && animation.frames.length > 0) return animation.frames;
    return Array.from({ length: frameCount }, (_, i) => i);
  }, [animation, frameCount]);

  const isAnimated = sequence.length > 1;

  useEffect(() => {
    setFrame(0);
  }, [selectedKey, winner?.packId]);

  useEffect(() => {
    if (!playing || !isAnimated || !animation) return;
    // Minecraft's frametime is measured in ticks: 1 tick = 50ms.
    const id = window.setInterval(
      () => setFrame((f) => (f + 1) % sequence.length),
      Math.max(50, animation.frametime * 50),
    );
    return () => window.clearInterval(id);
  }, [playing, isAnimated, sequence.length, animation]);

  const packById = useMemo(() => new Map(packs.map((p) => [p.id, p])), [packs]);

  // Shared with the grid's number keys, so "press 2" always means the second
  // chip in this strip.
  const orderedCandidates = useMemo(
    () => (slot ? orderCandidates(slot, packOrder) : []),
    [slot, packOrder],
  );

  if (!slot) {
    return (
      <MCPanel className="col" style={{ padding: 0 }}>
        <div className="section-title">Viewport</div>
        <div className="empty-hint" style={{ marginTop: 40 }}>
          Select an asset to preview it
          <br />
          <span style={{ fontSize: 16 }}>and choose which pack it comes from.</span>
        </div>
      </MCPanel>
    );
  }

  const pickedPackId = picks[slot.key];
  const canUse3D = canPreview3D(slot.key, slot.category);
  const effectiveMode = canUse3D ? mode : '2d';
  const shape = shapeForKey(slot.key, slot.category);

  return (
    <MCPanel className="col" style={{ padding: 0 }}>
      <div className="section-title">Viewport</div>

      <div className="scroll" style={{ padding: '0 10px 10px' }}>
        <div className="t-yellow" style={{ fontSize: 24, lineHeight: 'var(--lh-title)' }}>
          {slot.displayName}
        </div>
        <div
          className="t-gray"
          style={{ fontSize: 16, wordBreak: 'break-all', marginBottom: 8 }}
        >
          {slot.key}
        </div>

        {/* Preview */}
        <div className="row" style={{ justifyContent: 'center' }}>
          <div className="mc-inset" style={{ padding: 6, display: 'inline-block' }}>
            {effectiveMode === '3d' ? (
              <Viewport3D url={url} shape={shape} size={PREVIEW} />
            ) : (
              <TexturePreview
                src={isImage ? url : null}
                size={PREVIEW}
                animated={isAnimated}
                frame={isAnimated ? sequence[frame] ?? 0 : 0}
                alt={slot.displayName}
              />
            )}
          </div>
        </div>

        {/* Preview controls */}
        <div className="row" style={{ justifyContent: 'center', marginTop: 10, gap: 8 }}>
          {canUse3D && (
            <>
              <MCButton
                small
                onClick={() => setMode('2d')}
                style={effectiveMode === '2d' ? { background: '#3a7d3a', color: '#fff' } : undefined}
              >
                2D
              </MCButton>
              <MCButton
                small
                onClick={() => setMode('3d')}
                style={effectiveMode === '3d' ? { background: '#3a7d3a', color: '#fff' } : undefined}
                title="Drag to rotate, double-click to pause spin"
              >
                3D
              </MCButton>
            </>
          )}
          {isAnimated && effectiveMode === '2d' && (
            <>
              <MCButton small onClick={() => setPlaying((p) => !p)}>
                {playing ? '■' : '▶'}
              </MCButton>
              <span className="t-gray" style={{ fontSize: 16 }}>
                frame {frame + 1}/{sequence.length}
              </span>
            </>
          )}
          {slot.category === 'Sounds' && winner && (
            <SoundButton
              key={`${winner.packId}:${winner.primaryPath}`}
              packId={winner.packId}
              path={winner.primaryPath}
            />
          )}
        </div>


        {isImage && winner && (
          <div className="row" style={{ justifyContent: 'center', marginTop: 6 }}>
            <MCButton
              onClick={() => openEditor(slot.key)}
              title="Paint on this texture. Saved edits go into your own pack and win this slot."
            >
              Edit Texture
            </MCButton>
          </div>
        )}

        {/* Metadata */}
        <div className="mc-panel" style={{ padding: 6, marginTop: 10, fontSize: 16, lineHeight: 'var(--lh-body)' }}>
          <div>
            <b>source</b> {winner ? packById.get(winner.packId)?.name ?? '?' : '-'}
            {pickedPackId ? ' (picked)' : winner ? ' (priority)' : ''}
          </div>
          <div style={{ wordBreak: 'break-all' }}>
            <b>path</b> {winner?.primaryPath ?? '-'}
          </div>
          <div>
            <b>size</b>{' '}
            {size ? `${size.width}×${size.height}px` : winner ? `${winner.size} B` : '-'}
            {isAnimated ? ` · ${sequence.length} frames` : ''}
          </div>
          {slot.unmapped && (
            <div style={{ color: '#8a5a00' }}>
              <b>!</b> no cross-version name mapping - exports under its original filename
            </div>
          )}
        </div>

        {/* Candidate strip */}
        <div className="section-title" style={{ padding: '12px 0 6px' }}>
          From which pack ({orderedCandidates.length})
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {orderedCandidates.map((candidate, i) => {
            const pack = packById.get(candidate.packId);
            if (!pack) return null;
            return (
              <CandidateChip
                key={candidate.packId}
                slot={slot}
                candidate={candidate}
                pack={pack}
                index={i + 1}
                isWinner={winner?.packId === candidate.packId}
                isPicked={pickedPackId === candidate.packId}
                onPick={() =>
                  pickedPackId === candidate.packId
                    ? clearPick(slot.key)
                    : pick(slot.key, candidate.packId)
                }
              />
            );
          })}
        </div>

        {pickedPackId && (
          <MCButton
            small
            style={{ marginTop: 8 }}
            onClick={() => clearPick(slot.key)}
            title="Fall back to the pack priority order"
          >
            reset to priority
          </MCButton>
        )}

        {orderedCandidates.length === 1 && (
          <div className="t-gray" style={{ fontSize: 16, marginTop: 8, lineHeight: 'var(--lh-body)' }}>
            Only one pack has this asset.
          </div>
        )}
      </div>
    </MCPanel>
  );
}
