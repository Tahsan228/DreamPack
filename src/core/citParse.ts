/**
 * Minimal parser for Optifine CIT `.properties` files.
 *
 * Bedwars packs lean on CIT heavily — custom swords, generators, shop items keyed
 * off item names. A CIT rule is only useful if the textures and models it points at
 * travel with it, so this exists to find those references at export time.
 */

export type Properties = Record<string, string>;

export function parseProperties(text: string): Properties {
  const out: Properties = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;

    const sep = line.search(/[=:]/);
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    const value = line.slice(sep + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

const dirOf = (path: string): string => {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
};

/**
 * Resolve one reference from inside a `.properties` file to a pack-relative path.
 *
 * Optifine treats a leading `/` or an `assets/` prefix as pack-absolute and
 * everything else as relative to the properties file's own directory.
 */
export function resolveCitRef(ref: string, propertiesPath: string, ext: string): string {
  let value = ref.trim();
  if (!value) return '';
  if (!value.toLowerCase().endsWith(ext)) value += ext;

  if (value.startsWith('/')) {
    const stripped = value.slice(1);
    return stripped.startsWith('assets/') ? stripped : `assets/minecraft/${stripped}`;
  }
  if (value.startsWith('assets/')) return value;
  if (value.startsWith('./')) value = value.slice(2);

  const dir = dirOf(propertiesPath);
  return dir ? `${dir}/${value}` : value;
}

/**
 * Every file a CIT rule depends on, as pack-relative paths.
 * Covers `texture`, `texture.<layer>`, `tile`, `tile.<n>` (CTM) and `model`.
 */
export function citReferences(text: string, propertiesPath: string): string[] {
  const props = parseProperties(text);
  const refs = new Set<string>();

  for (const [key, value] of Object.entries(props)) {
    if (!value) continue;
    const isTexture = key === 'texture' || key.startsWith('texture.') ||
                      key === 'tile' || key.startsWith('tile.');
    const isModel = key === 'model' || key.startsWith('model.');
    if (!isTexture && !isModel) continue;

    // A single key may list several space-separated candidates.
    for (const part of value.split(/\s+/)) {
      const resolved = resolveCitRef(part, propertiesPath, isModel ? '.json' : '.png');
      if (resolved) refs.add(resolved);
    }
  }

  return [...refs];
}
