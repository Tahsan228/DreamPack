/**
 * Report where Minecraftia actually draws its glyphs relative to the baseline,
 * and compute the @font-face overrides that centre them.
 *
 *   node scripts/font-metrics.mjs
 */
import { readFileSync } from 'node:fs';

const b = readFileSync('src/assets/fonts/Minecraftia-Regular.ttf');
const tables = {};
const numTables = b.readUInt16BE(4);
for (let i = 0; i < numTables; i++) {
  const o = 12 + i * 16;
  tables[b.toString('ascii', o, o + 4)] = b.readUInt32BE(o + 8);
}

const upem = b.readUInt16BE(tables.head + 18);
const longLoca = b.readInt16BE(tables.head + 50) === 1;

// cmap (format 4) -> glyph id
let cmap = null;
{
  const n = b.readUInt16BE(tables.cmap + 2);
  for (let i = 0; i < n; i++) {
    const sub = tables.cmap + b.readUInt32BE(tables.cmap + 4 + i * 8 + 4);
    if (b.readUInt16BE(sub) === 4) cmap = sub;
  }
}
function glyphId(cp) {
  const segX2 = b.readUInt16BE(cmap + 6);
  const segs = segX2 / 2;
  const endO = cmap + 14, startO = endO + segX2 + 2;
  const deltaO = startO + segX2, rangeO = deltaO + segX2;
  for (let s = 0; s < segs; s++) {
    if (cp > b.readUInt16BE(endO + s * 2)) continue;
    const start = b.readUInt16BE(startO + s * 2);
    if (cp < start) return 0;
    const range = b.readUInt16BE(rangeO + s * 2);
    const delta = b.readInt16BE(deltaO + s * 2);
    if (range === 0) return (cp + delta) & 0xffff;
    const gi = b.readUInt16BE(rangeO + s * 2 + range + (cp - start) * 2);
    return gi === 0 ? 0 : (gi + delta) & 0xffff;
  }
  return 0;
}

/** glyf header: numberOfContours@0, xMin@2, yMin@4, xMax@6, yMax@8 (all int16). */
function inkBox(cp) {
  const g = glyphId(cp);
  if (!g) return null;
  const off = longLoca ? b.readUInt32BE(tables.loca + g * 4) : b.readUInt16BE(tables.loca + g * 2) * 2;
  const end = longLoca ? b.readUInt32BE(tables.loca + (g + 1) * 4) : b.readUInt16BE(tables.loca + (g + 1) * 2) * 2;
  if (off === end) return null; // blank glyph, e.g. space
  const h = tables.glyf + off;
  return { yMin: b.readInt16BE(h + 4), yMax: b.readInt16BE(h + 8) };
}

const sample = 'ABCXYZabcxyzgjpqy0189()[]{}!?.,:;-_/#@';
let lo = Infinity, hi = -Infinity;
for (const ch of sample) {
  const box = inkBox(ch.codePointAt(0));
  if (!box) continue;
  lo = Math.min(lo, box.yMin);
  hi = Math.max(hi, box.yMax);
}

const em = (u) => u / upem;
console.log(`unitsPerEm            ${upem}`);
console.log(`head bbox             yMin ${b.readInt16BE(tables.head + 38)}  yMax ${b.readInt16BE(tables.head + 42)}`);
console.log(`ASCII ink             yMin ${lo}  yMax ${hi}`);
console.log('');
console.log(`ink sits from         ${em(lo).toFixed(4)}em to ${em(hi).toFixed(4)}em above the baseline`);
console.log(`  -> nothing descends below the baseline: ${lo >= 0}`);
console.log(`ink height            ${em(hi - lo).toFixed(4)}em`);
console.log(`ink centre            ${em((lo + hi) / 2).toFixed(4)}em above the baseline`);
console.log('');

// A box that is symmetric about the ink centre needs ascent = 2 * centre and
// descent = 0, since descent-override cannot be negative.
const ascent = em(lo + hi);
console.log('@font-face overrides that centre the glyphs:');
console.log(`  ascent-override:  ${(ascent * 100).toFixed(2)}%`);
console.log(`  descent-override: 0%`);
console.log(`  line-gap-override: 0%`);
console.log('');
console.log(`content box becomes   ${ascent.toFixed(4)}em`);
for (const px of [16, 24]) {
  const box = ascent * px;
  console.log(`  at ${px}px: box ${box}px, ink ${em(hi - lo) * px}px, padding ${(em(lo) * px).toFixed(2)}px each side`);
  const parity = box % 2 === 0 ? 'even' : 'odd';
  console.log(`    line-height must be ${parity} for whole-pixel half-leading`);
}
