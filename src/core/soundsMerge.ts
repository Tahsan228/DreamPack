export interface SoundEntryObject {
  name: string;
  [k: string]: unknown;
}

export type SoundEntry = string | SoundEntryObject;

export interface SoundEvent {
  sounds?: SoundEntry[];
  [k: string]: unknown;
}

export type SoundsJson = Record<string, SoundEvent>;

function entryName(e: SoundEntry): string {
  return typeof e === 'string' ? e : e.name;
}

function isEventRef(e: SoundEntry): boolean {
  return typeof e !== 'string' && e.type === 'event';
}

/** `minecraft:random/click` or `random/click` -> the canonical slot key. */
export function soundRefToKey(ref: string): string {
  const colon = ref.indexOf(':');
  if (colon === -1) return `sound:${ref}`;
  const ns = ref.slice(0, colon);
  const path = ref.slice(colon + 1);
  return ns === 'minecraft' ? `sound:${path}` : `sound:@${ns}/${path}`;
}

/**
 * Build one sounds.json for the exported pack.
 *
 * Event *definitions* come from the priority order — the first pack that defines
 * an event owns it — while the audio bytes at each path come from whatever the
 * user picked for that sound slot. Entries pointing at files that did not make it
 * into the export are dropped, and events left with nothing are dropped too, so
 * the result can never reference a missing file.
 *
 * @param perPack   pack sounds.json contents, already in priority order
 * @param available canonical sound keys present in the exported pack
 */
export function mergeSoundsJson(
  perPack: Array<{ packId: string; json: SoundsJson }>,
  available: Set<string>,
): SoundsJson {
  const out: SoundsJson = {};

  for (const { json } of perPack) {
    for (const [event, def] of Object.entries(json)) {
      if (event in out) continue;
      if (!def || typeof def !== 'object') continue;

      const sounds = Array.isArray(def.sounds) ? def.sounds : undefined;
      if (!sounds) {
        // No `sounds` array (e.g. a bare `{ "replace": true }`); keep as-is.
        out[event] = def;
        continue;
      }

      const kept = sounds.filter((e) => {
        // `type: event` entries redirect to another event, not to a file.
        if (isEventRef(e)) return true;
        const name = entryName(e);
        return typeof name === 'string' && available.has(soundRefToKey(name));
      });

      if (kept.length === 0) continue;
      out[event] = { ...def, sounds: kept };
    }
  }

  return out;
}
