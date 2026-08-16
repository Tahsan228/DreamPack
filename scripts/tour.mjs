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

console.log('');
const stats = await page.evaluate(() => ({
  bodyScrollW: document.body.scrollWidth,
  innerW: window.innerWidth,
  overflowX: document.body.scrollWidth > window.innerWidth,
}));
console.log(JSON.stringify(stats));
if (errors.length) console.log('CONSOLE ERRORS:\n' + errors.slice(0, 12).join('\n'));
else console.log('no console errors');

await browser.close();
