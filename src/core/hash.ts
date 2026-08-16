/**
 * FNV-1a over the raw bytes. Texture files are a few KB at most, so hashing
 * them whole is cheap and lets the "only differing" filter compare packs exactly.
 */
export function hashBytes(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  // Mix in the length so same-bytes-different-length can never collide trivially.
  return (h >>> 0).toString(36) + '-' + bytes.length.toString(36);
}
