/**
 * Screenshot the running app so UI changes can be checked against what a browser
 * actually renders, rather than by reading CSS.
 *
 *   node scripts/shot.mjs [name] [--dpr=1] [--w=1600] [--h=1000] [--url=...]
 *
 * Writes to .shots/<name>.png. Pass --dpr to match a display with Windows
 * scaling on, since fractional device pixel ratios are what break pixel art.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => a.replace(/^--/, '').split('=')),
);
const name = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'app';

const url = args.url ?? 'http://localhost:5173/';
const width = Number(args.w ?? 1600);
const height = Number(args.h ?? 1000);
const deviceScaleFactor = Number(args.dpr ?? 1);

mkdirSync('.shots', { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width, height },
  deviceScaleFactor,
  reducedMotion: 'no-preference',
});
const page = await context.newPage();

const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(url, { waitUntil: 'networkidle' });
// Let the font load and the generated textures install before capturing.
await page.waitForTimeout(1200);

const path = `.shots/${name}.png`;
await page.screenshot({ path, fullPage: false });

// Report anything that would explain a visual oddity.
const info = await page.evaluate(() => {
  const cs = getComputedStyle(document.body);
  const btn = document.querySelector('.mc-btn');
  return {
    dpr: window.devicePixelRatio,
    fontFamily: cs.fontFamily,
    fontSize: cs.fontSize,
    lineHeight: cs.lineHeight,
    grainInstalled:
      getComputedStyle(document.documentElement).getPropertyValue('--mc-grain').slice(0, 24) || '(none)',
    fontLoaded: document.fonts.check('16px Minecraftia'),
    buttonText: btn?.textContent ?? null,
    buttonHeight: btn ? Math.round(btn.getBoundingClientRect().height) : null,
    bodyScrollW: document.body.scrollWidth,
    innerW: window.innerWidth,
  };
});

console.log(JSON.stringify(info, null, 2));
if (errors.length) console.log('CONSOLE ERRORS:\n' + errors.join('\n'));
console.log('wrote ' + path);

await browser.close();
