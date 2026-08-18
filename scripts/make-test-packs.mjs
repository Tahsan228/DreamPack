/**
 * Build two small synthetic 1.8.9 resource packs for UI testing.
 *
 * Everything is drawn procedurally — no Minecraft assets involved. The two packs
 * share filenames but use different palettes, so the grid, the "only differing"
 * filter and the candidate strip all have something real to show.
 *
 *   node scripts/make-test-packs.mjs   ->  .shots/TestPackA.zip, TestPackB.zip
 */
import zlib from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { zipSync } from 'fflate';

// ---- minimal PNG encoder -------------------------------------------------

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

const crc32 = (buf) => {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(w, h, pixel) {
  const raw = Buffer.alloc(h * (1 + w * 4));
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = pixel(x, y);
      raw[o++] = r; raw[o++] = g; raw[o++] = b; raw[o++] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- tiny shape language -------------------------------------------------

const CLEAR = [0, 0, 0, 0];
const shade = (hex, k) => {
  const n = parseInt(hex.slice(1), 16);
  return [
    Math.min(255, Math.round(((n >> 16) & 255) * k)),
    Math.min(255, Math.round(((n >> 8) & 255) * k)),
    Math.min(255, Math.round((n & 255) * k)),
    255,
  ];
};

/** Draw from a 16-row ASCII sprite: '.' transparent, 1/2/3 = light/mid/dark. */
function sprite(rows, hex) {
  return (x, y) => {
    const ch = rows[y]?.[x] ?? '.';
    if (ch === '1') return shade(hex, 1.25);
    if (ch === '2') return shade(hex, 1.0);
    if (ch === '3') return shade(hex, 0.65);
    return CLEAR;
  };
}

const SWORD = [
  '...............', '..............1', '.............12', '............123',
  '...........123.', '..........123..', '.1........123..', '..1......123...',
  '...12...123....', '....121123.....', '.....12233.....', '....123.33.....',
  '...123...3.....', '..123..........', '.123...........', '.23............',
];
const PICK = [
  '...............', '....1111111....', '...122222221...', '..12233333221..',
  '..123.......21.', '.123.....2.....', '.....2..23.....', '......223......',
  '.....223.......', '....223........', '...223.........', '..223..........',
  '..23...........', '.23............', '...............', '...............',
];
const APPLE = [
  '...............', '.......33......', '......332......', '....2222.......',
  '...22111222....', '..2211111222...', '..221111122 2..', '.22111111222...',
  '.22111111222...', '.221111112222..', '..2211111222...', '..221111222....',
  '...2211222.....', '....22222......', '......22.......', '...............',
];
const INGOT = [
  '...............', '...............', '...............', '...............',
  '.....11111.....', '....1122211....', '...112222211...', '..11222222211..',
  '..12222222221..', '..12222222221..', '..13333333331..', '...1333333331..',
  '....333333331..', '.....3333333...', '...............', '...............',
];
const GEM = [
  '...............', '.......1.......', '......121......', '.....12221.....',
  '....1222221....', '...122222221...', '..12222222221..', '.1222222222221.',
  '..32222222223..', '...3222222233..', '....32222233...', '.....322233....',
  '......3333.....', '.......33......', '...............', '...............',
];
const BREAD = [
  '...............', '...............', '....22222......', '..2211112222...',
  '.221111111122..', '.2111111111122.', '.2111211112122.', '.2112111121122.',
  '.2111111111122.', '.2111211112122.', '.2111111111122.', '.22111111111 2.',
  '..2211111122...', '....222222.....', '...............', '...............',
];

/** A flat block face with a little per-pixel variation. */
const blockFace = (hex) => (x, y) => {
  let h = (x * 374761393 + y * 668265263) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  const n = ((Math.imul(h, 1274126177) >>> 0) >>> 24) / 255;
  return shade(hex, 0.86 + n * 0.28);
};

/** GUI sheet stand-in: 256x256 with a visible grid so scaling errors show. */
const guiSheet = (hex) => (x, y) => {
  if (x % 32 === 0 || y % 32 === 0) return shade(hex, 0.5);
  return shade(hex, 0.95);
};

// ---- pack assembly -------------------------------------------------------

function buildPack({ name, palette, description }) {
  const t = (path, w, h, pixel) => [path, new Uint8Array(encodePng(w, h, pixel))];

  const files = Object.fromEntries([
    t('assets/minecraft/textures/items/diamond_sword.png', 16, 16, sprite(SWORD, palette.tool)),
    t('assets/minecraft/textures/items/iron_sword.png', 16, 16, sprite(SWORD, palette.metal)),
    t('assets/minecraft/textures/items/gold_sword.png', 16, 16, sprite(SWORD, palette.gold)),
    t('assets/minecraft/textures/items/diamond_pickaxe.png', 16, 16, sprite(PICK, palette.tool)),
    t('assets/minecraft/textures/items/iron_pickaxe.png', 16, 16, sprite(PICK, palette.metal)),
    t('assets/minecraft/textures/items/apple_golden.png', 16, 16, sprite(APPLE, palette.gold)),
    t('assets/minecraft/textures/items/apple.png', 16, 16, sprite(APPLE, palette.accent)),
    t('assets/minecraft/textures/items/bread.png', 16, 16, sprite(BREAD, palette.bread)),
    t('assets/minecraft/textures/items/gold_ingot.png', 16, 16, sprite(INGOT, palette.gold)),
    t('assets/minecraft/textures/items/iron_ingot.png', 16, 16, sprite(INGOT, palette.metal)),
    t('assets/minecraft/textures/items/diamond.png', 16, 16, sprite(GEM, palette.tool)),
    t('assets/minecraft/textures/items/emerald.png', 16, 16, sprite(GEM, palette.emerald)),
    t('assets/minecraft/textures/blocks/wool_colored_red.png', 16, 16, blockFace('#c0392b')),
    t('assets/minecraft/textures/blocks/wool_colored_blue.png', 16, 16, blockFace('#2c4fa8')),
    t('assets/minecraft/textures/blocks/wool_colored_white.png', 16, 16, blockFace(palette.wool)),
    t('assets/minecraft/textures/blocks/end_stone.png', 16, 16, blockFace(palette.stone)),
    t('assets/minecraft/textures/blocks/obsidian.png', 16, 16, blockFace('#2a1b3d')),
    t('assets/minecraft/textures/gui/icons.png', 256, 256, guiSheet(palette.accent)),
    t('assets/minecraft/textures/gui/widgets.png', 256, 256, guiSheet(palette.metal)),
    // A four-frame filmstrip, so the animated path has something real to run
    // on: editing one of these must carry its .png.mcmeta into the export.
    t('assets/minecraft/textures/blocks/lava_still.png', 16, 64, (x, y) =>
      shade(palette.gold, 0.6 + 0.5 * Math.abs(Math.sin((x + y) * 0.4)))),
    // Blocks that are not cubes, so the 3D preview's shape detection has
    // something to be right or wrong about.
    t('assets/minecraft/textures/blocks/bed_feet_top.png', 16, 16, blockFace(palette.accent)),
    t('assets/minecraft/textures/blocks/sapling_oak.png', 16, 16, (x, y) =>
      (x > 3 && x < 12 && y > 2 && y < 14 ? shade(palette.emerald, 0.9) : CLEAR)),
    t('assets/minecraft/textures/blocks/torch_on.png', 16, 16, (x, y) =>
      (x > 6 && x < 10 && y > 5 ? shade(palette.gold, 1) : CLEAR)),
    t('pack.png', 64, 64, blockFace(palette.tool)),
  ]);

  files['assets/minecraft/textures/blocks/lava_still.png.mcmeta'] = new TextEncoder().encode(
    JSON.stringify({ animation: { frametime: 2 } }, null, 2),
  );

  files['pack.mcmeta'] = new TextEncoder().encode(
    JSON.stringify({ pack: { pack_format: 1, description } }, null, 2),
  );

  return { name, bytes: zipSync(files, { level: 6 }) };
}

mkdirSync('.shots', { recursive: true });

const packs = [
  buildPack({
    name: 'TestPackA',
    description: 'Cyan test pack',
    palette: {
      tool: '#3ad2d2', metal: '#b8c6d0', gold: '#f0c419', accent: '#4aa3df',
      bread: '#c98f45', emerald: '#2ecc71', wool: '#e8e8e8', stone: '#ded8a0',
    },
  }),
  buildPack({
    name: 'TestPackB',
    description: 'Magenta test pack',
    palette: {
      tool: '#e040a0', metal: '#d0b8c6', gold: '#ff8c1a', accent: '#c0392b',
      bread: '#a8703a', emerald: '#8e44ad', wool: '#f5d0e8', stone: '#c8a0de',
    },
  }),
];

for (const p of packs) {
  const path = `.shots/${p.name}.zip`;
  writeFileSync(path, p.bytes);
  console.log(`wrote ${path}  (${(p.bytes.length / 1024).toFixed(1)} KB)`);
}
