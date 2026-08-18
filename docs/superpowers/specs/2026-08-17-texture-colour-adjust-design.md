# Texture editor: hue, saturation and exposure

**Date:** 2026-08-17
**Status:** approved

## Problem

Recolouring a texture means repainting it. Someone who wants a bluer sword or a
darker wool has to redo the artwork pixel by pixel, when all they want is to move
the colour a little.

## What is being built

An **Adjust** section in the texture editor with three sliders, applied live to
the texture being edited.

| Control | Range | Neutral |
| --- | --- | --- |
| hue | -180° … +180° | 0 |
| saturation | 0% … 200% | 100% |
| exposure | -2 EV … +2 EV | 0 |

Plus **apply** and **reset**.

### Behaviour

**Non-destructive while adjusting.** The first slider move starts an adjustment:
one pristine copy of the target pixels is taken and one undo entry is pushed.
Every later move re-derives from that copy rather than from the last result, so
returning the sliders to neutral returns the original artwork exactly. Re-applying
an 8-bit colour transform to its own output loses information on every pass.

**apply** commits — the pixels are already in the working buffer, so it clears the
pristine copy and returns the sliders to neutral, ready for another pass.
**reset** restores the pristine copy and returns the sliders to neutral.

**Automatic commit.** Saving, resizing, importing an image, or closing the editor
commits whatever is in progress, matching how a floating selection behaves.
`Ctrl+Z` during an adjustment discards it and restores the pre-adjustment pixels
in one step.

**Scoped by the selection.** With a selection active, only the pixels inside it
change, so one part of a texture can be recoloured. Without one, the whole texture
changes. A floating selection is stamped down first, as it is when switching to a
paint tool.

**Alpha is never modified**, and fully transparent pixels are skipped entirely: a
hue rotation applied to invisible pixels shows up as coloured fringing as soon as
the texture is scaled.

## Architecture

### `src/lib/adjust.ts` (new, pure, no DOM)

Follows `selection.ts` and `pixelBuffer.ts`: operates on `PixelBuffer`, testable
under the node environment.

- `interface Adjustment { hue: number; saturation: number; exposure: number }`
- `NEUTRAL: Adjustment` — `{ hue: 0, saturation: 1, exposure: 0 }`
- `isNeutral(a: Adjustment): boolean`
- `rgbToHsl(r, g, b): [h, s, l]` and `hslToRgb(h, s, l): [r, g, b]`
- `adjustInto(dest: PixelBuffer, src: PixelBuffer, a: Adjustment, rect?: Rect): void`
  — writes the adjusted `src` into `dest`, optionally only inside `rect`.

Per pixel: skip when `a === 0`; RGB→HSL; add hue and wrap; multiply saturation and
clamp to 0…1; HSL→RGB; multiply each channel by `2 ** exposure`; clamp to 0…255.
Alpha is copied through untouched.

Hue and saturation go through HSL because that is what "shift the colour" means to
a person. Exposure multiplies rather than adds so that shading scales
proportionally — adding a constant lifts dark and light pixels equally and
flattens the shading pixel art depends on.

### `TextureEditor.tsx`

- `adjustment: Adjustment` in state, driving three `input[type=range]` controls.
- `adjustBaseRef: { source: PixelBuffer; rect: Rect | null } | null` — the pristine
  copy and the region it came from, taken on the first move.
- `applyAdjustment(next)` — ensures the base exists (taking it, stamping any float,
  and pushing one undo entry), then writes `adjustInto` into the working buffer and
  repaints.
- `commitAdjustment()` / `resetAdjustment()` — clear or restore, and return the
  sliders to neutral.

## Testing

`tests/adjust.test.ts`:

- hue +360 is identity, and +180 twice returns the original
- saturation 0 produces grey with the luma preserved
- saturation 2 does not push a channel past 255
- +1 EV doubles a mid grey; -1 EV halves it; both clamp
- alpha is copied unchanged, and a fully transparent pixel is left alone
- `rgb → hsl → rgb` round-trips within one unit for a spread of colours
- `adjustInto` with a rect leaves everything outside it untouched
- `isNeutral` is true only at the neutral values

Browser pass: open the editor, drag each slider and confirm the canvas changes,
reset and confirm the pixels return to their original values, then make a
selection and confirm only the boxed area moves.

## Out of scope

Contrast, gamma, curves, per-channel levels, palette swapping, and bulk recolour
across many textures at once.
