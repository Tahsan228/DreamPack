/**
 * Fail if any character rendered by the UI is missing from Minecraftia.
 *
 * The font covers 722 codepoints and lacks most symbols and typographic
 * punctuation, so a stray em dash or curly quote silently renders in a fallback
 * face and looks wrong next to the pixel type.
 *
 *   node scripts/audit-glyphs.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const FONT = 'src/assets/fonts/Minecraftia-Regular.ttf';

function fontCodepoints(file) {
  const b = readFileSync(file);
  const numTables = b.readUInt16BE(4);
  let cmapOff = null;
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16;
    if (b.toString('ascii', o, o + 4) === 'cmap') cmapOff = b.readUInt32BE(o + 8);
  }
  if (cmapOff === null) throw new Error('no cmap table');

  const cps = new Set();
  const n = b.readUInt16BE(cmapOff + 2);
  for (let i = 0; i < n; i++) {
    const sub = cmapOff + b.readUInt32BE(cmapOff + 4 + i * 8 + 4);
    if (b.readUInt16BE(sub) !== 4) continue; // format 4 covers the BMP
    const segX2 = b.readUInt16BE(sub + 6);
    const segs = segX2 / 2;
    const endO = sub + 14;
    const startO = endO + segX2 + 2;
    for (let s = 0; s < segs; s++) {
      const end = b.readUInt16BE(endO + s * 2);
      const start = b.readUInt16BE(startO + s * 2);
      if (start === 0xffff) continue;
      for (let c = start; c <= end && c < 0xffff; c++) cps.add(c);
    }
  }
  return cps;
}

function sources(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== 'assets') sources(p, out);
    } else if (/\.(tsx|css)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

const cps = fontCodepoints(FONT);
const missing = new Map();

for (const file of sources('src')) {
  readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    // Comments never reach the screen.
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('{/*')) return;
    for (const ch of line) {
      const c = ch.codePointAt(0);
      if (c < 0x80 || cps.has(c)) continue;
      const key = `U+${c.toString(16).toUpperCase().padStart(4, '0')} [${ch}]`;
      if (!missing.has(key)) missing.set(key, []);
      const hits = missing.get(key);
      if (hits.length < 4) hits.push(`${file.split('\\').join('/')}:${i + 1}`);
    }
  });
}

if (missing.size === 0) {
  console.log(`PASS - every rendered glyph exists in the font (${cps.size} codepoints).`);
  process.exit(0);
}

console.log('MISSING FROM FONT (these render in a fallback face):');
for (const [key, hits] of missing) console.log(`  ${key}  ${hits.join(', ')}`);
process.exit(1);
