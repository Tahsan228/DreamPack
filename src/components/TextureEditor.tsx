import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { resolveSlot } from '../core/resolve';
import { MCButton, MCCheckbox } from './mc/MCPrimitives';
import { useTexture } from '../lib/useTexture';
import { playClick, playPaint, playPop, playThud } from '../lib/sfx';

type Tool = 'pencil' | 'eraser' | 'bucket' | 'eyedropper';

interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** One point on the editor's undo stack, dimensions included. */
interface Snapshot {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** A generic pixel-art starting palette - the 16 Minecraft dye hues plus greys. */
const PALETTE = [
  '#ffffff', '#d9d9d9', '#9c9c9c', '#666666', '#3f3f3f', '#1e1e1e', '#000000', '#ffb1b1',
  '#f9801d', '#ffd83d', '#80c71f', '#5ea63f', '#3ab3da', '#169c9c', '#3c44aa', '#8932b8',
  '#c74ebd', '#f38baa', '#835432', '#5c3a21', '#b02e26', '#7a1616', '#2a4d2a', '#123a5c',
];

const MAX_UNDO = 60;

/**
 * Widths offered by the resize control.
 *
 * Resource pack textures are powers of two - the game samples them as a grid -
 * and 16 is vanilla, so these are the sizes anyone actually targets.
 */
const SIZES = [16, 32, 64, 128, 256];

const hexToRgba = (hex: string, alpha: number): RGBA => ({
  r: parseInt(hex.slice(1, 3), 16),
  g: parseInt(hex.slice(3, 5), 16),
  b: parseInt(hex.slice(5, 7), 16),
  a: alpha,
});

const toHex = (c: RGBA) =>
  `#${[c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

const cssOf = (c: RGBA) => `rgba(${c.r},${c.g},${c.b},${(c.a / 255).toFixed(3)})`;

export function TextureEditor({ slotKey, onClose }: { slotKey: string; onClose: () => void }) {
  const { slots, packOrder, picks, saveEdit } = useStore();

  const slot = useMemo(() => slots.find((s) => s.key === slotKey) ?? null, [slots, slotKey]);
  const winner = useMemo(
    () => (slot ? resolveSlot(slot, packOrder, picks) : null),
    [slot, packOrder, picks],
  );
  const sourceUrl = useTexture(winner?.packId ?? null, winner?.primaryPath ?? null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** Working pixels at the texture's natural size. */
  const pixelsRef = useRef<ImageData | null>(null);
  // Snapshots carry their dimensions: resizing and importing at a different
  // resolution both change them, and restoring pixels into a buffer of another
  // size would either throw or quietly shear the image.
  const undoRef = useRef<Snapshot[]>([]);
  const redoRef = useRef<Snapshot[]>([]);
  const paintingRef = useRef(false);
  const importRef = useRef<HTMLInputElement>(null);
  const lastPixelRef = useRef<string>('');

  const [dims, setDims] = useState<{ width: number; height: number } | null>(null);
  const [zoom, setZoom] = useState(12);
  const [tool, setTool] = useState<Tool>('pencil');
  const [color, setColor] = useState<RGBA>({ r: 255, g: 255, b: 255, a: 255 });
  const [recent, setRecent] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [grid, setGrid] = useState(true);
  const [keepSourceSize, setKeepSourceSize] = useState(false);
  const [historyTick, setHistoryTick] = useState(0);
  const [strokeTick, setStrokeTick] = useState(0);
  const [saving, setSaving] = useState(false);
  // Undo/redo live in refs so painting does not re-render; these mirror their
  // depths so the buttons can disable correctly.
  const [history, setHistory] = useState({ undo: 0, redo: 0 });
  const syncHistory = useCallback(
    () => setHistory({ undo: undoRef.current.length, redo: redoRef.current.length }),
    [],
  );

  /** Repaint the visible canvas from the working pixels. */
  const repaint = useCallback(() => {
    const canvas = canvasRef.current;
    const pixels = pixelsRef.current;
    if (!canvas || !pixels) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw the pixels at 1:1 on a scratch canvas, then blow it up with smoothing
    // off so every texel stays a hard square.
    const scratch = document.createElement('canvas');
    scratch.width = pixels.width;
    scratch.height = pixels.height;
    scratch.getContext('2d')?.putImageData(pixels, 0, 0);

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Checkerboard so transparency is obvious while painting.
    const square = Math.max(4, Math.round(zoom / 2));
    for (let y = 0; y < canvas.height; y += square) {
      for (let x = 0; x < canvas.width; x += square) {
        ctx.fillStyle = ((x / square + y / square) | 0) % 2 === 0 ? '#6e6e6e' : '#5a5a5a';
        ctx.fillRect(x, y, square, square);
      }
    }

    ctx.drawImage(scratch, 0, 0, canvas.width, canvas.height);

    if (grid && zoom >= 8) {
      ctx.strokeStyle = 'rgba(0,0,0,0.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= pixels.width; x++) {
        ctx.moveTo(x * zoom + 0.5, 0);
        ctx.lineTo(x * zoom + 0.5, canvas.height);
      }
      for (let y = 0; y <= pixels.height; y++) {
        ctx.moveTo(0, y * zoom + 0.5);
        ctx.lineTo(canvas.width, y * zoom + 0.5);
      }
      ctx.stroke();
    }
  }, [zoom, grid]);

  // Load the resolved texture into the working buffer.
  useEffect(() => {
    if (!sourceUrl) return;
    let alive = true;

    const image = new Image();
    image.onload = () => {
      if (!alive) return;
      const scratch = document.createElement('canvas');
      scratch.width = image.naturalWidth;
      scratch.height = image.naturalHeight;
      const ctx = scratch.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(image, 0, 0);

      pixelsRef.current = ctx.getImageData(0, 0, scratch.width, scratch.height);
      undoRef.current = [];
      redoRef.current = [];
      syncHistory();
      setDims({ width: scratch.width, height: scratch.height });
      setDirty(false);

      // Fit the texture to roughly a 420px box, clamped to whole-pixel zooms.
      const fit = Math.floor(420 / Math.max(scratch.width, scratch.height));
      setZoom(Math.max(1, Math.min(24, fit || 1)));
    };
    image.src = sourceUrl;

    return () => {
      alive = false;
    };
  }, [sourceUrl, syncHistory]);

  useEffect(() => {
    repaint();
  }, [repaint, dims, historyTick]);

  const snapshot = (pixels: ImageData): Snapshot => ({
    data: new Uint8ClampedArray(pixels.data),
    width: pixels.width,
    height: pixels.height,
  });

  const pushUndo = useCallback(() => {
    const pixels = pixelsRef.current;
    if (!pixels) return;
    undoRef.current.push({
      data: new Uint8ClampedArray(pixels.data),
      width: pixels.width,
      height: pixels.height,
    });
    if (undoRef.current.length > MAX_UNDO) undoRef.current.shift();
    redoRef.current = [];
    syncHistory();
  }, [syncHistory]);

  const setPixel = (pixels: ImageData, x: number, y: number, c: RGBA) => {
    const i = (y * pixels.width + x) * 4;
    pixels.data[i] = c.r;
    pixels.data[i + 1] = c.g;
    pixels.data[i + 2] = c.b;
    pixels.data[i + 3] = c.a;
  };

  const getPixel = (pixels: ImageData, x: number, y: number): RGBA => {
    const i = (y * pixels.width + x) * 4;
    return {
      r: pixels.data[i],
      g: pixels.data[i + 1],
      b: pixels.data[i + 2],
      a: pixels.data[i + 3],
    };
  };

  const floodFill = (pixels: ImageData, x: number, y: number, c: RGBA) => {
    const target = getPixel(pixels, x, y);
    const same = (p: RGBA) => p.r === target.r && p.g === target.g && p.b === target.b && p.a === target.a;
    if (same(c)) return;

    const stack: Array<[number, number]> = [[x, y]];
    const seen = new Uint8Array(pixels.width * pixels.height);

    while (stack.length > 0) {
      const [cx, cy] = stack.pop()!;
      if (cx < 0 || cy < 0 || cx >= pixels.width || cy >= pixels.height) continue;
      const flat = cy * pixels.width + cx;
      if (seen[flat]) continue;
      if (!same(getPixel(pixels, cx, cy))) continue;

      seen[flat] = 1;
      setPixel(pixels, cx, cy, c);
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
  };

  const rememberColor = (c: RGBA) => {
    const hex = toHex(c);
    setRecent((list) => [hex, ...list.filter((h) => h !== hex)].slice(0, 16));
  };

  const applyAt = (clientX: number, clientY: number, isStart: boolean) => {
    const canvas = canvasRef.current;
    const pixels = pixelsRef.current;
    if (!canvas || !pixels) return;

    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((clientX - rect.left) / rect.width) * pixels.width);
    const y = Math.floor(((clientY - rect.top) / rect.height) * pixels.height);
    if (x < 0 || y < 0 || x >= pixels.width || y >= pixels.height) return;

    if (tool === 'eyedropper') {
      const picked = getPixel(pixels, x, y);
      setColor(picked);
      rememberColor(picked);
      playPop();
      setTool('pencil');
      return;
    }

    // Dragging across one pixel repeatedly should not spam undo entries or sound.
    const id = `${x},${y}`;
    if (!isStart && id === lastPixelRef.current) return;
    lastPixelRef.current = id;

    if (isStart) pushUndo();

    if (tool === 'bucket') {
      floodFill(pixels, x, y, color);
      rememberColor(color);
      playPop();
    } else if (tool === 'eraser') {
      setPixel(pixels, x, y, { r: 0, g: 0, b: 0, a: 0 });
      playPaint();
    } else {
      setPixel(pixels, x, y, color);
      if (isStart) rememberColor(color);
      playPaint();
    }

    setDirty(true);
    repaint();
  };

  /** Put a snapshot back, growing or shrinking the buffer if it was resized. */
  const restore = (target: Snapshot) => {
    const pixels = pixelsRef.current;
    if (pixels && pixels.width === target.width && pixels.height === target.height) {
      pixels.data.set(target.data);
    } else {
      const next = new ImageData(target.width, target.height);
      next.data.set(target.data);
      pixelsRef.current = next;
      setDims({ width: target.width, height: target.height });
    }
    setDirty(true);
    setStrokeTick((t) => t + 1);
    setHistoryTick((t) => t + 1);
    syncHistory();
    playClick();
  };

  const undo = () => {
    const pixels = pixelsRef.current;
    const previous = undoRef.current.pop();
    if (!pixels || !previous) return;
    redoRef.current.push(snapshot(pixels));
    restore(previous);
  };

  const redo = () => {
    const pixels = pixelsRef.current;
    const next = redoRef.current.pop();
    if (!pixels || !next) return;
    undoRef.current.push(snapshot(pixels));
    restore(next);
  };

  /**
   * Draw an image file onto the texture.
   *
   * By default the import is scaled to the texture's existing dimensions, since
   * a resource pack expects a given size (and for animated textures, a given
   * filmstrip shape). "keep source size" instead adopts the image's own
   * dimensions, which is how you upgrade a 16x texture to 32x or higher.
   */
  const importImage = (file: File) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      const current = pixelsRef.current;
      if (!current) {
        URL.revokeObjectURL(url);
        return;
      }
      pushUndo();

      const width = keepSourceSize ? image.naturalWidth : current.width;
      const height = keepSourceSize ? image.naturalHeight : current.height;

      const scratch = document.createElement('canvas');
      scratch.width = width;
      scratch.height = height;
      const ctx = scratch.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        return;
      }

      // Nearest neighbour, so pixel art stays pixel art at any scale.
      ctx.imageSmoothingEnabled = false;

      if (keepSourceSize) {
        ctx.drawImage(image, 0, 0);
      } else {
        // Letterbox rather than stretch, so the artwork keeps its proportions.
        const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
        const w = Math.max(1, Math.round(image.naturalWidth * scale));
        const h = Math.max(1, Math.round(image.naturalHeight * scale));
        ctx.drawImage(image, Math.floor((width - w) / 2), Math.floor((height - h) / 2), w, h);
      }

      pixelsRef.current = ctx.getImageData(0, 0, width, height);
      setDims({ width, height });
      setDirty(true);
      setStrokeTick((t) => t + 1);
      setHistoryTick((t) => t + 1);
      playPop();
      URL.revokeObjectURL(url);
    };

    image.onerror = () => URL.revokeObjectURL(url);
    image.src = url;
  };

  /**
   * Resample the texture to a new resolution.
   *
   * This is how you take a 16x pack up to 32x or higher: the art is redrawn at
   * the new size with nearest-neighbour sampling, so upscaling gives you clean
   * blocks of solid colour to paint detail into rather than a blurred mess.
   *
   * The aspect ratio is held, which matters more than it looks: an animated
   * texture is a filmstrip of N square frames, and changing its proportions
   * would silently change how many frames the game thinks it has.
   */
  const resizeTo = (targetWidth: number) => {
    const current = pixelsRef.current;
    if (!current || current.width === targetWidth) return;

    const targetHeight = Math.max(
      1,
      Math.round(current.height * (targetWidth / current.width)),
    );

    const source = document.createElement('canvas');
    source.width = current.width;
    source.height = current.height;
    const sourceCtx = source.getContext('2d');
    if (!sourceCtx) return;
    sourceCtx.putImageData(current, 0, 0);

    const scaled = document.createElement('canvas');
    scaled.width = targetWidth;
    scaled.height = targetHeight;
    const ctx = scaled.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(source, 0, 0, targetWidth, targetHeight);

    pushUndo();
    pixelsRef.current = ctx.getImageData(0, 0, targetWidth, targetHeight);
    setDims({ width: targetWidth, height: targetHeight });
    setDirty(true);
    setStrokeTick((t) => t + 1);
    setHistoryTick((t) => t + 1);

    // Refit the zoom, or a jump to 256 leaves the canvas overflowing its pane.
    const fit = Math.floor(420 / Math.max(targetWidth, targetHeight));
    setZoom(Math.max(1, Math.min(24, fit || 1)));
    playPop();
  };

  const handleSave = async () => {
    const pixels = pixelsRef.current;
    if (!pixels || saving) return;
    setSaving(true);

    const scratch = document.createElement('canvas');
    scratch.width = pixels.width;
    scratch.height = pixels.height;
    scratch.getContext('2d')?.putImageData(pixels, 0, 0);

    const blob = await new Promise<Blob | null>((resolve) =>
      scratch.toBlob((b) => resolve(b), 'image/png'),
    );
    if (!blob) {
      setSaving(false);
      return;
    }

    await saveEdit(slotKey, new Uint8Array(await blob.arrayBuffer()), pixels.width, pixels.height);
    playPop();
    onClose();
  };

  const handleExit = () => {
    if (dirty && !window.confirm('Discard your changes to this texture?')) return;
    playThud();
    onClose();
  };

  // Keyboard shortcuts mirror the usual pixel-art editors.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleExit();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      const map: Record<string, Tool> = { b: 'pencil', e: 'eraser', g: 'bucket', i: 'eyedropper' };
      const next = map[e.key.toLowerCase()];
      if (next) setTool(next);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /** Distinct colours already in the texture, most common first. */
  const textureColors = useMemo(() => {
    const pixels = pixelsRef.current;
    if (!pixels) return [];
    const counts = new Map<string, number>();
    for (let i = 0; i < pixels.data.length; i += 4) {
      if (pixels.data[i + 3] < 8) continue;
      const hex = `#${[pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]]
        .map((v) => v.toString(16).padStart(2, '0'))
        .join('')}`;
      counts.set(hex, (counts.get(hex) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24).map(([hex]) => hex);
    // Recomputed when the image loads, on undo/redo, and at the end of a stroke.
  }, [dims, historyTick, strokeTick]);

  if (!slot) return null;

  const swatch = (hex: string, keyPrefix: string) => (
    <button
      key={`${keyPrefix}${hex}`}
      className="mc-swatch"
      style={{ background: hex }}
      title={hex}
      onClick={() => {
        setColor(hexToRgba(hex, color.a));
        playClick();
      }}
    />
  );

  return (
    <div className="editor-overlay" role="dialog" aria-modal="true" aria-label="Texture editor">
      <div className="mc-panel-dark editor-shell">
        {/* Header */}
        <div className="row editor-head">
          <span className="t-yellow editor-head-title">Editing: {slot.displayName}</span>
          <span className="t-gray editor-head-dims">
            {dims ? `${dims.width}×${dims.height}` : '…'}
            {dirty ? ' · unsaved' : ''}
          </span>
          <div className="row editor-head-actions">
            <MCButton variant="primary" onClick={() => void handleSave()} disabled={!dims || saving}>
              {saving ? 'Saving…' : 'Save & Exit'}
            </MCButton>
            <MCButton onClick={handleExit}>Cancel</MCButton>
          </div>
        </div>

        <div className="editor-body">
          {/* Tools and colours */}
          <div className="editor-side scroll">
            <div className="section-title">Tools</div>
            {/* Word labels, not icon glyphs: the pixel font has no tool symbols,
                and the shortcut hint fits better this way. */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '0 10px' }}>
              {([
                ['pencil', 'draw', 'Pencil - paint single pixels (B)'],
                ['eraser', 'erase', 'Eraser - clear pixels to transparent (E)'],
                ['bucket', 'fill', 'Fill - flood the matching area (G)'],
                ['eyedropper', 'pick', 'Eyedropper - sample a colour (I)'],
              ] as Array<[Tool, string, string]>).map(([id, label, hint]) => (
                <MCButton
                  key={id}
                  small
                  onClick={() => setTool(id)}
                  title={hint}
                  style={tool === id ? { background: '#3a7d3a', color: '#fff' } : undefined}
                >
                  {label}
                </MCButton>
              ))}
            </div>

            {/* Resolution is not fixed to whatever the source pack shipped:
                this is how a 16x texture is taken up to 32x or higher. */}
            <div className="section-title">Size</div>
            <div style={{ padding: '0 10px' }}>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {SIZES.map((size) => (
                  <MCButton
                    key={size}
                    small
                    onClick={() => resizeTo(size)}
                    disabled={!dims}
                    title={
                      dims && dims.height !== dims.width
                        ? `Resample to ${size} wide, keeping the filmstrip's proportions`
                        : `Resample this texture to ${size}x${size}`
                    }
                    style={dims?.width === size ? { background: '#3a7d3a', color: '#fff' } : undefined}
                  >
                    {size}
                  </MCButton>
                ))}
              </div>
              <div
                className="t-gray"
                style={{ fontSize: 16, marginTop: 6, lineHeight: 'var(--lh-body)' }}
              >
                {dims
                  ? dims.height === dims.width
                    ? `now ${dims.width}x${dims.height}`
                    : `now ${dims.width}x${dims.height} · ${Math.max(1, Math.floor(dims.height / dims.width))} frames`
                  : 'loading'}
              </div>
            </div>

            <div className="section-title">Image</div>
            <div style={{ padding: '0 10px' }}>
              <MCButton
                small
                onClick={() => importRef.current?.click()}
                title="Draw a PNG or JPG onto this texture"
                style={{ width: '100%' }}
              >
                import image
              </MCButton>
              <input
                ref={importRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) importImage(file);
                  e.target.value = '';
                }}
              />
              <div style={{ marginTop: 6 }}>
                <MCCheckbox
                  checked={keepSourceSize}
                  onChange={() => setKeepSourceSize((v) => !v)}
                  label="keep source size"
                  title={
                    keepSourceSize
                      ? "The texture is resized to the imported image - use this to move up to a higher resolution pack"
                      : `The image is scaled to fit ${dims ? dims.width + 'x' + dims.height : 'the texture'}, keeping its proportions`
                  }
                />
              </div>
            </div>

            <div className="section-title">Colour</div>
            <div style={{ padding: '0 10px' }}>
              <div className="row" style={{ gap: 8 }}>
                <input
                  type="color"
                  className="mc-color"
                  value={toHex(color)}
                  onChange={(e) => setColor(hexToRgba(e.target.value, color.a))}
                  aria-label="Pick a colour"
                />
                <div
                  className="mc-inset mc-checker"
                  style={{ width: 34, height: 34, flex: 'none' }}
                  title={`${toHex(color)} · alpha ${color.a}`}
                >
                  <div style={{ width: '100%', height: '100%', background: cssOf(color) }} />
                </div>
              </div>

              <label className="mc-text-shadow" style={{ fontSize: 16, display: 'block', marginTop: 8 }}>
                alpha {color.a}
                <input
                  type="range"
                  min={0}
                  max={255}
                  value={color.a}
                  onChange={(e) => setColor({ ...color, a: Number(e.target.value) })}
                  className="mc-range"
                />
              </label>
            </div>

            <div className="section-title">Palette</div>
            <div className="editor-swatches">{PALETTE.map((hex) => swatch(hex, 'p'))}</div>

            {recent.length > 0 && (
              <>
                <div className="section-title">Recent</div>
                <div className="editor-swatches">{recent.map((hex) => swatch(hex, 'r'))}</div>
              </>
            )}

            {textureColors.length > 0 && (
              <>
                <div className="section-title">In this texture</div>
                <div className="editor-swatches">{textureColors.map((hex) => swatch(hex, 't'))}</div>
              </>
            )}

            <div className="section-title">History</div>
            <div className="row" style={{ padding: '0 10px 14px', gap: 8 }}>
              <MCButton small onClick={undo} disabled={history.undo === 0}>
                undo
              </MCButton>
              <MCButton small onClick={redo} disabled={history.redo === 0}>
                redo
              </MCButton>
            </div>
          </div>

          {/* Canvas */}
          <div className="editor-stage">
            {dims ? (
              <canvas
                ref={canvasRef}
                width={dims.width * zoom}
                height={dims.height * zoom}
                className="editor-canvas"
                style={{ cursor: tool === 'eyedropper' ? 'crosshair' : 'cell' }}
                onPointerDown={(e) => {
                  paintingRef.current = true;
                  lastPixelRef.current = '';
                  e.currentTarget.setPointerCapture(e.pointerId);
                  applyAt(e.clientX, e.clientY, true);
                }}
                onPointerMove={(e) => {
                  if (paintingRef.current) applyAt(e.clientX, e.clientY, false);
                }}
                onPointerUp={(e) => {
                  paintingRef.current = false;
                  e.currentTarget.releasePointerCapture(e.pointerId);
                  setStrokeTick((t) => t + 1);
                }}
                onPointerCancel={() => {
                  paintingRef.current = false;
                  setStrokeTick((t) => t + 1);
                }}
              />
            ) : (
              <div className="empty-hint">Loading texture…</div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          className="row"
          style={{ padding: '8px 10px', borderTop: '2px solid #101010', gap: 10, flexWrap: 'wrap' }}
        >
          <span className="t-gray" style={{ fontSize: 16 }}>
            zoom {zoom}×
          </span>
          <MCButton small onClick={() => setZoom((z) => Math.max(1, z - 2))}>
            -
          </MCButton>
          <MCButton small onClick={() => setZoom((z) => Math.min(40, z + 2))}>
            +
          </MCButton>
          <MCButton
            small
            onClick={() => setGrid((g) => !g)}
            style={grid ? { background: '#3a7d3a', color: '#fff' } : undefined}
          >
            grid
          </MCButton>
          <span className="t-gray" style={{ fontSize: 16, marginLeft: 'auto' }}>
            saves into “My Edits” and pins this slot to it
          </span>
        </div>
      </div>
    </div>
  );
}
