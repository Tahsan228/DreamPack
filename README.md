# DreamPack

Mix multiple Minecraft resource packs into one, asset by asset. Built for bedwars
packs, where you usually want *this* pack's swords, *that* pack's wool, and someone
else's hearts.

Everything runs in your browser. Nothing is uploaded anywhere.

```bash
npm install
npm run dev      # http://localhost:5173
```

## How it works

1. **Import packs** — drop `.zip` resource packs onto the left rail (or anywhere
   in the window). They're stored in your browser and survive a reload.
2. **Set priority** — drag the packs into order. The one on top wins by default,
   and the ones below fill in anything it doesn't have.
3. **Pick per asset** — click any slot in the grid. The viewport shows that asset
   from *every* pack side by side; click one to choose it. Picked slots get a corner marker.
4. **Export** — produces a `.zip` you drop into `.minecraft/resourcepacks`.

Your work is saved as you go. Packs, priority order, picks, target version and
filters all come back exactly as you left them on the next visit — **Save** and
**Export .dreampack** are for keeping *named* versions and sharing them, not for
avoiding data loss.

The **"only differing"** filter is on by default and is the one that makes this
usable: most of a pack is identical to every other pack, so it hides everything
the packs agree on and leaves you with the couple hundred assets actually worth
choosing between.

## Working quickly

Picking a pack apart one slot at a time is a lot of clicking, so three things
cut it down.

**Bulk picks.** Under the filters is a button per pack: *use for all N*. It
applies to exactly what the grid is showing, so the category, search box and
filters are how you aim it — search `wool`, hit a pack, and every wool in that
tab comes from it. Slots that pack has no texture for are left alone rather than
pointed at a file that does not exist, and the line underneath tells you how
many actually moved.

**The keyboard.** Arrow keys walk the grid, `1`-`9` pick the numbered pack from
the candidate strip, `0` resets a slot to the priority order, `Enter` opens the
texture editor, `/` jumps to the search box and `Esc` deselects.

**Undo.** `Ctrl+Z` and `Ctrl+Shift+Z` step through picks and priority changes,
including bulk ones — a bulk apply is a single step, not four hundred. Importing
or removing a pack clears the history, because the files behind it are gone from
the browser and no earlier state could be restored honestly.

The pack rail shows what each pack **supplies**: how many of the assets in the
exported zip actually come from it, counted with the exporter's own resolver.
It is the quick answer to whether the priority order did what you meant.

## Versions

Pick a target version in the top bar. This sets `pack_format` in the exported
`pack.mcmeta` *and* the filenames used inside it.

Minecraft 1.13 (the "Flattening") renamed most textures — `wool_colored_red.png`
became `red_wool.png`, `sword_diamond.png` became `diamond_sword.png`,
`textures/items/` became `textures/item/`. DreamPack normalises both spellings to
one identity, so a 1.8.9 pack and a 1.20 pack can compete for the same slot, and
whatever you pick gets written under the name your target version expects.

Assets with no known cross-era name are marked `!` and pass through under their
original filename — which is always correct when the source and target are the
same era.

Packs that cover several versions often ship an asset twice, once under each
spelling. Both are the same asset, so such a pack offers **one** candidate for
that slot — the spelling its own version reads — and the copy it does not use is
named in that candidate's tooltip. The fold does not depend on which era the pack
was detected as: era is a guess from the majority of a pack's paths, and letting
it decide identity meant a stray `wool_colored_red.png` in a 1.20 pack became a
slot of its own that then exported over the top of the real red wool.

Supported targets: **1.8.9** (default), 1.12.2, 1.16.5, 1.20.1, 1.21.4. The rename
table is deepest for 1.8.9 ↔ modern; `src/core/versions.ts` is the single place to
add a version or correct a `pack_format`.

## Editing textures

Select any texture and hit **Edit Texture**. You get a pixel editor with a
select tool, pencil, eraser, fill bucket and eyedropper
(`M` / `B` / `E` / `G` / `I`), a colour picker with an alpha slider, three
palettes — a general pixel-art set, your recent colours, and the colours already
in the texture you're editing — plus undo/redo (`Ctrl+Z` / `Ctrl+Shift+Z`), zoom,
and a pixel grid.

**select** (`M`) drags out a box. Painting, erasing and filling then only land
inside it, and the fill stops at its edge — the eyedropper is the exception,
since sampling can't damage anything. Drag inside the box to carry those pixels
somewhere else, or drag one of its eight handles to rescale them,
nearest-neighbour. `Ctrl+A` selects everything, `Ctrl+D` or `Esc` drops the
selection, `Delete` clears what's inside it.

A piece stays *floating* while you place it: the copy taken when you first moved
it is what every later drag resamples from, so squashing it down to a texel and
pulling it back out returns the artwork rather than a blur. It lands when you
deselect, switch to a paint tool, or save, and the whole transform — however many
drags it took — is a single `Ctrl+Z`.

**wand** (`W`) selects by colour instead of by dragging: click a pixel and every
similar pixel joins the selection. **tolerance** sets how similar counts, and
**same colour everywhere** switches between the connected patch you clicked and
every matching pixel in the texture — the latter is how you recolour all the blue
on a sword at once. The selection is then a shape rather than a box, and painting,
erasing, filling and adjusting all follow it.

**Adjust** recolours instead of repainting: hue (±180°), saturation (0–200%) and
exposure (±2 EV), applied live. Most of the time someone wants the same artwork in
another shade, not a different texture.

Like a floating selection, an adjustment is non-destructive while you work: the
first slider move keeps a copy of the pixels and every later move re-derives from
it, so returning the sliders to neutral returns the exact original — running an
8-bit colour transform over its own output loses a little more each pass. **apply**
keeps the change and starts a fresh one, **reset** puts the original colours back,
and the whole adjustment is a single `Ctrl+Z`. With a selection active only the
boxed area changes, so you can recolour just the blade of a sword. Fully
transparent pixels are skipped — a hue shift on invisible pixels turns into
coloured fringing the moment the texture is scaled.

**Size** resamples the texture to 16, 32, 64, 128 or 256 wide. A texture is not
stuck at whatever resolution its source pack shipped — this is how you take a 16x
pack up to 32x and start adding detail. Resampling is nearest-neighbour, so
upscaling gives you clean blocks of solid colour to paint into rather than a
blurred mess, and the aspect ratio is held: an animated texture is a filmstrip of
N square frames, and changing its proportions would silently change how many
frames the game thinks it has.

**export** downloads the texture as a PNG, unsaved work included. It is named the
way your target version names it — `wool_colored_red.png` for 1.8.9,
`red_wool.png` for 1.20.1 — so the file can go straight into a pack directory, or
into another editor and back through **import**.

**import** draws a PNG or JPG onto the texture. By default it is scaled to
the texture's existing dimensions, keeping its proportions and letterboxing the
remainder, because a resource pack expects a given size - and for animated
textures, a given filmstrip shape. Tick **keep source size** to adopt the
imported image's dimensions instead, which is how you move a 16x texture up to
32x or higher. Either way it is drawn with nearest-neighbour sampling, so pixel
art stays pixel art, and it lands on the undo stack like any other edit.

If the texture is animated, its `.png.mcmeta` is copied into the edit alongside
the filmstrip — without it the export would ship a strip the game cannot play,
and would squash every frame onto one face.

**Save & Exit** writes the result into a synthetic pack called **My Edits** and
pins that slot to it. That's the whole mechanism: an edit is just another
candidate, so it shows up in the pack rail, competes in the grid, and exports
through the same path as everything else. Edits are stored under modern canonical
names, so they get renamed correctly for whatever version you target.

Deleting the **My Edits** pack from the rail discards every edit.

## The 3D preview

Select a block or item texture and hit **3D**. Drag to rotate, double-click to
stop the spin.

**Items are extruded, not hung flat.** Minecraft gives a held item real
thickness, so a water bucket seen from the side is a slab of metal rather than a
sheet of paper. The preview does the same: the sprite's alpha channel is cut into
a solid one sixteenth of a block thick, with a wall wherever the art meets
transparency — including around holes in the middle of a sprite. Front and back
faces are emitted per horizontal run of opaque pixels rather than per pixel, and
walls only exist on the perimeter, so the cost tracks the shape rather than the
resolution and a 256x texture is no more expensive than a 16x one.

**Blocks get the right solid.** Wrapping every block texture around a full cube
is wrong for a good number of them — a bed is nine sixteenths tall, a sapling is
two crossed sheets, a door is a thin panel. `src/core/blockShapes.ts` works this
out from the canonical name, so it behaves the same for a 1.8.9 pack's
`bed_feet_side` and a modern pack's `red_bed`, and covers beds, slabs, trapdoors
and carpets, plants, torches, doors, ladders and panes.

It is chosen automatically and there is nothing to configure — a preview that
needs setting up is not a preview. Adding a shape is one entry in `SHAPES` and
one pattern in `BLOCK_RULES`.

## Sound

The button click is the Minecraft sample supplied with this project
(`src/assets/sounds/click.mp3`), decoded once and replayed from an audio buffer so
rapid clicks overlap instead of cutting each other off. Every other sound — the
pick blip, the cancel thud, the export chime, the painting tick — is synthesised
at runtime from oscillators and filtered noise, with no files involved. If the
sample ever fails to load, the click falls back to a synthesised one.

Recorded samples usually carry silence at the front - the one supplied here has
**538 ms** of it, with only ~108 ms of actual click after that, which is heard as
lag between pressing a button and the sound arriving. Rather than re-encoding the
file, `sfx.ts` measures the lead-in once at decode time and starts playback past
it, so the click lands with the press. Drop in a different sample and it is
measured again automatically.

There is a second source of lag that has nothing to do with the file. Leave the
page alone for a while and the browser lets the idle `AudioContext` suspend while
the operating system powers the output device down; the next click then waits for
both to come back, so the *first* press after a pause arrives late and every one
after it is fine. `sfx.ts` holds the path open with a looping source at **-80 dB**
— inaudible, but deliberately not digital silence, because a stream of zeroes is
exactly what a driver is entitled to treat as nothing happening. It is stopped
while sound is muted, and `pointerdown` resumes the context a moment before the
`click` that needs it.

Toggle sound with the note button in the header; the setting persists.

## Type, and why everything is a multiple of 8

The UI is set in **Minecraftia** by Andrew Tyler, bundled at `src/assets/fonts/`.
Run `node scripts/font-metrics.mjs` to re-derive everything below from the file.

**Size.** The glyph coordinates share a greatest common divisor of **192 font
units** against an em of 1536 - so one design pixel is 192 units and the em is
**8 design pixels**. Only font sizes that are multiples of 8 put a design pixel
on a whole number of screen pixels. At any other size, with anti-aliasing off as
the designer specifies, the rasteriser snaps stems unevenly - some 1px wide, some
2px - which is what makes pixel type look wobbly. So the interface uses **16px**
everywhere (2x design scale, the same chunkiness as Minecraft's GUI Scale 2) and
**24px** for panel titles.

**Vertical metrics.** The font's own metrics are unusable: `hhea` stores a
*positive* descender, `OS/2` winDescent is a negative number written into an
unsigned field, and the ascent (1.75em) is taller than the ink. Browsers
therefore reserve descent space the font never uses and leave every glyph riding
high - text drifts to the top of its button with a dead gap underneath.

Measured, the ink is far tidier than the tables claim: every glyph sits between
**0.5em and 1.5em above the baseline**, exactly 1em tall, with nothing below the
baseline at all. `fonts.css` overrides the metrics to match, pinning the descent
at 0 (the property cannot be negative) and setting the ascent to twice the ink
centre:

```css
ascent-override: 200%;   /* ink centre is 1.0em, so 2x that is symmetric */
descent-override: 0%;
line-gap-override: 0%;
```

The content box becomes a flat 2em, leaving 0.5em clear above and below the ink,
so **any even line-height centres the type perfectly** with whole-pixel
half-leading. That one declaration is what makes text sit right everywhere -
there is not a single per-component nudge in the codebase.

Everything else follows: `--px` (bevel width, text-shadow offset) is 2px, one
design pixel; inventory slots are 40px holding a 32px texture, Minecraft's 18/16
proportion doubled, so 16x art scales 2:1 with no fractions.

**Text shadows** follow the game's rule rather than a fixed grey. Minecraft
derives a shadow as `(colour & 0xFCFCFC) >> 2` - a quarter of the foreground - so
coloured text gets a *tinted* shadow. Each colour token in `tokens.css` ships
with its exact `>>2` partner, applied through the `.t-*` helpers.

**Surfaces** are textured, not flat: `lib/textures.ts` generates a noise tile at
startup and publishes it as `--mc-grain`. Buttons layer it over a vertical
gradient with a black outline and inset bevels, the way `widgets.png` is drawn.
The list panels are translucent black over the dirt, like Minecraft's world
select screen, so the background supplies their texture.

Minecraftia covers 722 codepoints and lacks most symbols and typographic
punctuation, so anything that would fall back to another face is gone: the
checkbox tick and picked-slot marker are drawn in CSS, priority arrows use
`up`/`down` arrows (the triangles are only half-covered), close buttons use the
multiplication sign, em dashes are hyphens, and the editor's tools are word
labels. `npm run audit:glyphs` fails the build if any rendered character is
missing from the font.

## Loading screen

On first load the app shows a Minecraft-style boot screen - dirt background,
wordmark, progress bar - wired to real milestones: waiting on the font, building
the surface textures, then reading saved packs out of IndexedDB. Each step holds
briefly so the phases are readable, and the bar reflects actual work, so a large
library genuinely takes longer than an empty one.

## Credits, socials and donations

`src/config/links.ts` is the single place to set the author name, social links
and donation options.

Discord is live and points at the invite. The donation options are still empty -
fill in a URL and that button goes live. Until then they render disabled with a
tooltip pointing back at the file, rather than vanishing, so it stays obvious
where to configure them.

An entry's `id` also selects its icon from `components/mc/icons.tsx`; an id with
no icon there just renders as a text label, so adding a service is a two-line
change. The icons are vector rather than pixel art on purpose - at 18px a
hand-pixelled brand mark would be unreadable - and they inherit `currentColor`,
so they follow the button's hover and disabled states.

Socials sit in the screen's top-left corner and **Donate** in the top-right,
either side of the wordmark. Donate opens a full-screen menu styled like
Minecraft's own, with the options stacked down the middle and a Back button.

## Your own logo

`public/logo.png` is the header wordmark. Replace that file to change it — no code
change needed. If it is ever missing, the header falls back to a CSS-extruded
pixel wordmark.

## What travels with a pick

Picking an asset also brings whatever it needs to work:

- `.png.mcmeta` animation config
- Optifine CIT `.properties` rules, plus every texture and model they reference
- `sounds.json` is merged rather than picked — event definitions come from the
  priority order, audio bytes from your picks, and any entry pointing at a file
  that isn't in the export is dropped so the result can't reference a missing file

## Projects

The current session is always saved on its own. **Save** additionally stores a
*named* snapshot you can come back to. **Export .dreampack** writes one to a file
you can share or reload — it stores picks only, so whoever opens it needs the
same source packs imported.

Both record **pack names alongside ids**. A pack is given a fresh random id every
time it is imported, so an id only holds as long as that exact import does — clear
the browser, re-import a pack, move to another machine or open someone else's
project and every id in it is stale. The name is the durable handle, so it is the
fallback, and it is why importing a zip whose name is already taken stops to ask
whether you meant to replace it, keep both, or skip.

When a load cannot find a pack it says so and stays open, naming what is missing
and how many picks it could not place, rather than applying nothing and closing
as though it had worked. Projects saved before names were recorded still load by
id, and say that re-saving them will fix the matching.

## Development

```bash
npm test              # 146 tests, mostly on the rename/resolve logic
npm run build         # typecheck + production build to dist/
npm run audit:glyphs  # fail if any rendered character is missing from the font
```

### Checking the UI in a real browser

UI work is verified against a browser rather than by reading CSS:

```bash
npm run dev                # in one terminal
npm run testpacks          # build two synthetic 1.8.9 packs into .shots/
npm run tour               # drive the app and screenshot every state
```

`tour.mjs` imports both packs, opens a slot, overrides its source, switches to
3D, opens the editor, and exports the result — writing `.shots/tour-*.png` at
each step and reporting any console errors. The two test packs share filenames
but use different palettes, so the grid, the "only differing" filter and the
candidate strip all have something real to show. It is deterministic, so the
exported zip can be diffed against the sources to prove that a manual pick beat
the priority order and everything else followed it.

It then checks behaviour rather than just taking pictures, and exits non-zero if
any of it breaks: that a number key picks, that a bulk apply moves many slots and
one `Ctrl+Z` puts them all back, that **picks and priority order survive a page
reload**, that re-importing a pack of the same name is caught, and that an edited
*animated* texture still carries its `.png.mcmeta` into the exported zip. Console
errors from the third-party ad script are reported but do not fail the run.

`npm run shot -- name --dpr=1.25` grabs a single screenshot at a chosen device
pixel ratio, which is how to reproduce a display with Windows scaling on.

`npm run shot:3d` photographs the 3D preview on its own — two extruded items, a
cube, a bed, a plant, a torch and an animated block, each showing the shape the
detector picked with no input. Geometry is the one thing that cannot be checked
by reading the code, and the spin is stopped at a fixed angle first so the shots
are comparable between runs.

`dist/` is a static site — host it anywhere, no server needed.

Layout:

| Path | What's in it |
|---|---|
| `src/core/canonical.ts` | path ↔ version-independent key. The piece everything depends on. |
| `src/data/flattening.ts` | the 1.13 rename table, tested as a bijection |
| `src/core/resolve.ts` | slot union across packs; picks + priority → one winner |
| `src/core/editsPack.ts` | the synthetic "My Edits" pack the editor writes into |
| `src/state/session.ts` | the autosaved session, and fitting it back to the packs that exist |
| `src/core/blockShapes.ts` | which solid a texture belongs on in the 3D preview |
| `src/lib/spriteGeometry.ts` | extruding an item sprite into a mesh from its alpha channel |
| `src/workers/` | zip import and export, off the main thread |
| `src/components/mc/` | Minecraft GUI primitives |
| `src/lib/sfx.ts` | click sample plus synthesised UI sounds |
| `src/components/LoadingScreen.tsx` | boot screen, driven by real startup milestones |

## No Minecraft assets included

The interface itself borrows no Mojang artwork: the dirt background and surface
grain are generated procedurally at runtime, the GUI is CSS, and every sound
except the click is synthesised from oscillators. No Minecraft textures are
bundled - everything you see in the grid comes from packs you imported yourself.
If you want vanilla textures to compare against, import them as just another pack.

Three assets are supplied rather than generated, and are **not** Mojang-licensed
to redistribute:

| Asset | Origin |
|---|---|
| `src/assets/fonts/Minecraftia-Regular.ttf` | Andrew Tyler - see `MINECRAFTIA-LICENSE.txt` |
| `src/assets/sounds/click.mp3` | A Minecraft UI sound, added to this project by its owner |
| `public/logo.png` | Your own wordmark |

The click sample is Mojang's audio. That is fine for a personal or fan project
under Mojang's usual latitude, but it should be swapped for a synthesised or
original sound before distributing this anywhere publicly - `lib/sfx.ts` already
contains a synthesised click that is used automatically if the file is absent.
