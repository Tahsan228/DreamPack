# Texture editor: rectangular selection with transform

**Date:** 2026-08-17
**Status:** approved

## Problem

The texture editor paints anywhere on the texture. There is no way to work on one
part of it without a steady hand, and no way to move or rescale a piece of the
artwork — the only resampling on offer is `resizeTo`, which redraws the whole
texture.

## What is being built

A rectangular selection in the editor that:

1. clamps painting to the selected area, and
2. moves and rescales the pixels inside it.

### Interaction

A fifth tool, `select`, shortcut `M`, sitting alongside draw/erase/fill/pick.

| Gesture | Result |
| --- | --- |
| Drag on empty canvas | Rubber-band a new box, snapped to whole texels, minimum 1×1, clamped to the texture |
| Drag inside the box | Carries the pixels with it, leaving transparency behind |
| Drag one of 8 handles | Resamples the pixels to fit the new box, nearest-neighbour |

Dragging a handle past the opposite edge normalises the box. The content is not
mirrored.

**Floating.** The first move or resize *lifts* the selection: a pristine copy of
the pixels is taken, the source area is cleared, and every subsequent drag redraws
from that copy rather than from the last result. Scaling 16 → 4 → 16 therefore
returns the original artwork.

The float is stamped down on deselect (`Esc` / `Ctrl+D`), switching to a paint
tool, Save, or resizing/importing the whole texture. `Ctrl+Z` while floating
discards it instead of stamping it.

**Painting.** With a selection active, pencil, eraser and fill only affect pixels
inside it, and fill stops at the box edge. The eyedropper samples anywhere:
sampling cannot damage the texture, and having it fail silently outside the box
would read as a bug.

**Keys.** `M` select tool · `Ctrl+A` select all · `Ctrl+D` deselect ·
`Delete` / `Backspace` clear the selected pixels · `Esc` deselects when a
selection exists, otherwise closes the editor as it does today.

**Drawing.** A black-and-white dashed outline with eight handles sized in *screen*
pixels, so they stay grabbable at 1× zoom. While the select tool is active the
area outside the box dims slightly; the dimming lifts under a paint tool so
colours read true while painting.

## Architecture

`TextureEditor.tsx` is already ~740 lines. The parts of this feature worth testing
are geometry and pixel arithmetic, so they go in two pure, DOM-free modules and
the component keeps only the gesture glue.

### `src/lib/selection.ts`

Rectangle geometry in texture-pixel coordinates.

- `Rect { x, y, w, h }`
- `rectFromDrag(ax, ay, bx, by)` — two points to a normalised rect, min 1×1
- `clampRect(rect, width, height)`
- `hitHandle(rect, x, y, tolerance)` → `'nw'|'n'|'ne'|'e'|'se'|'s'|'sw'|'w'|'inside'|null`
- `dragHandle(rect, handle, x, y)` — apply a handle drag, normalising if it crosses
- `containsPoint(rect, x, y)`

### `src/lib/pixelBuffer.ts`

Pixel work on `PixelBuffer { data: Uint8ClampedArray; width: number; height: number }`,
a structural type `ImageData` already satisfies.

- `crop(buffer, rect)` → `PixelBuffer`
- `drawScaled(dest, src, rect)` — nearest-neighbour, skipping out-of-bounds writes
- `clearRect(buffer, rect)`
- `floodFill(buffer, x, y, colour, bounds?)` — moved out of the component so the
  fill clamp is the same code path as every other bound

### Editor state

- `selection: Rect | null` — state, drives the marquee and the paint clamp
- `floatRef: { source: PixelBuffer; rect: Rect } | null` — ref, the lifted pixels
- `dragRef` — the in-progress gesture: mode, handle, the rect at pointer-down

`repaint` composites base → float (drawn at its current rect) → marquee. The float
is never written into the base until it is stamped down.

### Undo

One snapshot is pushed at lift time, so the entire transform — however many drags
it took — is a single `Ctrl+Z`. Stamping down pushes nothing further, because the
pre-lift snapshot already covers it. Undo during a float discards the float and
restores the snapshot, which removes the hole in one step.

## Testing

`HTMLCanvasElement.prototype.getContext` returns null under this repo's jsdom
setup, so the editor's drawing cannot be asserted in unit tests. The pure modules
carry the coverage:

- `rectFromDrag` normalising either drag direction, minimum size, clamping
- `hitHandle` on corners, edges, inside, outside, and at a tolerance
- `dragHandle` including a drag past the opposite edge
- `crop` → `drawScaled` shrink → grow from the pristine crop returns the original
- `drawScaled` clipping at the texture edge
- `clearRect` leaving everything outside untouched
- `floodFill` respecting bounds, and unchanged behaviour without them

Then a real-browser pass with Playwright: open the editor, drag a box, move it,
resize it, paint outside (nothing happens), paint inside (works), screenshot each.

## Out of scope

Lasso and magic-wand selection, copy/paste, rotation, feathering, arrow-key nudge.
