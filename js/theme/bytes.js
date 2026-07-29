// Base64 both ways, because an uploaded file has to survive three trips it
// wasn't born for: into storage, out to an exported theme file, and back into
// an AudioContext. Text is the only form all three agree on.
//
// Written against a byte array rather than `btoa` on a string so the same code
// runs under Node in the tests, where neither `btoa` nor `FileReader` is the
// obvious thing to reach for.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const LOOKUP = (() => {
  const table = new Uint8Array(128).fill(255);
  for (let i = 0; i < ALPHABET.length; i += 1) table[ALPHABET.charCodeAt(i)] = i;
  return table;
})();

export function bytesToBase64(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = '';
  for (let i = 0; i < view.length; i += 3) {
    const a = view[i];
    const b = view[i + 1];
    const c = view[i + 2];
    out += ALPHABET[a >> 2];
    out += ALPHABET[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out += b === undefined ? '=' : ALPHABET[((b & 15) << 2) | ((c ?? 0) >> 6)];
    out += c === undefined ? '=' : ALPHABET[c & 63];
  }
  return out;
}

/** Returns null rather than throwing on anything that isn't base64. */
export function base64ToBytes(text) {
  if (typeof text !== 'string') return null;
  const clean = text.replace(/[\s=]+$/, '');
  if (!/^[A-Za-z0-9+/]*$/.test(clean)) return null;

  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let at = 0;
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i += 1) {
    const value = LOOKUP[clean.charCodeAt(i)];
    if (value === 255) return null;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[at] = (buffer >> bits) & 255;
      at += 1;
    }
  }
  return bytes.subarray(0, at);
}
