/**
 * Drive the app through its main states and screenshot each one, so UI work can
 * be checked against a real browser instead of guessed at.
 *
 *   node scripts/make-test-packs.mjs && node scripts/tour.mjs [--dpr=1]
 *
 * Writes .shots/tour-*.png and prints any console errors it hits along the way.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => a.replace(/^--/, '').split('=')),
);
const deviceScaleFactor = Number(args.dpr ?? 1);
const url = args.url ?? 'http://localhost:5173/';

mkdirSync('.shots', { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: Number(args.w ?? 1600), height: Number(args.h ?? 1000) },
  deviceScaleFactor,
});
const page = await context.newPage();

const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

const shot = async (name) => {
  await page.screenshot({ path: `.shots/tour-${name}.png` });
  console.log(`  shot: tour-${name}`);
};

await page.goto(url, { waitUntil: 'networkidle' });
// Start from a clean slate so reruns are comparable.
await page.evaluate(async () => {
  await new Promise((r) => {
    const req = indexedDB.deleteDatabase('dreampack');
    req.onsuccess = req.onerror = req.onblocked = () => r();
  });
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(800);

console.log('1. empty state');
await shot('1-empty');

console.log('2. importing two packs (A first, so priority is deterministic)');
for (const name of ['TestPackA', 'TestPackB']) {
  await page.setInputFiles('input[type=file][accept=".zip"]', resolve(`.shots/${name}.zip`));
  await page.waitForSelector(`text=${name}`, { timeout: 20000 });
  await page.waitForTimeout(900);
}
await shot('2-imported');

console.log('3. items grid');
await page.waitForTimeout(500);
await shot('3-grid');

console.log('4. select a slot -> viewport + candidates');
const slot = page.locator('.mc-slot').first();
await slot.click();
await page.waitForTimeout(900);
await shot('4-viewport');

console.log('5. pick TestPackB for this slot (priority would give TestPackA)');
await page.locator('.mc-slot').filter({ hasText: 'TestPackB' }).first().click();
await page.waitForTimeout(700);
await shot('5-picked');

console.log('6. 3D view');
const btn3d = page.getByRole('button', { name: '3D', exact: true });
if (await btn3d.count()) {
  await btn3d.first().click();
  await page.waitForTimeout(1400);
  await shot('6-3d');
}

console.log('7. blocks tab');
const blocks = page.getByRole('button', { name: /^Blocks/ });
if (await blocks.count()) {
  await blocks.first().click();
  await page.waitForTimeout(500);
  await page.locator('.mc-slot').first().click();
  await page.waitForTimeout(900);
  await shot('7-blocks');
}

console.log('8. texture editor');
const edit = page.getByRole('button', { name: /Edit Texture/ });
if (await edit.count()) {
  await edit.first().click();
  await page.waitForTimeout(1400);
  await shot('8-editor');
}

console.log('9. export the mixed pack');
const cancel = page.getByRole('button', { name: 'Cancel' });
if (await cancel.count()) {
  await cancel.first().click();
  await page.waitForTimeout(400);
}
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 30000 }),
  page.getByRole('button', { name: 'Export Pack' }).click(),
]);
await download.saveAs('.shots/exported.zip');
console.log(`  downloaded: ${download.suggestedFilename()}`);
await page.waitForTimeout(900);
await shot('9-exported');

const state = await page.evaluate(() => {
  const rail = [...document.querySelectorAll('.mc-panel')]
    .map((el) => el.textContent ?? '')
    .filter((t) => t.includes('TestPack'));
  return { rail: rail.slice(0, 2) };
});
console.log('  priority order: ' + JSON.stringify(state.rail));

/** The "clear N" button is the honest count of manual picks currently held. */
const pickCount = async () => {
  const btn = page.getByRole('button', { name: /^clear \d+$/ });
  if (!(await btn.count())) return 0;
  return Number((await btn.first().textContent()).replace(/\D/g, ''));
};

const fail = [];

// The export dialog is still up and would swallow every click below it.
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

console.log('10. keyboard: arrows move the cursor, a number key picks');
await page.getByRole('button', { name: /^Items/ }).first().click();
await page.waitForTimeout(400);
await page.locator('.mc-slot').first().click();
await page.waitForTimeout(400);
await page.keyboard.press('ArrowRight');
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(300);
const beforeKey = await pickCount();
await page.keyboard.press('2');
await page.waitForTimeout(500);
const afterKey = await pickCount();
if (afterKey !== beforeKey + 1) fail.push(`number key did not pick (${beforeKey} -> ${afterKey})`);
await shot('10-keyboard');

console.log('11. bulk: apply one pack to everything shown');
// Matched on title: the accessible name is the pack name, which also appears
// on the rail cards and the candidate chips.
const bulk = page.locator('button[title^="Point every one of"]');
if (await bulk.count()) {
  await bulk.last().click();
  await page.waitForTimeout(400);
  // Over the threshold this asks first.
  const apply = page.getByRole('button', { name: 'Apply', exact: true });
  if (await apply.count()) {
    await apply.click();
    await page.waitForTimeout(500);
  }
  const afterBulk = await pickCount();
  if (afterBulk <= afterKey) fail.push(`bulk apply changed nothing (${afterKey} -> ${afterBulk})`);
  console.log(`  picks now: ${afterBulk}`);
  await shot('11-bulk');

  console.log('12. undo puts the bulk apply back in one step');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(500);
  const afterUndo = await pickCount();
  if (afterUndo !== afterKey) fail.push(`undo did not restore (${afterKey} vs ${afterUndo})`);
} else {
  fail.push('bulk apply buttons not rendered');
}

console.log('13. the session survives a reload');
const beforeReload = await pickCount();
const orderBefore = await page.evaluate(() =>
  [...document.querySelectorAll('.mc-panel')]
    .map((el) => el.textContent ?? '')
    .filter((t) => /#\d TestPack/.test(t))
    .map((t) => (t.match(/#\d TestPack\w/) ?? [''])[0]),
);
await page.waitForTimeout(700); // let the debounced session write land
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(2200);
const afterReload = await pickCount();
const orderAfter = await page.evaluate(() =>
  [...document.querySelectorAll('.mc-panel')]
    .map((el) => el.textContent ?? '')
    .filter((t) => /#\d TestPack/.test(t))
    .map((t) => (t.match(/#\d TestPack\w/) ?? [''])[0]),
);
if (afterReload !== beforeReload) fail.push(`picks lost on reload (${beforeReload} -> ${afterReload})`);
if (JSON.stringify(orderBefore) !== JSON.stringify(orderAfter)) {
  fail.push(`priority order lost on reload: ${JSON.stringify(orderBefore)} -> ${JSON.stringify(orderAfter)}`);
}
console.log(`  picks ${beforeReload} -> ${afterReload}, order ${JSON.stringify(orderAfter)}`);
await shot('13-reloaded');

console.log('14. re-importing the same zip is caught');
await page.setInputFiles('input[type=file][accept=".zip"]', resolve('.shots/TestPackA.zip'));
await page.waitForTimeout(1200);
const dupe = page.getByText(/Already imported/);
if (!(await dupe.count())) fail.push('duplicate import was not caught');
await shot('14-duplicate');
const skip = page.getByRole('button', { name: 'Skip' });
if (await skip.count()) await skip.click();
await page.waitForTimeout(400);

/*
 * 15. An animated texture is a filmstrip plus a .png.mcmeta. The editor only
 * replaces the strip, so unless the companion travels with the edit the export
 * ships an animation the game cannot play.
 */
console.log('15. an edited animated texture keeps its .mcmeta through export');
await page.getByRole('button', { name: /^Blocks/ }).first().click();
await page.waitForTimeout(500);
await page.locator('.mc-slot').first().click();
await page.waitForTimeout(400);
await page.getByLabel('Search assets').fill('lava');
await page.waitForTimeout(600);
const lava = page.locator('.mc-slot[title^="Lava Still"]');
if (await lava.count()) {
  await lava.first().click();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /Edit Texture/ }).first().click();
  await page.waitForTimeout(1600);
  // One dab of paint, so there is a real edit to save.
  const canvas = page.locator('canvas.editor-canvas');
  const box = await canvas.boundingBox();
  await page.mouse.click(box.x + 8, box.y + 8);
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /Save & Exit/ }).click();
  await page.waitForTimeout(1200);
  await shot('15-animated-edit');

  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.getByRole('button', { name: 'Export Pack' }).click(),
  ]);
  await dl.saveAs('.shots/exported-animated.zip');
  await page.waitForTimeout(600);

  const { unzipSync } = await import('fflate');
  const { readFileSync } = await import('node:fs');
  const entries = Object.keys(unzipSync(readFileSync('.shots/exported-animated.zip')));
  const strip = entries.find((e) => e.endsWith('lava_still.png'));
  const meta = entries.find((e) => e.endsWith('lava_still.png.mcmeta'));
  console.log(`  strip: ${strip ?? 'MISSING'} / mcmeta: ${meta ?? 'MISSING'}`);
  if (!strip) fail.push('edited animated texture missing from the export');
  if (!meta) fail.push('edited animated texture lost its .png.mcmeta in the export');
} else {
  fail.push('animated test texture not found - regenerate with npm run testpacks');
}

/*
 * 16. A texture is not stuck at whatever resolution its pack shipped: the
 * editor resamples it, and the new size has to survive all the way into the
 * exported zip.
 */
console.log('16. resizing a texture in the editor carries through to the export');
// Step 15 left its export dialog up.
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
await page.getByRole('button', { name: /^Items/ }).first().click();
await page.waitForTimeout(400);
await page.getByLabel('Search assets').fill('diamond sword');
await page.waitForTimeout(600);
await page.locator('.mc-slot[title^="Diamond Sword"]').first().click();
await page.waitForTimeout(700);
await page.getByRole('button', { name: /Edit Texture/ }).first().click();
await page.waitForTimeout(1600);

const dimsText = async () => (await page.getByText(/^now \d+x\d+/).first().textContent()).trim();
console.log(`  ${await dimsText()}`);

await page.getByRole('button', { name: '64', exact: true }).click();
await page.waitForTimeout(700);
const resized = await dimsText();
console.log(`  after resize: ${resized}`);
if (!/64x64/.test(resized)) fail.push(`resize to 64 did not take (${resized})`);

// Undo has to cope with the buffer changing size, not just its contents.
await page.keyboard.press('Control+z');
await page.waitForTimeout(600);
const undone = await dimsText();
console.log(`  after undo:   ${undone}`);
if (!/16x16/.test(undone)) fail.push(`undo did not restore the original size (${undone})`);

await page.getByRole('button', { name: '32', exact: true }).click();
await page.waitForTimeout(700);
await shot('16-resized');
await page.getByRole('button', { name: /Save & Exit/ }).click();
await page.waitForTimeout(1400);

const [dl2] = await Promise.all([
  page.waitForEvent('download', { timeout: 30000 }),
  page.getByRole('button', { name: 'Export Pack' }).click(),
]);
await dl2.saveAs('.shots/exported-resized.zip');
await page.waitForTimeout(600);

{
  const { unzipSync } = await import('fflate');
  const { readFileSync } = await import('node:fs');
  const zip = unzipSync(readFileSync('.shots/exported-resized.zip'));
  const name = Object.keys(zip).find((e) => e.endsWith('sword_diamond.png'));
  if (!name) {
    fail.push('resized sword missing from the export');
  } else {
    // PNG dimensions live in the IHDR chunk at a fixed offset.
    const view = new DataView(zip[name].buffer, zip[name].byteOffset, zip[name].byteLength);
    const w = view.getUint32(16);
    const h = view.getUint32(20);
    console.log(`  exported ${name.split('/').pop()} at ${w}x${h}`);
    if (w !== 32 || h !== 32) fail.push(`exported texture is ${w}x${h}, expected 32x32`);
  }
}

console.log('');
const stats = await page.evaluate(() => ({
  bodyScrollW: document.body.scrollWidth,
  innerW: window.innerWidth,
  overflowX: document.body.scrollWidth > window.innerWidth,
}));
console.log(JSON.stringify(stats));
/*
 * The ad script frames google.com and trips a report-only CSP directive there.
 * It is third-party noise from an <script> in index.html, not the app, so it is
 * reported but never fails the run - otherwise the tour can never pass.
 */
const thirdParty = (t) => /report-only Content Security Policy|googlesyndication|adsbygoogle/i.test(t);
const ours = errors.filter((e) => !thirdParty(e));

if (errors.length) console.log('CONSOLE ERRORS:\n' + errors.slice(0, 12).join('\n'));
else console.log('no console errors');
if (errors.length && ours.length === 0) console.log('  (all third-party ad noise)');

if (fail.length) {
  console.log('\nFAILED CHECKS:\n' + fail.map((f) => `  - ${f}`).join('\n'));
} else {
  console.log('all behaviour checks passed');
}

await browser.close();
process.exit(fail.length > 0 || ours.length > 0 ? 1 : 0);
