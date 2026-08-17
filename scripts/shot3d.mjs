/**
 * Screenshot the 3D preview for a few assets and shapes, so the geometry can be
 * looked at rather than reasoned about.
 *
 *   node scripts/make-test-packs.mjs && node scripts/shot3d.mjs
 *
 * Writes .shots/3d-*.png.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const url = 'http://localhost:5173/';
mkdirSync('.shots', { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage();

const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(url, { waitUntil: 'networkidle' });
await page.evaluate(() => new Promise((r) => {
  const q = indexedDB.deleteDatabase('dreampack');
  q.onsuccess = q.onerror = q.onblocked = () => r();
}));
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

for (const name of ['TestPackA', 'TestPackB']) {
  await page.setInputFiles('input[type=file][accept=".zip"]', resolve(`.shots/${name}.zip`));
  await page.waitForSelector(`text=${name}`, { timeout: 20000 });
  await page.waitForTimeout(900);
}

// Several test-pack blocks are deliberately identical in both packs, which the
// default filter hides. Show everything so any asset can be reached.
await page.getByLabel(/only differing/i).uncheck().catch(async () => {
  await page.getByText('only differing').click();
});
await page.waitForTimeout(400);

/** Open a slot by its display name, within a category tab. */
const open = async (tab, label) => {
  await page.getByRole('button', { name: new RegExp(`^${tab}`) }).first().click();
  await page.waitForTimeout(400);
  await page.getByLabel('Search assets').fill(label);
  await page.waitForTimeout(500);
  const slot = page.locator(`.mc-slot[title^="${label}"]`).first();
  if (!(await slot.count())) return false;
  await slot.click();
  await page.waitForTimeout(700);
  return true;
};

/**
 * Enter 3D and park the solid at a fixed three-quarter angle.
 *
 * The preview spins by default, which makes shots taken at different moments
 * incomparable - and a sprite caught edge-on tells you nothing. Double-clicking
 * stops the spin, then a fixed drag turns it to where thickness is visible.
 */
const to3d = async () => {
  const btn = page.getByRole('button', { name: '3D', exact: true });
  if (!(await btn.count())) return;
  await btn.first().click();
  await page.waitForTimeout(350);

  const canvas = page.locator('canvas').first();
  await canvas.dblclick();
  await page.waitForTimeout(200);

  const box = await canvas.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  // Turn back towards the face: the spin runs on while the click lands, and
  // parking edge-on shows a sliver rather than the shape.
  await page.mouse.move(cx - 38, cy + 8, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(500);
};

/**
 * Just the preview, so the solid fills the frame. The 3D view is the only
 * canvas on the page while the texture editor is closed.
 */
const shotPreview = async (name) => {
  const canvas = page.locator('canvas').first();
  const target = (await canvas.count()) ? canvas : page.locator('.mc-checker').first();
  await target.screenshot({ path: `.shots/3d-${name}.png` });
  console.log(`  shot: 3d-${name}`);
};

/*
 * The shape is chosen from the asset's name with no UI to drive, so each of
 * these is a photograph of what the detector decided on its own.
 */
const CASES = [
  ['Items', 'Diamond Sword', 'item-sword', 'extruded sprite, should have thickness'],
  ['Items', 'Golden Apple', 'item-apple', 'extruded sprite with a rounded silhouette'],
  ['Blocks', 'Red Wool', 'block-cube', 'an ordinary block stays a cube'],
  ['Blocks', 'Bed Feet Top', 'block-bed', 'a bed is nine sixteenths tall, not a cube'],
  ['Blocks', 'Oak Sapling', 'block-cross', 'a plant is two crossed sheets'],
  ['Blocks', 'Torch', 'block-torch', 'a torch is a thin upright post'],
  ['Blocks', 'Lava Still', 'block-animated', 'an animated block shows its first frame'],
];

const missing = [];
for (const [tab, label, name, why] of CASES) {
  console.log(`${name}: ${why}`);
  if (!(await open(tab, label))) {
    missing.push(label);
    console.log('  SKIPPED - asset not found');
    continue;
  }
  await to3d();
  await shotPreview(name);
}

console.log('');
if (missing.length) console.log(`MISSING ASSETS: ${missing.join(', ')} - rerun npm run testpacks`);
if (errors.length) console.log('CONSOLE ERRORS:\n' + errors.slice(0, 10).join('\n'));
else console.log('no console errors');

await browser.close();
process.exit(missing.length > 0 || errors.length > 0 ? 1 : 0);
