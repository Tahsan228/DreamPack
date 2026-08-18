import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { resolveSlot } from '../core/resolve';
import { denormalize } from '../core/canonical';
import { getVersion } from '../core/versions';
import { downloadBlob } from '../lib/download';
import { MCButton, MCCheckbox } from './mc/MCPrimitives';
import { useTexture } from '../lib/useTexture';
import { playClick, playPaint, playPop, playThud } from '../lib/sfx';
import {
  clampRect, countCovered, covers, dragHandle, hitHandle, rectFromDrag, texelFromClient,
  type Handle, type HitTarget, type Rect, type Selection,
} from '../lib/selection';
import { scaleMask, selectSimilar } from '../lib/wand';
import {
  crop, drawScaled, floodFill, getPixel, setPixel,
  type PixelBuffer, type RGBA,
} from '../lib/pixelBuffer';
import { adjustInto, isNeutral, NEUTRAL, type Adjustment } from '../lib/adjust';

type Tool = 'select' | 'wand' | 'pencil' | 'eraser' | 'bucket' | 'eyedropper';

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

/** Size of a selection handle, in screen pixels, so it is grabbable at any zoom. */
const HANDLE = 9;

const CURSOR_FOR: Record<string, string> = {
  nw: 'nwse-resize', se: 'nwse-resize',
  ne: 'nesw-resize', sw: 'nesw-resize',
  n: 'ns-resize', s: 'ns-resize',
  w: 'ew-resize', e: 'ew-resize',
  inside: 'move',
};

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
  const { slots, packOrder, picks, saveEdit, targetVersion } = useStore();

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

  /**
   * A transform in progress: the pixels as they were when they were lifted, and
   * where they currently sit.
   *
   * The crop is the only thing a drag ever resamples from, so scaling a piece
   * down to a texel and back up returns the artwork rather than the blur that
   * resampling the last result would leave.
   */
  const floatRef = useRef<{ source: PixelBuffer; rect: Rect } | null>(null);
  /**
   * The pixels as they were before the current colour adjustment, and the region
   * it covers.
   *
   * Every slider move re-derives from this rather than from the last result:
   * running an 8-bit colour transform over its own output loses a little more on
   * each pass, so sliding back to neutral has to *return* to the original rather
   * than approach it.
   */
  const adjustBaseRef = useRef<{ source: PixelBuffer; area: Selection | null } | null>(null);
  const gestureRef = useRef<
    | {
        mode: 'new' | 'move' | 'resize';
        handle: Handle | null;
        startRect: Rect;
        startX: number;
        startY: number;
      }
    | null
  >(null);

  const [dims, setDims] = useState<{ width: number; height: number } | null>(null);
  const [zoom, setZoom] = useState(12);
  const [tool, setTool] = useState<Tool>('pencil');
  const [selection, setSelection] = useState<Selection | null>(null);
  /** How far a colour may differ and still be picked up by the wand. */
  const [tolerance, setTolerance] = useState(0.12);
  const [everywhere, setEverywhere] = useState(false);
  const [adjustment, setAdjustment] = useState<Adjustment>(NEUTRAL);
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

    // Lifted pixels ride above the texture until they are stamped down, so the
    // hole they came from stays visible underneath while they are being placed.
    const float = floatRef.current;
    if (float) {
      const piece = document.createElement('canvas');
      piece.width = float.source.width;
      piece.height = float.source.height;
      piece.getContext('2d')?.putImageData(
        new ImageData(
          new Uint8ClampedArray(float.source.data),
          float.source.width,
          float.source.height,
        ),
        0,
        0,
      );
      ctx.drawImage(
        piece,
        float.rect.x * zoom, float.rect.y * zoom,
        float.rect.w * zoom, float.rect.h * zoom,
      );
    }

    if (!selection) return;

    const { rect } = selection;
    const sx = rect.x * zoom;
    const sy = rect.y * zoom;
    const sw = rect.w * zoom;
    const sh = rect.h * zoom;
    const selecting = tool === 'select' || tool === 'wand';

    // Dim the rest only while selecting. Under a paint tool it would falsify the
    // colours you are trying to match.
    if (selecting) {
      // Everything except the selected texels, as one even-odd path: a wand
      // selection is a shape, so four rectangles around a box will not do.
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.rect(0, 0, canvas.width, canvas.height);
      for (let y = rect.y; y < rect.y + rect.h; y++) {
        let runStart = -1;
        for (let x = rect.x; x <= rect.x + rect.w; x++) {
          const inside = x < rect.x + rect.w && covers(selection, x, y);
          if (inside && runStart === -1) runStart = x;
          if (!inside && runStart !== -1) {
            ctx.rect(runStart * zoom, y * zoom, (x - runStart) * zoom, zoom);
            runStart = -1;
          }
        }
      }
      ctx.fill('evenodd');
    }

    // White over black, so the outline reads on any artwork.
    const outline = new Path2D();
    if (selection.mask) {
      // Trace the edge of the shape: a side is drawn wherever its neighbour is out.
      for (let y = rect.y; y < rect.y + rect.h; y++) {
        for (let x = rect.x; x < rect.x + rect.w; x++) {
          if (!covers(selection, x, y)) continue;
          const px = x * zoom;
          const py = y * zoom;
          if (!covers(selection, x, y - 1)) { outline.moveTo(px, py); outline.lineTo(px + zoom, py); }
          if (!covers(selection, x, y + 1)) { outline.moveTo(px, py + zoom); outline.lineTo(px + zoom, py + zoom); }
          if (!covers(selection, x - 1, y)) { outline.moveTo(px, py); outline.lineTo(px, py + zoom); }
          if (!covers(selection, x + 1, y)) { outline.moveTo(px + zoom, py); outline.lineTo(px + zoom, py + zoom); }
        }
      }
    } else {
      outline.rect(sx + 1, sy + 1, Math.max(1, sw - 2), Math.max(1, sh - 2));
    }

    ctx.setLineDash([]);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#000';
    ctx.stroke(outline);
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#fff';
    if (!selection.mask) ctx.setLineDash([6, 6]);
    ctx.stroke(outline);
    ctx.setLineDash([]);

    // Handles sit on the bounding box; a shape is still moved and scaled by it.
    if (!selecting) return;

    // A box against the edge of the texture would have half of its handles drawn
    // off the canvas, which reads as though that side cannot be resized.
    const onCanvas = (v: number, limit: number) =>
      Math.max(HANDLE / 2, Math.min(v, limit - HANDLE / 2));

    for (const [hx, hy] of [
      [sx, sy], [sx + sw / 2, sy], [sx + sw, sy],
      [sx, sy + sh / 2], [sx + sw, sy + sh / 2],
      [sx, sy + sh], [sx + sw / 2, sy + sh], [sx + sw, sy + sh],
    ]) {
      const cx = onCanvas(hx, canvas.width);
      const cy = onCanvas(hy, canvas.height);
      ctx.fillStyle = '#fff';
      ctx.fillRect(cx - HANDLE / 2, cy - HANDLE / 2, HANDLE, HANDLE);
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.strokeRect(cx - HANDLE / 2, cy - HANDLE / 2, HANDLE, HANDLE);
    }
  }, [zoom, grid, selection, tool]);

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

  const rememberColor = (c: RGBA) => {
    const hex = toHex(c);
    setRecent((list) => [hex, ...list.filter((h) => h !== hex)].slice(0, 16));
  };

  // ---- Selection ---------------------------------------------------------

  /**
   * Take the selected pixels out of the texture and hold them.
   *
   * One undo snapshot is pushed here and none when the piece is put back down,
   * so however many drags a transform took, ctrl+z is a single step back to
   * before it started.
   */
  const lift = (sel: Selection) => {
    const pixels = pixelsRef.current;
    if (!pixels || floatRef.current) return;
    pushUndo();

    // Only the selected texels travel. Everything the mask leaves out is blanked
    // in the copy and left alone in the texture, so moving a wand selection
    // carries the shape rather than the box around it.
    const source = crop(pixels, sel.rect);
    for (let y = 0; y < sel.rect.h; y++) {
      for (let x = 0; x < sel.rect.w; x++) {
        if (covers(sel, sel.rect.x + x, sel.rect.y + y)) {
          setPixel(pixels, sel.rect.x + x, sel.rect.y + y, { r: 0, g: 0, b: 0, a: 0 });
        } else {
          setPixel(source, x, y, { r: 0, g: 0, b: 0, a: 0 });
        }
      }
    }

    floatRef.current = { source, rect: sel.rect };
    setDirty(true);
  };

  /** Write the lifted pixels into the texture at wherever they ended up. */
  const stampFloat = () => {
    const float = floatRef.current;
    const pixels = pixelsRef.current;
    if (!float || !pixels) return;
    drawScaled(pixels, float.source, float.rect);
    floatRef.current = null;
    setDirty(true);
    setStrokeTick((t) => t + 1);
    setHistoryTick((t) => t + 1);
  };

  /** Drop the lifted pixels unwritten - undo is about to restore the hole too. */
  const discardFloat = () => {
    floatRef.current = null;
  };

  const deselect = () => {
    stampFloat();
    commitAdjustment();
    setSelection(null);
    gestureRef.current = null;
    setHistoryTick((t) => t + 1);
  };

  // ---- Colour adjustment -------------------------------------------------

  /**
   * Re-derive the texture from the pixels held before the adjustment started.
   *
   * The first move takes that copy and pushes the single undo entry covering the
   * whole adjustment, however many times the sliders move afterwards.
   */
  const applyAdjustment = (next: Adjustment) => {
    const pixels = pixelsRef.current;
    if (!pixels) return;

    if (!adjustBaseRef.current) {
      // A piece being carried lands first, so it is recoloured along with the
      // rest instead of being dropped on top afterwards, unadjusted.
      stampFloat();
      pushUndo();
      adjustBaseRef.current = {
        source: {
          data: new Uint8ClampedArray(pixels.data),
          width: pixels.width,
          height: pixels.height,
        },
        area: selection,
      };
    }

    const base = adjustBaseRef.current;
    adjustInto(pixels, base.source, next, base.area ?? undefined);

    setAdjustment(next);
    setDirty(true);
    repaint();
  };

  /** Keep the adjustment and start a fresh one from where it left off. */
  const commitAdjustment = () => {
    if (!adjustBaseRef.current) return;
    adjustBaseRef.current = null;
    setAdjustment(NEUTRAL);
    setStrokeTick((t) => t + 1);
    setHistoryTick((t) => t + 1);
  };

  const resetAdjustment = () => {
    const base = adjustBaseRef.current;
    const pixels = pixelsRef.current;
    if (!base || !pixels) return;

    pixels.data.set(base.source.data);
    adjustBaseRef.current = null;
    setAdjustment(NEUTRAL);
    setDirty(true);
    setStrokeTick((t) => t + 1);
    setHistoryTick((t) => t + 1);
    repaint();
    playThud();
  };

  /** Drop the adjustment unrestored - undo is about to put the pixels back. */
  const discardAdjustment = () => {
    adjustBaseRef.current = null;
    setAdjustment(NEUTRAL);
  };

  /**
   * Pointer position in texture coordinates, continuous so edges can be hit.
   *
   * The canvas is measured including its border and drawn inside it, so the two
   * boxes have to be told apart here - see `texelFromClient`.
   */
  const toTexel = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    const pixels = pixelsRef.current;
    if (!canvas || !pixels) return null;

    const rect = canvas.getBoundingClientRect();
    const style = getComputedStyle(canvas);
    const box = {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      borderLeft: parseFloat(style.borderLeftWidth) || 0,
      borderTop: parseFloat(style.borderTopWidth) || 0,
      borderRight: parseFloat(style.borderRightWidth) || 0,
      borderBottom: parseFloat(style.borderBottomWidth) || 0,
    };

    return texelFromClient(clientX, clientY, box, pixels.width, pixels.height);
  };

  /** A handle is drawn in screen pixels, so its grab area is that many texels. */
  const grabTolerance = () => Math.max(0.35, HANDLE / zoom / 2);

  const hitAt = (clientX: number, clientY: number): HitTarget => {
    const point = toTexel(clientX, clientY);
    if (!point || !selection) return null;
    return hitHandle(selection.rect, point.x, point.y, grabTolerance());
  };

  const beginSelect = (clientX: number, clientY: number) => {
    const point = toTexel(clientX, clientY);
    const pixels = pixelsRef.current;
    if (!point || !pixels) return;

    const target = selection ? hitHandle(selection.rect, point.x, point.y, grabTolerance()) : null;

    // The adjustment covers whatever was selected when it began, so changing the
    // selection settles it rather than leaving it pointing at the old region.
    commitAdjustment();

    // Starting a box somewhere else puts any piece being carried back down first.
    if (target === null) {
      stampFloat();
      const x = Math.floor(point.x);
      const y = Math.floor(point.y);
      const started = clampRect({ x, y, w: 1, h: 1 }, pixels.width, pixels.height);
      gestureRef.current = {
        mode: 'new', handle: null, startRect: started, startX: point.x, startY: point.y,
      };
      setSelection({ rect: started, mask: null });
      return;
    }

    gestureRef.current = {
      mode: target === 'inside' ? 'move' : 'resize',
      handle: target === 'inside' ? null : target,
      startRect: selection!.rect,
      startX: point.x,
      startY: point.y,
    };
  };

  const dragSelect = (clientX: number, clientY: number) => {
    const gesture = gestureRef.current;
    const point = toTexel(clientX, clientY);
    const pixels = pixelsRef.current;
    if (!gesture || !point || !pixels) return;

    let next: Rect;

    if (gesture.mode === 'new') {
      next = rectFromDrag(
        gesture.startRect.x, gesture.startRect.y,
        Math.floor(point.x), Math.floor(point.y),
      );
    } else if (gesture.mode === 'move') {
      const dx = Math.round(point.x - gesture.startX);
      const dy = Math.round(point.y - gesture.startY);
      // Nothing is lifted until the piece actually moves, so a click inside the
      // box to reposition it does not punch a hole and cost an undo step.
      if (dx === 0 && dy === 0) return;
      lift(selection ?? { rect: gesture.startRect, mask: null });
      next = { ...gesture.startRect, x: gesture.startRect.x + dx, y: gesture.startRect.y + dy };
    } else {
      const resized = dragHandle(gesture.startRect, gesture.handle!, point.x, point.y);
      if (
        resized.x === gesture.startRect.x && resized.y === gesture.startRect.y
        && resized.w === gesture.startRect.w && resized.h === gesture.startRect.h
      ) return;
      lift(selection ?? { rect: gesture.startRect, mask: null });
      next = resized;
    }

    const clamped = clampRect(next, pixels.width, pixels.height);
    if (floatRef.current) floatRef.current.rect = clamped;
    // The mask is resampled exactly as the pixels are, so a shape stays matched
    // to its own artwork through a resize.
    setSelection((current) => ({
      rect: clamped,
      mask: current ? scaleMask(current.mask, gesture.startRect, clamped) : null,
    }));
  };

  const applyAt = (clientX: number, clientY: number, isStart: boolean) => {
    const pixels = pixelsRef.current;
    const point = toTexel(clientX, clientY);
    if (!pixels || !point) return;

    const x = Math.floor(point.x);
    const y = Math.floor(point.y);
    if (x < 0 || y < 0 || x >= pixels.width || y >= pixels.height) return;

    if (tool === 'eyedropper') {
      // Deliberately not clamped to the selection: sampling cannot damage the
      // texture, and a pick that silently did nothing would read as a bug.
      const picked = getPixel(pixels, x, y);
      setColor(picked);
      rememberColor(picked);
      playPop();
      setTool('pencil');
      return;
    }

    if (selection && !covers(selection, x, y)) return;

    // Painting settles the colour adjustment first, so "reset" always means the
    // sliders and never the brushwork done while they were open.
    commitAdjustment();

    // Dragging across one pixel repeatedly should not spam undo entries or sound.
    const id = `${x},${y}`;
    if (!isStart && id === lastPixelRef.current) return;
    lastPixelRef.current = id;

    if (isStart) pushUndo();

    if (tool === 'bucket') {
      floodFill(pixels, x, y, color, selection ?? undefined);
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
    // A snapshot can be from before a resize, and a box hanging off the edge of
    // the texture would let you paint at coordinates that no longer exist.
    setSelection((current) => {
      if (!current) return null;
      const rect = clampRect(current.rect, target.width, target.height);
      // A mask belongs to the box it was cut from; if that box had to move, the
      // shape no longer lines up with anything and the box is what survives.
      const same = rect.x === current.rect.x && rect.y === current.rect.y
        && rect.w === current.rect.w && rect.h === current.rect.h;
      return { rect, mask: same ? current.mask : null };
    });
    setDirty(true);
    setStrokeTick((t) => t + 1);
    setHistoryTick((t) => t + 1);
    syncHistory();
    playClick();
  };

  const undo = () => {
    // Undo during a transform throws the carried pixels away rather than
    // stamping them: the snapshot it restores is from before they were lifted,
    // so it puts back both the piece and the hole in one step. The same goes for
    // a colour adjustment: its snapshot predates the first slider move.
    discardFloat();
    discardAdjustment();
    const pixels = pixelsRef.current;
    const previous = undoRef.current.pop();
    if (!pixels || !previous) return;
    redoRef.current.push(snapshot(pixels));
    restore(previous);
  };

  const redo = () => {
    discardFloat();
    discardAdjustment();
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
      // The texture is about to be redrawn, possibly at another size; a piece
      // being carried has to land before that happens.
      stampFloat();
      commitAdjustment();
      setSelection(null);
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
    stampFloat();
    commitAdjustment();
    setSelection(null);
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
    // Whatever is being carried is part of the texture the moment it is saved.
    stampFloat();
    commitAdjustment();
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

  /**
   * Download the texture as it stands, unsaved work included.
   *
   * It is named the way the target version names it, so the file that comes out
   * can be dropped straight into a pack directory - or into another editor and
   * back in through **import image** - without having to work out what Minecraft
   * calls this texture on that version.
   */
  const exportPng = () => {
    stampFloat();
    commitAdjustment();
    const pixels = pixelsRef.current;
    if (!pixels) return;

    const scratch = document.createElement('canvas');
    scratch.width = pixels.width;
    scratch.height = pixels.height;
    scratch.getContext('2d')?.putImageData(pixels, 0, 0);

    const path = denormalize(slotKey, getVersion(targetVersion));
    const name = path?.split('/').pop()
      ?? `${slot?.displayName.replace(/\W+/g, '_').toLowerCase() ?? 'texture'}.png`;

    scratch.toBlob((blob) => {
      if (!blob) return;
      downloadBlob(blob, name);
      playPop();
    }, 'image/png');
  };

  const handleExit = () => {
    if (dirty && !window.confirm('Discard your changes to this texture?')) return;
    playThud();
    onClose();
  };

  /** Switching to a paint tool ends any transform, so the piece lands. */
  const chooseTool = (next: Tool) => {
    if (next !== 'select' && next !== 'wand') stampFloat();
    setTool(next);
    setHistoryTick((t) => t + 1);
  };

  /** Wipe what is selected: the carried piece if there is one, else the pixels. */
  const clearSelected = () => {
    const pixels = pixelsRef.current;
    if (!pixels || !selection) return;
    if (floatRef.current) {
      discardFloat();
    } else {
      pushUndo();
      for (let y = selection.rect.y; y < selection.rect.y + selection.rect.h; y++) {
        for (let x = selection.rect.x; x < selection.rect.x + selection.rect.w; x++) {
          if (covers(selection, x, y)) setPixel(pixels, x, y, { r: 0, g: 0, b: 0, a: 0 });
        }
      }
    }
    setDirty(true);
    setStrokeTick((t) => t + 1);
    setHistoryTick((t) => t + 1);
    playThud();
  };

  const selectAll = () => {
    if (!dims) return;
    stampFloat();
    commitAdjustment();
    setSelection({ rect: { x: 0, y: 0, w: dims.width, h: dims.height }, mask: null });
    playClick();
  };

  /** Select the pixels matching the one clicked - the wand. */
  const wandAt = (clientX: number, clientY: number) => {
    const point = toTexel(clientX, clientY);
    const pixels = pixelsRef.current;
    if (!point || !pixels) return;

    stampFloat();
    commitAdjustment();
    const picked = selectSimilar(
      pixels, Math.floor(point.x), Math.floor(point.y), tolerance, everywhere,
    );
    if (!picked) return;
    setSelection(picked);
    playPop();
  };

  // Keyboard shortcuts mirror the usual pixel-art editors.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Escape backs out one level at a time: the selection first, the editor
        // only once there is nothing selected to leave.
        if (selection) {
          deselect();
          playThud();
          return;
        }
        handleExit();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        selectAll();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        if (selection) {
          deselect();
          playThud();
        }
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!selection) return;
        e.preventDefault();
        clearSelected();
        return;
      }
      if (e.ctrlKey || e.metaKey) return;

      const map: Record<string, Tool> = {
        m: 'select', w: 'wand', b: 'pencil', e: 'eraser', g: 'bucket', i: 'eyedropper',
      };
      const next = map[e.key.toLowerCase()];
      if (next) chooseTool(next);
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
                ['select', 'select', 'Select - drag a box, move it, drag its handles to resize. Painting only lands inside it (M)'],
                ['wand', 'wand', 'Wand - click a pixel to select everything that colour, so you can recolour just that part (W)'],
                ['pencil', 'draw', 'Pencil - paint single pixels (B)'],
                ['eraser', 'erase', 'Eraser - clear pixels to transparent (E)'],
                ['bucket', 'fill', 'Fill - flood the matching area (G)'],
                ['eyedropper', 'pick', 'Eyedropper - sample a colour (I)'],
              ] as Array<[Tool, string, string]>).map(([id, label, hint]) => (
                <MCButton
                  key={id}
                  small
                  onClick={() => chooseTool(id)}
                  title={hint}
                  style={tool === id ? { background: '#3a7d3a', color: '#fff' } : undefined}
                >
                  {label}
                </MCButton>
              ))}
            </div>

            {/* Selection: the box is a stencil for the paint tools and a handle
                on the pixels themselves for the select tool. */}
            <div className="section-title">Selection</div>
            <div style={{ padding: '0 10px' }}>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <MCButton small onClick={selectAll} disabled={!dims} title="Select the whole texture (ctrl+A)">
                  all
                </MCButton>
                <MCButton
                  small
                  onClick={() => {
                    deselect();
                    playThud();
                  }}
                  disabled={!selection}
                  title="Drop the selection and paint anywhere again (ctrl+D)"
                >
                  none
                </MCButton>
                <MCButton
                  small
                  variant="danger"
                  onClick={clearSelected}
                  disabled={!selection}
                  title="Clear the selected pixels to transparent (delete)"
                >
                  clear
                </MCButton>
              </div>
              <label className="mc-text-shadow" style={{ fontSize: 16, display: 'block', marginTop: 8 }}>
                wand tolerance {Math.round(tolerance * 100)}%
                <input
                  type="range"
                  className="mc-range"
                  min={0}
                  max={100}
                  step={1}
                  value={Math.round(tolerance * 100)}
                  onChange={(e) => setTolerance(Number(e.target.value) / 100)}
                  title="How far a colour may differ and still be picked up. 0 takes only an exact match."
                />
              </label>
              <div style={{ marginTop: 4 }}>
                <MCCheckbox
                  checked={everywhere}
                  onChange={() => setEverywhere((v) => !v)}
                  label="same colour everywhere"
                  title={everywhere
                    ? 'The wand takes every matching pixel in the texture'
                    : 'The wand takes only the patch you clicked, stopping where the colour changes'}
                />
              </div>
              <div
                className="t-gray"
                style={{ fontSize: 16, marginTop: 6, lineHeight: 'var(--lh-body)' }}
              >
                {selection
                  ? selection.mask
                    ? `${countCovered(selection)} pixels · painting stays inside`
                    : `${selection.rect.w}×${selection.rect.h} at ${selection.rect.x},${selection.rect.y} · painting stays inside`
                  : 'nothing selected · painting goes anywhere'}
              </div>
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
              <div className="row" style={{ gap: 6 }}>
                <MCButton
                  small
                  onClick={() => importRef.current?.click()}
                  title="Draw a PNG or JPG onto this texture"
                  style={{ flex: 1 }}
                >
                  import
                </MCButton>
                <MCButton
                  small
                  onClick={exportPng}
                  disabled={!dims}
                  title={`Download this texture as a PNG, named the way ${getVersion(targetVersion).label.trim()} names it. Unsaved changes are included.`}
                  style={{ flex: 1 }}
                >
                  export
                </MCButton>
              </div>
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

            {/* Recolouring beats repainting: most people want the same artwork
                in another shade, not a different texture. */}
            <div className="section-title">Adjust</div>
            <div style={{ padding: '0 10px' }}>
              {([
                ['hue', -180, 180, 1, adjustment.hue,
                  `${adjustment.hue > 0 ? '+' : ''}${Math.round(adjustment.hue)}°`],
                ['saturation', 0, 200, 5, adjustment.saturation * 100,
                  `${Math.round(adjustment.saturation * 100)}%`],
                ['exposure', -200, 200, 5, adjustment.exposure * 100,
                  `${adjustment.exposure > 0 ? '+' : ''}${adjustment.exposure.toFixed(2)} EV`],
              ] as Array<[keyof Adjustment, number, number, number, number, string]>)
                .map(([name, min, max, step, value, label]) => (
                  <label
                    key={name}
                    className="mc-text-shadow"
                    style={{ fontSize: 16, display: 'block', marginTop: 6 }}
                  >
                    {name} {label}
                    <input
                      type="range"
                      className="mc-range"
                      min={min}
                      max={max}
                      step={step}
                      value={value}
                      disabled={!dims}
                      onChange={(e) => {
                        const raw = Number(e.target.value);
                        applyAdjustment({
                          ...adjustment,
                          [name]: name === 'hue' ? raw : raw / 100,
                        });
                      }}
                    />
                  </label>
                ))}

              <div className="row" style={{ gap: 6, marginTop: 6 }}>
                <MCButton
                  small
                  onClick={commitAdjustment}
                  disabled={isNeutral(adjustment)}
                  title="Keep this colour change and start a fresh one from here"
                >
                  apply
                </MCButton>
                <MCButton
                  small
                  variant="danger"
                  onClick={resetAdjustment}
                  disabled={isNeutral(adjustment)}
                  title="Put the original colours back"
                >
                  reset
                </MCButton>
              </div>
              <div
                className="t-gray"
                style={{ fontSize: 16, marginTop: 6, lineHeight: 'var(--lh-body)' }}
              >
                {selection ? 'changes the selected area only' : 'changes the whole texture'}
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
                style={{
                  cursor: tool === 'select' || tool === 'wand' || tool === 'eyedropper'
                    ? 'crosshair'
                    : 'cell',
                }}
                onPointerDown={(e) => {
                  paintingRef.current = true;
                  lastPixelRef.current = '';
                  e.currentTarget.setPointerCapture(e.pointerId);
                  if (tool === 'select') beginSelect(e.clientX, e.clientY);
                  else if (tool === 'wand') wandAt(e.clientX, e.clientY);
                  else applyAt(e.clientX, e.clientY, true);
                }}
                onPointerMove={(e) => {
                  if (tool === 'wand') return;
                  if (tool === 'select') {
                    if (paintingRef.current) {
                      dragSelect(e.clientX, e.clientY);
                    } else {
                      // The cursor is the only hint that an edge can be grabbed.
                      const target = hitAt(e.clientX, e.clientY);
                      e.currentTarget.style.cursor =
                        (target && CURSOR_FOR[target]) ?? 'crosshair';
                    }
                    return;
                  }
                  if (paintingRef.current) applyAt(e.clientX, e.clientY, false);
                }}
                onPointerUp={(e) => {
                  paintingRef.current = false;
                  gestureRef.current = null;
                  e.currentTarget.releasePointerCapture(e.pointerId);
                  setStrokeTick((t) => t + 1);
                }}
                onPointerCancel={() => {
                  paintingRef.current = false;
                  gestureRef.current = null;
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
